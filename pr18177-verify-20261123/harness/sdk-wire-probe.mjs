// VERIFY-18177 SDK wire probe: does the real @qwen-code/sdk DaemonClient put
// `idempotencyKey` on the wire, and does the daemon dedupe a repeated call?
// A capture proxy sits between the client and the daemon and records every
// POST /session/:id/prompt body.
//
// Usage: ARM_DIR=<arm> PROBE_ROOT=<scratch> node sdk-wire-probe.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';

const ARM = process.env.DAEMON_ARM ?? process.env.ARM_DIR;
const SDK_ARM = process.env.SDK_ARM ?? ARM;
const ROOT = process.env.PROBE_ROOT;
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

const provider = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'probe provider fails' } }));
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const providerPort = provider.address().port;

writeFileSync(
  join(qwenHome, 'settings.json'),
  JSON.stringify({
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
  }),
);

const daemonPort = 23000 + (process.pid % 700);
const proxyPort = 24000 + (process.pid % 700);
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
    String(daemonPort),
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

const captured = [];
const proxy = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const isPrompt =
      req.method === 'POST' && /\/session\/[^/]+\/prompt(?:\?|$)/u.test(req.url);
    if (isPrompt) captured.push(body.toString('utf8'));
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: daemonPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${daemonPort}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      try {
        res.destroy();
      } catch {}
    });
    upstream.end(body);
  });
});
await new Promise((r) => proxy.listen(proxyPort, '127.0.0.1', r));

const stop = () => {
  try {
    daemon.kill('SIGKILL');
  } catch {}
  provider.close();
  proxy.close();
};
process.on('exit', stop);

async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${daemonPort}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let summary = { ok: false };
try {
  if (!(await waitForHealth()))
    throw new Error(`daemon unhealthy\n${daemonLog.join('')}`);

  const sdk = await import(
    `file://${join(SDK_ARM, 'packages/sdk-typescript/dist/daemon/index.js')}`
  );
  const { DaemonClient, DaemonSessionClient } = sdk;
  if (!DaemonSessionClient) {
    throw new Error(
      `DaemonSessionClient not exported; keys=${Object.keys(sdk).slice(0, 20)}`,
    );
  }
  const client = new DaemonClient({ baseUrl: `http://127.0.0.1:${proxyPort}` });
  const session = await DaemonSessionClient.createOrAttach(client, {
    workspaceCwd: workspace,
  });
  log(`SESSION ${JSON.stringify({ sessionId: session.sessionId })}`);

  const key = 'sdk-probe-key-1';
  const request = {
    prompt: [{ type: 'text', text: 'SDK-PROBE-18177 one message' }],
    idempotencyKey: key,
  };
  const first = await session.submitPrompt(request);
  log(`SDK#1 ${JSON.stringify(first)}`);
  const second = await session.submitPrompt(request);
  log(`SDK#2 ${JSON.stringify(second)}`);

  const capturedKeys = captured.map((body) => {
    try {
      return JSON.parse(body)?.idempotencyKey ?? null;
    } catch {
      return '<unparseable>';
    }
  });
  const parsedBodies = captured.map((body) => {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  });

  const transcriptRes = await fetch(
    `http://127.0.0.1:${daemonPort}/session/${encodeURIComponent(session.sessionId)}/transcript`,
  );
  const transcript = await transcriptRes.json();
  const blocks = transcript?.blocks ?? [];
  const userBlocks = blocks.filter(
    (b) => b && (b.kind === 'user' || b.role === 'user'),
  );

  summary = {
    ok: true,
    sessionId: session.sessionId,
    capturedPromptPosts: captured.length,
    capturedKeys,
    firstPromptId: first?.promptId ?? null,
    firstDeduplicated: first?.deduplicated ?? null,
    secondPromptId: second?.promptId ?? null,
    secondDeduplicated: second?.deduplicated ?? null,
    samePromptId: first?.promptId === second?.promptId,
    transcriptStatus: transcriptRes.status,
    userBlockCount: userBlocks.length,
    keyPresentInFirstBody: parsedBodies[0]
      ? Object.prototype.hasOwnProperty.call(
          parsedBodies[0],
          'idempotencyKey',
        )
      : null,
    otherFieldsInFirstBody: parsedBodies[0]
      ? Object.keys(parsedBodies[0]).sort()
      : null,
  };
  log(`SUMMARY ${JSON.stringify(summary)}`);
} catch (error) {
  summary = { ok: false, error: String(error) };
  log(`ERROR ${String(error)}`);
  log(`DAEMON_LOG ${daemonLog.join('').slice(-3000)}`);
} finally {
  writeFileSync(join(ROOT, 'summary.json'), JSON.stringify(summary, null, 2));
  stop();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
}