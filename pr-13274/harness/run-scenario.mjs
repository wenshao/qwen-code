// Usage: node run-scenario.mjs <arm-dir> <scenario-name> <out-dir>
// Boots the scripted provider, runs the real bundled CLI headless against it,
// and records: provider request log, CLI exit/elapsed, stall-retry debug lines
// and transcript retry markers.
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

const [armDir, name, outDir] = process.argv.slice(2);
const HERE = new URL('.', import.meta.url).pathname;
const one = (child, stallMs = 500) =>
  `agent('CHILD_${child}: reply with the single word ${child}${child}', { label: 'child-${child.toLowerCase()}'${stallMs === null ? '' : `, stallMs: ${stallMs}`} })`;
const META = `export const meta = { name: 'pr13274-probe', description: 'PR 13274 retry-wait probe' };\n`;
const single = (stallMs) => `${META}const a = await ${one('A', stallMs)};\nreturn { a };\n`;

const SCENARIOS = {
  // 1. HTTP 429 + Retry-After: 2, then success.
  s1_retry_after: {
    script: single(500),
    children: { A: [{ type: '429', retryAfter: '2' }, { type: 'ok', text: 'AA' }] },
    settings: { maxRetries: 0 },
  },
  // 2. 429 + Retry-After: 2, then a hung request, then success.
  s2_wait_then_hang: {
    script: single(500),
    children: {
      A: [{ type: '429', retryAfter: '2' }, { type: 'hang' }, { type: 'ok', text: 'AA' }],
    },
    settings: { maxRetries: 0 },
  },
  // 3. Cancel (SIGINT) while waiting out a 30s Retry-After.
  s3_cancel: {
    script: single(500),
    children: { A: [{ type: '429', retryAfter: '30' }] },
    settings: { maxRetries: 0 },
    sigintAfterFirstChildMs: 3000,
  },
  // 4. Parallel: A waits out a 429, B hangs once.
  s4_parallel: {
    script: `${META}const [a, b] = await parallel([() => ${one('A')}, () => ${one('B')}]);\nreturn { a, b };\n`,
    children: {
      A: [{ type: '429', retryAfter: '2' }, { type: 'ok', text: 'AA' }],
      B: [{ type: 'hang' }, { type: 'ok', text: 'BB' }],
    },
    settings: { maxRetries: 0 },
  },
  // 5. Stream-side throttle (error_finish 429 inside a 200 stream) — the
  //    llm-chat delay() path. retryInitialDelayMs shrinks the 60s sleep to 2s;
  //    maxRetries must be >= 1 or this path is disabled.
  s5_stream_throttle: {
    script: single(500),
    children: { A: [{ type: 'stream429' }, { type: 'ok', text: 'AA' }] },
    settings: { maxRetries: 1, retryInitialDelayMs: 2000, retryMaxDelayMs: 2000 },
  },
  // 6. A Retry-After (600s) far beyond the agent time limit (1 min).
  s6_time_limit: {
    script: single(500),
    children: { A: [{ type: '429', retryAfter: '600' }] },
    settings: { maxRetries: 0 },
    env: { QWEN_CODE_WORKFLOW_AGENT_MAX_MINUTES: '1' },
  },
  // 3b. Like-for-like cancel: SIGINT 300ms into the wait, before a 500ms
  //     watchdog could fire on either arm.
  s3b_cancel_early: {
    script: single(500),
    children: { A: [{ type: '429', retryAfter: '30' }] },
    settings: { maxRetries: 0 },
    sigintAfterFirstChildMs: 300,
  },
  // 8. Regression: the main session's own 429 + Retry-After (no observer).
  s8_main_429: {
    main: [{ type: '429', retryAfter: '2' }, { type: 'text', text: 'MAIN_ONLY_DONE' }],
    children: {},
    settings: { maxRetries: 0 },
  },
  // 9. Regression: a plain Agent-tool subagent (not a workflow dispatch,
  //    no opt-in) that hits 429 + Retry-After then succeeds.
  s9_agent_tool_429: {
    agentTool: {
      description: 'probe subagent',
      prompt: 'CHILD_C: reply with the single word CC',
      subagent_type: 'general-purpose',
    },
    children: { C: [{ type: '429', retryAfter: '2' }, { type: 'ok', text: 'CC' }] },
    settings: { maxRetries: 0 },
  },
  // 10. Default everything: default 180s stall window, default stream-side
  //     rate-limit ladder (60s, then 120s). Two throttles, then success.
  s10_default_ladder: {
    script: single(null),
    children: { A: [{ type: 'stream429' }, { type: 'stream429' }, { type: 'ok', text: 'AA' }] },
    settings: {},
  },
  // 7. Documented residual: default config, SDK-internal retries (3x 2s) are
  //    not announced; stallMs 5s.
  s7_sdk_internal: {
    script: single(5000),
    children: {
      A: [
        { type: '429', retryAfter: '2' },
        { type: '429', retryAfter: '2' },
        { type: '429', retryAfter: '2' },
        { type: 'ok', text: 'AA' },
      ],
    },
    settings: {},
  },
};

const sc = SCENARIOS[name];
if (!sc) throw new Error(`unknown scenario ${name}`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const home = join(outDir, 'home');
const qwenHome = join(outDir, 'qwen-home');
const ws = join(outDir, 'ws');
for (const d of [home, qwenHome, ws]) mkdirSync(d, { recursive: true });
writeFileSync(join(ws, 'README.md'), 'probe workspace\n');
writeFileSync(
  join(qwenHome, 'settings.json'),
  JSON.stringify(
    {
      tools: { workflowsEnabled: true },
      model: { generationConfig: sc.settings },
    },
    null,
    2,
  ),
);
const scenarioFile = join(outDir, 'scenario.json');
writeFileSync(scenarioFile, JSON.stringify(sc, null, 2));
const fakeLog = join(outDir, 'provider.jsonl');
writeFileSync(fakeLog, '');

const cleanEnv = { ...process.env };
for (const k of [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy',
  'NO_COLOR', 'QWEN_CODE_SIMPLE', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL',
  'DASHSCOPE_API_KEY', 'QWEN_CODE_WORKFLOW_STALL_SECONDS',
]) delete cleanEnv[k];

const fake = spawn(process.execPath, [join(HERE, 'fake-provider.mjs')], {
  env: { ...cleanEnv, FAKE_SCENARIO: scenarioFile, FAKE_LOG: fakeLog },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const baseUrl = await new Promise((resolve) => {
  fake.stdout.on('data', (d) => {
    const m = String(d).match(/FAKE_READY (\S+)/);
    if (m) resolve(m[1]);
  });
});

const env = {
  ...cleanEnv,
  HOME: home,
  USERPROFILE: home,
  QWEN_HOME: qwenHome,
  QWEN_RUNTIME_DIR: qwenHome,
  QWEN_CODE_DISABLE_WORKFLOWS: '0',
  QWEN_SANDBOX: 'false',
  QWEN_CODE_NO_RELAUNCH: '1',
  QWEN_CODE_MODELS_DEV_REFRESH: 'off',
  QWEN_DEBUG_LOG_FILE: '1',
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
  ...(sc.env ?? {}),
};
const args = [
  join(armDir, 'dist', 'cli.js'),
  '-p',
  'Run the probe workflow.',
  '--approval-mode', 'yolo',
  '--auth-type', 'openai',
  '--openai-api-key', 'fake-key',
  '--openai-base-url', baseUrl,
  '--model', 'fake-model',
  '--output-format', 'text',
];
const t0 = Date.now();
const cli = spawn(process.execPath, args, { cwd: ws, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
cli.stdout.on('data', (d) => (stdout += d));
cli.stderr.on('data', (d) => (stderr += d));

let sigintAt;
if (sc.sigintAfterFirstChildMs) {
  const poll = setInterval(() => {
    const lines = readFileSync(fakeLog, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.some((l) => JSON.parse(l).kind === 'child')) {
      clearInterval(poll);
      setTimeout(() => {
        sigintAt = Date.now() - t0;
        cli.kill('SIGINT');
      }, sc.sigintAfterFirstChildMs);
    }
  }, 50);
}
const killer = setTimeout(() => cli.kill('SIGKILL'), 600_000);
const exit = await new Promise((resolve) =>
  cli.on('exit', (code, signal) => resolve({ code, signal })),
);
clearTimeout(killer);
const elapsedMs = Date.now() - t0;
// Let the provider record any late aborts, then stop it.
await new Promise((r) => setTimeout(r, 500));
fake.kill();

// Collect evidence.
const providerLines = readFileSync(fakeLog, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = existsSync(qwenHome) ? walk(qwenHome) : [];
const stallLines = [];
const retryWaitLines = [];
for (const f of files.filter((f) => f.includes(`${'/debug/'}`) && f.endsWith('.txt'))) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (/stalled|WORKFLOW_STALL/.test(line)) stallLines.push(line);
    if (/Retrying with backoff|Retry-After|Rate limit retry|time limit/i.test(line))
      retryWaitLines.push(line);
  }
}
const transcriptRetry = [];
for (const f of files.filter((f) => f.endsWith('.jsonl'))) {
  const text = readFileSync(f, 'utf8');
  for (const line of text.split('\n')) {
    if (line.includes('agent_retry')) transcriptRetry.push({ file: f.slice(qwenHome.length), line: line.slice(0, 300) });
  }
}
const summary = {
  arm: armDir,
  scenario: name,
  exit,
  elapsedMs,
  sigintAt,
  stdout: stdout.trim().slice(-2000),
  stderrTail: stderr.trim().slice(-1500),
  provider: providerLines,
  stallLines,
  retryWaitLines: retryWaitLines.slice(0, 20),
  transcriptRetry,
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
const childReqs = providerLines.filter((l) => l.kind === 'child');
const byChild = {};
for (const r of childReqs) (byChild[r.child] ??= []).push(`${r.t}ms:${r.action}`);
console.log(
  JSON.stringify(
    {
      scenario: name,
      arm: armDir.split('/').pop(),
      exit,
      elapsedMs,
      sigintAt,
      byChild,
      aborts: providerLines.filter((l) => l.kind === 'child-abort'),
      stallRetries: stallLines.filter((l) => /retrying/.test(l)).length,
      stalledAll: stallLines.some((l) => /stalled on all/.test(l)),
      transcriptRetryMarkers: transcriptRetry.length,
      stdout: stdout.trim().slice(-300),
    },
    null,
    1,
  ),
);
