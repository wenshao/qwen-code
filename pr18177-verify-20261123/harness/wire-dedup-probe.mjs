// VERIFY-18177 wire probe: does POST /session/:id/prompt deduplicate a
// repeated `idempotencyKey`? Runs the arm's own built daemon, a scripted
// OpenAI-compatible provider that fails every turn fast (so the transcript
// still records admissions), and three byte-identical prompt POSTs.
//
// Usage: ARM_DIR=<arm> PROBE_ROOT=<scratch> node wire-dedup-probe.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';

const ARM = process.env.ARM_DIR;
const ROOT = process.env.PROBE_ROOT;
const LABEL = process.env.PROBE_LABEL ?? 'arm';
const KEY = process.env.PROBE_KEY ?? 'probe-idempotency-key-1';
if (!ARM || !ROOT) throw new Error('ARM_DIR and PROBE_ROOT are required');

const logFile = join(ROOT, 'probe.log');
const log = (line) => {
  appendFileSync(logFile, `${line}\n`);
  console.log(line);
};

rmSync(ROOT, { recursive: true, force: true });
const home = join(ROOT, 'home');
const qwenHome = join(home, '.qwen');
const workspace = join(ROOT, 'workspace');
mkdirSync(qwenHome, { recursive: true });
mkdirSync(workspace, { recursive: true });

// A provider that fails every turn immediately: enough for the daemon to
// admit (202) and record the user message, without waiting on a model.
const provider = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'probe provider always fails', type: 'probe' },
      }),
    );
  });
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const providerPort = provider.address().port;

writeFileSync(
  join(qwenHome, 'settings.json'),
  JSON.stringify(
    {
      security: { auth: { selectedType: 'openai' } },
      model: { name: 'probe-model' },
      telemetry: { enabled: false },
      modelProviders: {
        openai: [
          {
            id: 'probe-model',
            envKey: 'OPENAI_API_KEY',
            baseUrl: `http://127.0.0.1:${providerPort}/v1`,
            generationConfig: { contextWindowSize: 32768 },
          },
        ],
      },
    },
    null,
    2,
  ),
);

const port = 21000 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;
const env = {
  PATH: process.env.PATH,
  HOME: home,
  QWEN_HOME: qwenHome,
  QWEN_RUNTIME_DIR: qwenHome,
  OPENAI_API_KEY: 'probe-key',
  NO_COLOR: '1',
  TERM: 'dumb',
};

const daemon = spawn(
  process.execPath,
  [
    join(ARM, 'packages/cli/dist/index.js'),
    'serve',
    '--port',
    String(port),
    '--hostname',
    '127.0.0.1',
    '--workspace',
    workspace,
  ],
  { env, stdio: ['ignore', 'pipe', 'pipe'] },
);
const daemonLog = [];
daemon.stdout.on('data', (d) => daemonLog.push(String(d)));
daemon.stderr.on('data', (d) => daemonLog.push(String(d)));
const stop = () => {
  try {
    daemon.kill('SIGKILL');
  } catch {}
  provider.close();
};
process.on('exit', stop);

async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function jsonFetch(path, init) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

let summary = { label: LABEL, arm: ARM, ok: false };
try {
  const healthy = await waitForHealth();
  if (!healthy) throw new Error(`daemon never became healthy\n${daemonLog.join('')}`);
  const created = await jsonFetch('/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceCwd: workspace }),
  });
  log(`SESSION status=${created.status} body=${JSON.stringify(created.body).slice(0, 400)}`);
  const sessionId = created.body?.sessionId;
  if (!sessionId) throw new Error('no sessionId from POST /session');

  const promptBody = JSON.stringify({
    prompt: [{ type: 'text', text: `PROBE-18177-${LABEL} one message` }],
    idempotencyKey: KEY,
  });
  const posts = [];
  for (let i = 1; i <= 3; i += 1) {
    const r = await jsonFetch(`/session/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: promptBody,
    });
    posts.push(r);
    log(
      `POST#${i} status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`,
    );
    await new Promise((r2) => setTimeout(r2, 150));
  }

  const promptIds = posts.map((p) => p.body?.promptId ?? null);
  const dedupFlags = posts.map((p) => p.body?.deduplicated ?? null);
  const distinctPromptIds = new Set(promptIds.filter(Boolean)).size;

  // Give admissions a moment to land in the transcript.
  await new Promise((r) => setTimeout(r, 1200));
  const transcript = await jsonFetch(
    `/session/${encodeURIComponent(sessionId)}/transcript?eventDetailMode=full`,
  );
  const raw = JSON.stringify(transcript.body ?? '');
  const blocks =
    transcript.body?.blocks ??
    transcript.body?.transcript?.blocks ??
    transcript.body?.events ??
    [];
  const userBlocks = blocks.filter(
    (b) => b && (b.kind === 'user' || b.role === 'user'),
  );
  const targetBlocks = userBlocks.filter((b) =>
    JSON.stringify(b).includes(`PROBE-18177-${LABEL}`),
  );

  summary = {
    label: LABEL,
    arm: ARM,
    ok: true,
    sessionId,
    key: KEY,
    statuses: posts.map((p) => p.status),
    promptIds,
    dedupFlags,
    distinctPromptIds,
    transcriptStatus: transcript.status,
    userBlockCount: userBlocks.length,
    targetUserBlockCount: targetBlocks.length,
    targetPromptIds: targetBlocks.map((b) => b.promptId ?? null),
    rawHasDeduplicated: raw.includes('deduplicated'),
  };
  log(`SUMMARY ${JSON.stringify(summary)}`);
} catch (error) {
  summary = { label: LABEL, arm: ARM, ok: false, error: String(error) };
  log(`ERROR ${String(error)}`);
  log(`DAEMON_LOG ${daemonLog.join('').slice(-3000)}`);
} finally {
  writeFileSync(join(ROOT, 'summary.json'), JSON.stringify(summary, null, 2));
  stop();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
}