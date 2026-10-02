// Round-3 probe for PR #13141: is "for Workspace tool turns" still the complete
// scope of the two Broker flags, now that main has merged durable Hosted Hooks
// (H2, 3f56f74a6a) and Hosted Turn takeover / G1 failover (728c13de21)?
//
// The help text under test is a scope claim. A scope claim is falsified by
// finding a session that needs the Broker pair but is NOT a Workspace tool
// turn. Hooks are the candidate: hosted-harness-session.ts throws
// "Hooks require a Hosted Workspace profile." when brokerOptions is absent,
// so H2 is a second consumer of the same two flags.
//
// This drives the real CLI through scripts/cli-entry.js and POSTs /session
// bodies at the real gate. No mocks. Expectations are encoded as assertions,
// so a cell that behaves unexpectedly makes the harness exit non-zero.
//
// Usage: node probe-hooks.mjs <tree> <out.json>
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [tree, outFile] = process.argv.slice(2);
if (!tree || !outFile)
  throw new Error('usage: probe-hooks.mjs <tree> <out.json>');
const BIN = path.join(tree, 'scripts', 'cli-entry.js');
const TOKEN = 'probe-serve-token';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const BROKER_URL = 'http://127.0.0.1:4182';
const BROKER_TOKEN = 'probe-broker-token';
const FILES = 'hosted-workspace-files/1';
// Valid per parseHostedHookPin: exactly these three keys, catalogId charset,
// revision a safe integer >= 1, definitionDigest 64 lowercase hex.
const PIN = {
  catalogId: 'probe.catalog',
  catalogRevision: 1,
  definitionDigest: 'b'.repeat(64),
};

const hosted = [
  'serve',
  '--profile',
  'hosted-harness',
  '--http-bridge',
  '--no-web',
  '--hostname',
  '127.0.0.1',
  '--port',
  '0',
  '--token',
  TOKEN,
  '--hosted-harness-capability-digest',
  DIGEST,
];
const brokerFlags = [
  '--managed-runtime-broker-url',
  BROKER_URL,
  '--managed-runtime-broker-token',
  BROKER_TOKEN,
];

// Arm B (broker configured) is where the hook gate is reachable at all: arm A
// trips the earlier tool-profile gate first, which is itself the evidence that
// no-Broker means no-Hooks.
const ARMS = [
  { id: 'A', label: 'hosted-harness, no Broker options', args: [...hosted] },
  { id: 'B', label: 'hosted-harness, URL + token', args: [...hosted, ...brokerFlags] },
];

// `expect` is the code the gate must return. `why` names the help-text claim
// the cell adjudicates.
const CELLS = [
  {
    id: 'H1',
    arm: 'A',
    body: { toolProfile: FILES, hookCatalog: PIN },
    expect: 'hosted_tool_profile_unavailable',
    why: 'no Broker pair => no Workspace tool turn, hooks included',
  },
  {
    id: 'H2',
    arm: 'A',
    body: { hookCatalog: PIN },
    expect: 'invalid_hosted_hook_catalog',
    why: 'no Broker pair => hook catalog rejected outright',
  },
  {
    id: 'H3',
    arm: 'B',
    body: { toolProfile: FILES, hookCatalog: PIN },
    expect: 'invalid_managed_session_store',
    why: 'Broker pair + files profile => BOTH the tool gate and the hook gate pass; only the (unconfigured) session store stops it',
  },
  {
    id: 'H4',
    arm: 'B',
    body: { hookCatalog: PIN },
    expect: 'invalid_hosted_hook_catalog',
    why: 'DECISIVE: Broker pair present but no Workspace tool profile => hooks still refused, so the flags are never needed outside a tool turn',
  },
  {
    id: 'H5',
    arm: 'B',
    body: { toolProfile: FILES },
    expect: 'invalid_managed_session_store',
    why: 'control: the H3 result comes from the hook gate passing, not from hooks being ignored',
  },
  {
    id: 'H6',
    arm: 'B',
    body: {},
    expect: 'invalid_managed_session_store',
    why: 'control: a no-tool Session still gets past the tool gate with the Broker pair (round 1 S2)',
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startArm(arm) {
  const root = mkdtempSync(path.join(tmpdir(), `p13141h-${arm.id}-`));
  const home = path.join(root, 'home');
  const ws = path.join(root, 'ws');
  mkdirSync(path.join(home, '.qwen'), { recursive: true });
  mkdirSync(ws);
  const child = spawn(process.execPath, [BIN, ...arm.args, '--workspace', ws], {
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
  const exited = new Promise((r) =>
    child.once('exit', (code, sig) => {
      exitCode = code ?? sig;
      r();
    }),
  );
  const started = Date.now();
  let port;
  while (Date.now() - started < 60_000) {
    const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) {
      port = Number(m[1]);
      break;
    }
    if (exitCode !== null) break;
    await sleep(100);
  }
  if (!port) {
    writeFileSync(path.join(root, 'output.log'), out);
    return { arm, port: null, exitCode, out, child, exited, root };
  }
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${TOKEN}` };
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`${base}/capabilities`, { headers: auth }).catch(() => undefined);
    if (r && r.status !== 503) break;
    await sleep(200);
  }
  auth['x-qwen-harness-protocol-version'] = '1';
  const stamp = await fetch(`${base}/session`, { method: 'POST', headers: auth });
  const bootId = stamp.headers.get('x-qwen-harness-boot-id') ?? undefined;
  if (bootId) auth['x-qwen-harness-boot-id'] = bootId;
  return { arm, port, base, auth, exitCode: null, out, child, exited, root };
}

const results = [];
let pass = 0;
let fail = 0;

for (const arm of ARMS) {
  const h = await startArm(arm);
  console.log(`arm ${arm.id}: ${arm.label} -> ${h.port ? 'listening on :' + h.port : 'NOT LISTENING exit=' + h.exitCode}`);
  if (!h.port) {
    for (const c of CELLS.filter((c) => c.arm === arm.id)) {
      results.push({ ...c, arm: arm.id, status: null, code: '(arm never listened)', ok: false });
      fail++;
      console.log(`  ${c.id} FAIL arm never listened`);
    }
    continue;
  }
  for (const c of CELLS.filter((c) => c.arm === arm.id)) {
    const body = { sessionId: randomUUID(), sessionScope: 'thread', ...c.body };
    const r = await fetch(`${h.base}/session`, {
      method: 'POST',
      headers: { ...h.auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let code = text;
    try {
      const j = JSON.parse(text);
      code = j.code ?? j.error ?? text;
    } catch {
      /* non-JSON body: keep raw text */
    }
    code = String(code).slice(0, 80);
    const ok = code === c.expect;
    if (ok) pass++;
    else fail++;
    results.push({ ...c, arm: arm.id, status: r.status, code, ok });
    console.log(
      `  ${c.id} ${ok ? 'PASS' : 'FAIL'} POST /session ${JSON.stringify(c.body)} -> ${r.status} ${code}${ok ? '' : ` (expected ${c.expect})`}`,
    );
    console.log(`       why: ${c.why}`);
  }
  try {
    process.kill(-h.child.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  await Promise.race([h.exited, sleep(5000)]);
  try {
    process.kill(-h.child.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  writeFileSync(path.join(h.root, 'output.log'), h.out);
}

writeFileSync(
  outFile,
  JSON.stringify({ tree, node: process.version, pass, fail, results }, null, 2),
);
console.log(`\nhook-scope probe: ${pass} passed, ${fail} failed, ${results.length} cells`);
process.exit(fail === 0 ? 0 : 1);
