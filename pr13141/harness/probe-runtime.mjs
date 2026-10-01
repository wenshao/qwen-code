// Runtime truth matrix for the `qwen serve` Broker options (PR #13141).
// Usage: node probe-runtime.mjs <tree> <out.json>
// Starts the real CLI through the shipped bin (scripts/cli-entry.js) with each
// flag combination, records whether startup is refused or listens, and for
// listening Harnesses probes the /session tool-profile gate.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [tree, outFile] = process.argv.slice(2);
if (!tree || !outFile) throw new Error('usage: probe-runtime.mjs <tree> <out.json>');
const BIN = path.join(tree, 'scripts', 'cli-entry.js');
const TOKEN = 'probe-serve-token';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const BROKER_URL = 'http://127.0.0.1:4182';
const BROKER_TOKEN = 'probe-broker-token';

const hosted = [
  'serve', '--profile', 'hosted-harness', '--http-bridge', '--no-web',
  '--hostname', '127.0.0.1', '--port', '0', '--token', TOKEN,
  '--hosted-harness-capability-digest', DIGEST,
];
const plain = ['serve', '--http-bridge', '--no-web', '--hostname', '127.0.0.1', '--port', '0', '--token', TOKEN];
const url = (u = BROKER_URL) => ['--managed-runtime-broker-url', u];
const tok = (t = BROKER_TOKEN) => ['--managed-runtime-broker-token', t];

const CASES = [
  { id: 'S1', label: 'hosted-harness, no Broker options', args: [...hosted] },
  { id: 'S2', label: 'hosted-harness, URL + token', args: [...hosted, ...url(), ...tok()] },
  { id: 'S3', label: 'hosted-harness, URL only', args: [...hosted, ...url()] },
  { id: 'S4', label: 'hosted-harness, token only', args: [...hosted, ...tok()] },
  { id: 'S5', label: 'hosted-harness, URL + blank token', args: [...hosted, ...url(), ...tok('   ')] },
  { id: 'S6', label: 'no profile, URL + token', args: [...plain, ...url(), ...tok()] },
  { id: 'S7', label: 'hosted-harness, non-loopback http URL + token', args: [...hosted, ...url('http://broker.example:4182'), ...tok()] },
  { id: 'S8', label: 'hosted-harness, non-loopback https URL + token', args: [...hosted, ...url('https://broker.example'), ...tok()] },
  { id: 'S9', label: 'hosted-harness, --experimental-managed-runtime-url (untouched option)', args: [...hosted, '--experimental-managed-runtime-url', 'http://127.0.0.1:3001'] },
];

const PROFILES = [
  'hosted-workspace-files/1',
  'hosted-workspace-shell/1',
  'hosted-workspace-mcp/1',
  undefined, // no-tool creation
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCase(c) {
  const root = mkdtempSync(path.join(tmpdir(), `p13141-${c.id}-`));
  const home = path.join(root, 'home');
  const ws = path.join(root, 'ws');
  mkdirSync(path.join(home, '.qwen'), { recursive: true });
  mkdirSync(ws);
  const args = [...c.args, '--workspace', ws];
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd: ws,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      QWEN_HOME: path.join(home, '.qwen'),
      QWEN_RUNTIME_DIR: path.join(root, 'runtime'),
      TMPDIR: root,
      OPENAI_API_KEY: 'probe-key',
      OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
      OPENAI_MODEL: 'probe',
      QWEN_SANDBOX: 'false',
      NO_COLOR: '1',
    },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  let exitCode = null;
  const exited = new Promise((r) => child.once('exit', (code, sig) => { exitCode = code ?? sig; r(); }));
  const started = Date.now();
  let port;
  while (Date.now() - started < 45_000) {
    const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) { port = Number(m[1]); break; }
    if (exitCode !== null) break;
    await sleep(100);
  }
  const result = {
    id: c.id,
    label: c.label,
    argv: ['qwen', ...c.args.map((a) => (a === TOKEN ? '<token>' : a))].join(' '),
    outcome: port ? 'listening' : exitCode !== null ? 'refused' : 'timeout',
    exitCode,
    ms: Date.now() - started,
    message: undefined,
    requests: [],
  };
  if (!port) {
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    result.message = lines.find((l) => /Error|error|requires|not implemented|must/.test(l)) ?? lines.slice(-3).join(' | ');
  } else {
    const base = `http://127.0.0.1:${port}`;
    const auth = { authorization: `Bearer ${TOKEN}` };
    // Wait for capabilities to become ready (503 while booting).
    let capStatus;
    let bootId;
    for (let i = 0; i < 100; i++) {
      const r = await fetch(`${base}/capabilities`, { headers: auth }).catch(() => undefined);
      capStatus = r?.status;
      bootId = r?.headers.get('x-qwen-harness-boot-id') ?? undefined;
      if (r && r.status !== 503) break;
      await sleep(200);
    }
    result.capabilities = capStatus;
    result.bootId = bootId;
    auth['x-qwen-harness-protocol-version'] = '1';
    // The contract middleware stamps the boot id on every response it covers.
    const stamp = await fetch(`${base}/session`, { method: 'POST', headers: auth });
    bootId = stamp.headers.get('x-qwen-harness-boot-id') ?? bootId;
    result.bootId = bootId;
    if (bootId) auth['x-qwen-harness-boot-id'] = bootId;
    for (const toolProfile of PROFILES) {
      const body = { sessionId: randomUUID(), sessionScope: 'thread', ...(toolProfile ? { toolProfile } : {}) };
      const r = await fetch(`${base}/session`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let code = text;
      try { const j = JSON.parse(text); code = j.code ?? j.error ?? text; } catch {}
      result.requests.push({ toolProfile: toolProfile ?? '(none: no-tool turn)', status: r.status, code: String(code).slice(0, 80) });
    }
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await Promise.race([exited, sleep(5000)]);
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  writeFileSync(path.join(root, 'output.log'), out);
  result.log = path.join(root, 'output.log');
  return result;
}

const results = [];
for (const c of CASES) {
  const r = await runCase(c);
  results.push(r);
  console.log(`${r.id} ${r.outcome.padEnd(9)} exit=${r.exitCode} ${r.ms}ms  ${r.label}`);
  if (r.message) console.log(`   -> ${r.message}`);
  for (const q of r.requests) console.log(`   POST /session toolProfile=${q.toolProfile} -> ${q.status} ${q.code}`);
}
writeFileSync(outFile, JSON.stringify({ tree, node: process.version, results }, null, 2));
