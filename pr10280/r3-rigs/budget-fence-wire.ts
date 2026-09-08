#!/usr/bin/env npx tsx
/**
 * PR #10280 round-3 rig: a *non-user* abort of a real headless run.
 *
 * The head commit (51823d62ac) took "User intentionally" out of the
 * pre-execution notice precisely because those sites gate on
 * `signal.aborted` alone. The two post-`execute()` notices were left
 * asserting user intent unconditionally. This rig fires the run-budget
 * fence (`runBudget.ts` -> bare `abortController.abort()`, no keystroke,
 * no SIGINT) while tool A is inside `execute()` and sibling B is still
 * queued, and records what each of the two calls tells the model.
 *
 * Observation surfaces, all real:
 *   1. the PostToolUseFailure hook payload (`error` = the cancelMessage)
 *   2. the session recording on disk
 *   3. the bytes a follow-up `--continue` run puts on the wire
 *
 * Env: PROBE_DIST, PROBE_ARM, PROBE_OUT, PROBE_SLEEP, PROBE_WALL
 */
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fakeToolCall, startFakeOpenAIServer } from './fake-openai-server.js';

const DIST = resolve(process.env['PROBE_DIST'] ?? '');
const ARM = process.env['PROBE_ARM'] ?? 'UNKNOWN';
const OUT = resolve(process.env['PROBE_OUT'] ?? '/tmp/pr10280-budget');
const SLEEP_SECONDS = Number(process.env['PROBE_SLEEP'] ?? '30');
const WALL = process.env['PROBE_WALL'] ?? '8';

function baseEnv(homeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    QWEN_CODE_NO_RELAUNCH: '1',
    QWEN_SANDBOX: 'false',
    TERM: 'dumb',
    NO_COLOR: '1',
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
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

function cliArgs(baseUrl: string, extra: string[]): string[] {
  return [
    join(DIST, 'cli.js'),
    '--approval-mode',
    'yolo',
    '--auth-type',
    'openai',
    '--openai-api-key',
    'dummy',
    '--openai-base-url',
    baseUrl,
    '--model',
    'dummy',
    ...extra,
  ];
}

function run(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = spawn('node', args, { cwd, env, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => {
      console.error(`[rig] ${label} exit=${code}`);
      res({ code, stdout, stderr });
    });
  });
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

async function main(): Promise<void> {
  if (!DIST || !existsSync(join(DIST, 'cli.js'))) {
    throw new Error(`PROBE_DIST does not contain cli.js: ${DIST}`);
  }
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const homeDir = join(OUT, 'home');
  const workDir = join(OUT, 'work');
  const hookLog = join(OUT, 'hook-payloads.jsonl');
  mkdirSync(join(homeDir, '.qwen'), { recursive: true });
  mkdirSync(workDir, { recursive: true });

  // A real command hook: appends the whole PostToolUseFailure payload.
  const hookScript = join(OUT, 'capture-hook.sh');
  writeFileSync(
    hookScript,
    `#!/bin/sh\ncat >> ${JSON.stringify(hookLog)}\nprintf '\\n' >> ${JSON.stringify(hookLog)}\nexit 0\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(homeDir, '.qwen', 'settings.json'),
    JSON.stringify(
      {
        hooks: {
          PostToolUseFailure: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: hookScript, timeout: 10000 }],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const server = await startFakeOpenAIServer(({ requestIndex }) => {
    if (requestIndex === 0) {
      return {
        toolCalls: [
          fakeToolCall(
            'run_shell_command',
            {
              command: `echo PROBE_SHELL_STARTED && sleep ${SLEEP_SECONDS}`,
              description: 'long running probe command',
            },
            'probe_call_a',
          ),
          fakeToolCall(
            'run_shell_command',
            {
              command: 'echo PROBE_SECOND_RAN > pr10280-second.txt',
              description: 'sibling probe command',
            },
            'probe_call_b',
          ),
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    }
    return {
      content: `PROBE_TURN_DONE_${requestIndex + 1}`,
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    };
  });
  console.error(`[rig] arm=${ARM} fake openai at ${server.baseUrl}`);

  // ── Phase 1: headless run, aborted by the wall-clock budget fence ───────
  const t0 = Date.now();
  const p1 = await run(
    cliArgs(server.baseUrl, [
      '-p',
      'run the probe command',
      '--max-wall-time',
      WALL,
    ]),
    workDir,
    baseEnv(homeDir),
    'phase1(headless, --max-wall-time)',
  );
  const phase1Ms = Date.now() - t0;
  const phase1Requests = server.requests.length;

  // ── Phase 2: --continue, one message, capture the wire ──────────────────
  const p2 = await run(
    cliArgs(server.baseUrl, ['--continue', '-p', 'what happened?']),
    workDir,
    baseEnv(homeDir),
    'phase2(--continue)',
  );

  const bodies = server.requests.map((r) => r.body as Record<string, unknown>);
  writeFileSync(
    join(OUT, `${ARM}-requests.json`),
    JSON.stringify(bodies, null, 2),
  );

  const toolMessages: Array<Record<string, unknown>> = [];
  bodies.forEach((body, i) => {
    const messages = body['messages'];
    if (!Array.isArray(messages)) return;
    for (const m of messages) {
      const mm = m as Record<string, unknown>;
      if (mm && typeof mm === 'object' && mm['role'] === 'tool') {
        toolMessages.push({
          request: i + 1,
          phase: i + 1 <= phase1Requests ? 'phase1' : 'phase2(--continue)',
          tool_call_id: mm['tool_call_id'],
          content: mm['content'],
        });
      }
    }
  });

  const hookPayloads: unknown[] = [];
  if (existsSync(hookLog)) {
    for (const line of readFileSync(hookLog, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        hookPayloads.push(JSON.parse(t));
      } catch {
        hookPayloads.push({ unparsed: t });
      }
    }
  }

  // Session recording on disk.
  const sessionFiles = walk(join(homeDir, '.qwen'))
    .filter((f) => /\.jsonl$/.test(f))
    .slice(0, 20);
  const recorded: Array<{ file: string; line: string }> = [];
  for (const f of sessionFiles) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (
        line.includes('Operation Cancelled') ||
        line.includes('cancelled before it ran') ||
        line.includes('User intentionally cancelled') ||
        line.includes('had already completed')
      ) {
        recorded.push({ file: f.replace(homeDir, '$HOME'), line: line.trim() });
      }
    }
  }

  const summary = {
    arm: ARM,
    dist: DIST,
    wallBudget: WALL,
    phase1: {
      exitCode: p1.code,
      elapsedMs: phase1Ms,
      requests: phase1Requests,
      stdoutTail: p1.stdout.slice(-2000),
      stderrTail: p1.stderr.slice(-2000),
    },
    phase2: { exitCode: p2.code, stdoutTail: p2.stdout.slice(-1200) },
    totalRequests: bodies.length,
    hookPayloads,
    toolMessages,
    recorded,
    siblingRan: existsSync(join(workDir, 'pr10280-second.txt')),
  };
  writeFileSync(
    join(OUT, `${ARM}-summary.json`),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
  await server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
