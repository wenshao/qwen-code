#!/usr/bin/env npx tsx
/**
 * PR #10280 round-3 rig, R3-2: approval that races the turn abort.
 *
 * `--approval-mode default`, the model asks for a shell command, the
 * confirmation dialog appears, and the user declines it (Esc inside the
 * dialog == `onConfirm(ToolConfirmationOutcome.Cancel)` with no payload,
 * `ToolConfirmationMessage.tsx:145`). A declined confirmation does not
 * abort the turn, so the cancellation notice reaches the model in the
 * same session, on the next request — no reload needed.
 *
 * Env: PROBE_DIST, PROBE_ARM, PROBE_OUT
 */
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TerminalCapture } from './terminal-capture.js';
import { fakeToolCall, startFakeOpenAIServer } from '../fake-openai-server.js';

const ESC = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);
const DIST = resolve(process.env['PROBE_DIST'] ?? '');
const ARM = process.env['PROBE_ARM'] ?? 'UNKNOWN';
const OUT = resolve(process.env['PROBE_OUT'] ?? '/tmp/pr10280-decline');
const DONE = 'PROBE_TURN_DONE';

function baseEnv(homeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '1',
    NODE_NO_WARNINGS: '1',
    QWEN_CODE_DISABLE_SYNCHRONIZED_OUTPUT: '1',
    QWEN_CODE_NO_RELAUNCH: '1',
    QWEN_SANDBOX: 'false',
    TERM: 'xterm-256color',
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
  delete env['NO_COLOR'];
  delete env['QWEN_CODE_SIMPLE'];
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
  return env;
}

async function main(): Promise<void> {
  if (!DIST || !existsSync(join(DIST, 'cli.js'))) {
    throw new Error(`PROBE_DIST does not contain cli.js: ${DIST}`);
  }
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const homeDir = join(OUT, 'home');
  const workDir = join(OUT, 'work');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });

  const server = await startFakeOpenAIServer(({ requestIndex }) => {
    if (requestIndex === 0) {
      return {
        toolCalls: [
          fakeToolCall(
            'run_shell_command',
            {
              command: 'echo PROBE_APPROVED_RAN > pr10280-approved.txt',
              description: 'probe command the user will decline',
            },
            'probe_race_a',
          ),
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    }
    return {
      content: `${DONE}_${requestIndex + 1}`,
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    };
  });
  console.error(`[rig] arm=${ARM} fake openai at ${server.baseUrl}`);

  const t = await TerminalCapture.create({
    cols: 100,
    rows: 30,
    cwd: workDir,
    outputDir: OUT,
    title: `qwen-code — PR #10280 arm ${ARM} (decline a confirmation)`,
    theme: 'github-dark',
    chrome: true,
    fontSize: 14,
    env: baseEnv(homeDir),
  });
  try {
    await t.spawn('node', [
      join(DIST, 'cli.js'),
      '--approval-mode',
      'default',
      '--auth-type',
      'openai',
      '--openai-api-key',
      'dummy',
      '--openai-base-url',
      server.baseUrl,
      '--model',
      'dummy',
    ]);
    await t.waitFor('Type your message', { timeout: 60000 });
    await t.type('run the probe command', { slow: true, delay: 10 });
    await t.idle(400, 6000);
    await t.type('\n');
    await t.waitFor('esc', { timeout: 60000 });
    await t.idle(800, 8000);
    await t.capture(`${ARM}-race-1-dialog.png`);
    writeFileSync(
      join(OUT, `${ARM}-race-dialog-screen.txt`),
      await t.getScreenText(),
    );
    // The race: approve the call and abort the turn in ONE pty write, so the
    // Esc is delivered while the confirmation chain is still suspended inside
    // `_handleConfirmationResponseInner` (`await originalOnConfirm` /
    // `await persistPermissionOutcome`). No source modification, no injected
    // delay -- two real keystrokes in one read chunk.
    // Navigate to the chosen option first (arrow keys are not debounced the
    // way the numeric quick-select buffer is), then send Enter+Esc in ONE
    // write so the abort is delivered while the confirmation chain is still
    // suspended at `await originalOnConfirm` / `await persistPermissionOutcome`.
    const DOWN = process.env['PROBE_DOWN'] ?? '0';
    for (let i = 0; i < Number(DOWN); i++) {
      await t.type('\u001b[B');
      await t.idle(250, 3000);
    }
    await t.capture(`${ARM}-race-1b-selected.png`);
    const RACE = process.env['PROBE_RACE'] ?? '1';
    if (RACE === '1') {
      await t.type('\r' + ESC);
    } else {
      await t.type('\r');
      await t.idle(1200, 8000);
      await t.type(ESC);
    }
    await t.idle(1500, 20000);
    await t.capture(`${ARM}-race-2-after.png`);
    // The declined confirmation does not abort the turn and does not send a
    // request on its own; send one more user message so the model is called
    // again with the history the decline produced.
    await t.waitFor('Type your message', { timeout: 45000 });
    await t.type('what happened?', { slow: true, delay: 10 });
    await t.idle(400, 6000);
    await t.type('\n');
    try {
      await t.waitFor(DONE, { timeout: 45000 });
    } catch {
      console.error('[rig] WARNING: follow-up marker never appeared');
    }
    await t.idle(1200, 8000);
    await t.capture(`${ARM}-race-3-final.png`);
    writeFileSync(
      join(OUT, `${ARM}-race-screen.txt`),
      await t.getScreenText(),
    );
  } finally {
    await t.type(CTRL_C);
    await t.close();
    writeFileSync(
      join(OUT, `${ARM}-race-requests.json`),
      JSON.stringify(
        server.requests.map((r) => r.body),
        null,
        2,
      ),
    );
    await server.close();
  }

  const bodies = server.requests.map((r) => r.body as Record<string, unknown>);
  const toolMessages: Array<Record<string, unknown>> = [];
  bodies.forEach((body, i) => {
    const messages = body['messages'];
    if (!Array.isArray(messages)) return;
    for (const m of messages) {
      const mm = m as Record<string, unknown>;
      if (mm && typeof mm === 'object' && mm['role'] === 'tool') {
        toolMessages.push({
          request: i + 1,
          tool_call_id: mm['tool_call_id'],
          content: mm['content'],
        });
      }
    }
  });
  const summary = {
    arm: ARM,
    dist: DIST,
    totalRequests: bodies.length,
    toolMessages,
    approvedToolRan: existsSync(join(workDir, 'pr10280-approved.txt')),
  };
  writeFileSync(
    join(OUT, `${ARM}-race-toolmessages.json`),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
