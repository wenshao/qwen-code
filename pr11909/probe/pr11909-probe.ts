#!/usr/bin/env npx tsx
/**
 * End-to-end A/B probe for PR #11909 (deepseek-flash token limits).
 *
 * Drives the REAL bundled CLI (dist/cli.js) against the repo's fake OpenAI
 * server with `--model deepseek-flash`, and records:
 *
 *   1. the `max_tokens` the CLI puts on the wire (output-limit path),
 *   2. whether the CLI fires an auto-compaction side-query
 *      (system prompt contains `<state_snapshot>`) once the session's
 *      reported prompt size reaches the level measured in #11894,
 *   3. a `/context` screenshot showing the resolved context window and the
 *      compaction threshold ladder.
 *
 * Both arms run the identical script against the identical server; only the
 * bundle differs (PR head vs. the two regex rows reverted).
 *
 * Usage:
 *   npx tsx pr11909-probe.ts --cli <path to dist/cli.js> --arm before|after \
 *       --out <dir> [--truncated]
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { TerminalCapture } from './integration-tests/terminal-capture/terminal-capture.js';
import { startFakeOpenAIServer } from './integration-tests/fake-openai-server.js';

const ARGS = process.argv.slice(2);
function argOf(name: string, fallback?: string): string {
  const i = ARGS.indexOf(`--${name}`);
  if (i >= 0 && ARGS[i + 1]) return ARGS[i + 1] as string;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}
const HAS_TRUNCATED = ARGS.includes('--truncated');

const CLI = resolve(argOf('cli'));
const ARM = argOf('arm');
const OUT = resolve(argOf('out'));
const MODEL = argOf('model', 'deepseek-flash');
const REPO_ROOT = resolve(argOf('repo', dirname(dirname(CLI))));

/**
 * Prompt size the CLI is told the session has reached. #11894 measured a
 * long `/review --effort high` main loop peaking at 250K-290K prompt tokens.
 */
const BIG_PROMPT_TOKENS = 250_000;
/** COMPACT_MAX_OUTPUT_TOKENS in core; a summary at the cap is treated as truncated. */
const COMPACT_MAX_OUTPUT_TOKENS = 20_000;

const TURN1 = 'PROBE_ONE please reply';
const TURN2 = 'PROBE_TWO please reply';
const REPLY1 = 'PROBE_REPLY_ONE_DONE';
const REPLY2 = 'PROBE_REPLY_TWO_DONE';

type WireRecord = {
  index: number;
  kind: 'main' | 'compaction';
  model: unknown;
  max_tokens: unknown;
  stream: unknown;
  messageCount: number;
};

async function main(): Promise<void> {
  if (!existsSync(CLI)) throw new Error(`no bundle at ${CLI}`);
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const wire: WireRecord[] = [];
  let mainTurns = 0;

  const server = await startFakeOpenAIServer(({ body, requestIndex }) => {
    const messages = Array.isArray(body['messages'])
      ? (body['messages'] as Array<Record<string, unknown>>)
      : [];
    const systemText = messages
      .filter((m) => m['role'] === 'system')
      .map((m) =>
        typeof m['content'] === 'string'
          ? (m['content'] as string)
          : JSON.stringify(m['content']),
      )
      .join('\n');
    const isCompaction = systemText.includes('<state_snapshot>');

    wire.push({
      index: requestIndex,
      kind: isCompaction ? 'compaction' : 'main',
      model: body['model'],
      max_tokens: body['max_tokens'],
      stream: body['stream'],
      messageCount: messages.length,
    });

    if (isCompaction) {
      // A real summary. `completion_tokens` decides whether core treats it as
      // truncated (>= COMPACT_MAX_OUTPUT_TOKENS).
      return {
        content:
          '<state_snapshot><overall_goal>probe</overall_goal></state_snapshot>',
        usage: {
          prompt_tokens: BIG_PROMPT_TOKENS,
          completion_tokens: HAS_TRUNCATED ? COMPACT_MAX_OUTPUT_TOKENS : 120,
          total_tokens: BIG_PROMPT_TOKENS + (HAS_TRUNCATED ? 20_000 : 120),
        },
      };
    }

    mainTurns += 1;
    // Turn 1 reports the session has already grown to the size measured in
    // the issue; turn 2 is where the compaction gate reads that number.
    return {
      content: mainTurns === 1 ? REPLY1 : REPLY2,
      usage: {
        prompt_tokens: BIG_PROMPT_TOKENS,
        completion_tokens: 24,
        total_tokens: BIG_PROMPT_TOKENS + 24,
      },
    };
  });

  const home = join(OUT, 'home');
  mkdirSync(home, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '1',
    NODE_NO_WARNINGS: '1',
    QWEN_CODE_DISABLE_SYNCHRONIZED_OUTPUT: '1',
    QWEN_CODE_NO_RELAUNCH: '1',
    QWEN_SANDBOX: 'false',
    TERM: 'xterm-256color',
    HOME: home,
    USERPROFILE: home,
  };
  delete env['NO_COLOR'];
  delete env['QWEN_CODE_SIMPLE'];
  delete env['QWEN_HOME'];
  for (const k of [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
  ]) {
    delete env[k];
  }

  const terminal = await TerminalCapture.create({
    cols: 100,
    rows: 34,
    cwd: REPO_ROOT,
    outputDir: OUT,
    title: `qwen-code — ${ARM}`,
    theme: 'github-dark',
    chrome: false,
    fontSize: 14,
    env,
  });

  const summary: Record<string, unknown> = { arm: ARM, cli: CLI, model: MODEL };

  try {
    await terminal.spawn('node', [
      CLI,
      '--approval-mode',
      'yolo',
      '--auth-type',
      'openai',
      '--openai-api-key',
      'dummy',
      '--openai-base-url',
      server.baseUrl,
      '--model',
      MODEL,
    ]);
    await terminal.waitFor('Type your message', { timeout: 60_000 });
    await terminal.idle(500, 5_000);

    // ── Turn 1: make the session report the issue's prompt size ──
    await terminal.type(TURN1, { slow: true, delay: 6 });
    await terminal.idle(400, 4_000);
    await terminal.type('\n');
    await terminal.waitFor(REPLY1, { timeout: 60_000 });
    await terminal.idle(800, 6_000);

    // ── /context: resolved window + compaction ladder ──
    await terminal.type('/context', { slow: true, delay: 10 });
    await terminal.idle(500, 5_000);
    await terminal.type('\n');
    await terminal.idle(1_200, 15_000);
    const contextScreen = await terminal.getScreenText();
    await terminal.captureFull(`${ARM}-01-context.png`);
    writeFileSync(join(OUT, `${ARM}-01-context.txt`), contextScreen);

    // ── Turn 2: the compaction gate reads the reported prompt size ──
    const rawBefore = terminal.getRawOutput().length;
    await terminal.type(TURN2, { slow: true, delay: 6 });
    await terminal.idle(400, 4_000);
    await terminal.type('\n');
    let turn2Failed = false;
    try {
      await terminal.waitFor(REPLY2, { timeout: 60_000 });
    } catch {
      turn2Failed = true;
    }
    await terminal.idle(1_500, 8_000);
    const turn2Screen = await terminal.getScreenText();
    await terminal.captureFull(`${ARM}-02-turn2.png`);
    writeFileSync(join(OUT, `${ARM}-02-turn2.txt`), turn2Screen);
    const turn2Raw = terminal.getRawOutput().slice(rawBefore);
    writeFileSync(join(OUT, `${ARM}-02-turn2.raw`), turn2Raw);

    summary['turn2Failed'] = turn2Failed;
    summary['compactionRequests'] = wire.filter(
      (w) => w.kind === 'compaction',
    ).length;
    summary['mainRequests'] = wire.filter((w) => w.kind === 'main').length;
    summary['wire'] = wire;
    summary['firstMainMaxTokens'] =
      wire.find((w) => w.kind === 'main')?.max_tokens ?? null;
    summary['truncatedMode'] = HAS_TRUNCATED;
  } finally {
    await terminal.close();
    await server.close();
  }

  writeFileSync(join(OUT, `${ARM}-summary.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
