// Real-process E2E for `qwen managed-runtime-worker` (PR #12506).
// usage: node e2e.mjs <entry.js> [label]
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';

const ENTRY = process.argv[2];
const LABEL = process.argv[3] ?? ENTRY;
const TOKEN = 'tok-SECRET-12506-' + 'x'.repeat(8);
const boot = {
  type: 'boot', version: 1, token: TOKEN,
  runtimeInstanceId: 'ri-1', runtimeIncarnation: 'inc-1', leaseId: 'lease-1', epoch: 7,
  provisionRequestId: 'prov-1', tenantId: 'tenant-1', workspaceId: 'ws-1',
  workspaceGeneration: 'gen-1', workspaceCwd: '/workspace/project',
  capabilityDigest: 'sha256:' + 'a'.repeat(64), isolationClass: 'workspace',
};
const results = [];
console.error('start', ENTRY);
let n = 0;

function launch(args = [], { strace = true, env = {} } = {}) {
  const tr = `/tmp/claude-strace-12506-${process.pid}-${n++}.log`;
  const cmd = strace ? '/usr/bin/strace' : process.execPath;
  const argv = strace
    ? ['-f', '-qq', '-e', 'trace=bind,listen', '-o', tr, process.execPath, ENTRY, 'managed-runtime-worker', ...args]
    : [ENTRY, 'managed-runtime-worker', ...args];
  const env2 = { ...process.env, NO_COLOR: '1', ...env };
  const child = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'], env: env2 });
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', (c) => (out.stdout += c));
  child.stderr.on('data', (c) => (out.stderr += c));
  const exited = new Promise((r) => child.once('exit', (code, sig) => r({ code, sig })));
  const t0 = Date.now();
  return { child, out, exited, tr, t0 };
}
function listens(tr) {
  if (!existsSync(tr)) return 'n/a';
  const s = readFileSync(tr, 'utf8');
  rmSync(tr, { force: true });
  return (s.match(/\blisten\(/g) || []).length;
}
async function waitLine(h, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const i = h.out.stdout.indexOf('\n');
    if (i >= 0) return h.out.stdout.slice(0, i);
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}
function req(url, { method = 'POST', path = '/internal/managed-runtime/v2/attest', token = TOKEN, body, headers = {}, agent } = {}) {
  const u = new URL(url);
  const payload = body ?? JSON.stringify({
    protocolVersion: 2, provisionRequestId: boot.provisionRequestId, tenantId: boot.tenantId,
    workspaceId: boot.workspaceId, workspaceGeneration: boot.workspaceGeneration,
    workspaceCwd: boot.workspaceCwd, capabilityDigest: boot.capabilityDigest, isolationClass: boot.isolationClass,
  });
  return new Promise((resolve) => {
    const r = http.request({ host: u.hostname, port: u.port, method, path, agent,
      headers: { authorization: `Bearer ${token}`, 'cache-control': 'no-store', 'content-type': 'application/json',
        'x-qwen-managed-lease-id': boot.leaseId, 'x-qwen-managed-lease-epoch': String(boot.epoch), ...headers } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, cc: res.headers['cache-control'], xpb: res.headers['x-powered-by'], body: b })); });
    r.on('error', (e) => resolve({ status: 'ERR ' + e.code }));
    if (method !== 'GET') r.end(payload); else r.end();
  });
}
function rec(o) { results.push(o); console.log(JSON.stringify(o)); }

// ---- 1. happy path + SIGTERM / SIGINT ----
for (const sig of ['SIGTERM', 'SIGINT']) {
  const h = launch([], { strace: false });
  h.child.stdin.end(JSON.stringify(boot));
  const line = await waitLine(h);
  const readyMs = Date.now() - h.t0;
  const ready = JSON.parse(line);
  const ok = await req(ready.url);
  const wrong = await req(ready.url, { token: 'nope' });
  const nf = await req(ready.url, { method: 'GET', path: '/health' });
  const q = await req(ready.url, { path: '/internal/managed-runtime/v2/attest?x=1' });
  // hold a keep-alive connection open, then signal
  const agent = new http.Agent({ keepAlive: true });
  await req(ready.url, { agent });
  const sock = net.connect(Number(new URL(ready.url).port), '127.0.0.1'); // idle raw socket
  await new Promise((r) => sock.once('connect', r));
  sock.on('error', () => {});
  const tk = Date.now();
  h.child.kill(sig);
  const ex = await h.exited;
  rec({ case: `happy+${sig}`, readyMs, readyKeys: Object.keys(ready).join(','), url: ready.url,
    stdoutLines: h.out.stdout.split('\n').filter(Boolean).length,
    tokenInStdout: h.out.stdout.includes(TOKEN), tokenInStderr: h.out.stderr.includes(TOKEN),
    attest: `${ok.status} cc=${ok.cc} xpb=${ok.xpb ?? '-'}`, attestBody: ok.body,
    wrongToken: `${wrong.status} cc=${wrong.cc}`, get404: `${nf.status} cc=${nf.cc}`, query: `${q.status}`,
    exit: ex, exitMs: Date.now() - tk, listen: listens(h.tr), stderr: h.out.stderr.trim().slice(0, 200) });
  agent.destroy();
}

// ---- 2. rejection matrix ----
const valid = JSON.stringify(boot);
const pad32k = valid + ' '.repeat(32 * 1024 - Buffer.byteLength(valid));
const cases = [
  ['empty stdin', ''],
  ['malformed JSON', '{"type":"boot",'],
  ['unknown field', JSON.stringify({ ...boot, extra: 1 })],
  ['missing field', JSON.stringify({ ...boot, tenantId: undefined })],
  ['version 2', JSON.stringify({ ...boot, version: 2 })],
  ['epoch 0', JSON.stringify({ ...boot, epoch: 0 })],
  ['empty token', JSON.stringify({ ...boot, token: '' })],
  ['bad digest', JSON.stringify({ ...boot, capabilityDigest: 'sha256:zz' })],
  ['array', '[]'],
  ['32 KiB + 1', pad32k + ' '],
  ['1 MiB', valid + ' '.repeat(1 << 20)],
  ['response > 16 KiB', JSON.stringify({ ...boot, workspaceCwd: '/' + 'w'.repeat(17000) })],
];
for (const [name, payload] of cases) {
  const h = launch();
  h.child.stdin.on('error', () => {});
  h.child.stdin.end(payload);
  const ex = await Promise.race([h.exited, new Promise((r) => setTimeout(() => r('TIMEOUT'), 20000))]);
  if (ex === 'TIMEOUT') h.child.kill('SIGKILL');
  rec({ case: name, bytes: Buffer.byteLength(payload), exit: ex, stdout: h.out.stdout, listen: listens(h.tr),
    tokenInStderr: h.out.stderr.includes(TOKEN), stderr1: h.out.stderr.trim().split('\n').slice(0, 2).join(' | ') });
}
// exactly 32 KiB accepted
{
  const h = launch([], { strace: false });
  h.child.stdin.end(pad32k);
  const line = await waitLine(h);
  h.child.kill('SIGTERM');
  const ex = await h.exited;
  rec({ case: 'exactly 32 KiB', bytes: Buffer.byteLength(pad32k), ready: !!line, exit: ex, listen: listens(h.tr) });
}
// ---- 3. extra argv ----
for (const args of [['--help'], ['extra'], ['--debug'], ['-v'], ['--version']]) {
  const h = launch(args);
  h.child.stdin.on('error', () => {});
  h.child.stdin.end(valid);
  const ex = await Promise.race([h.exited, new Promise((r) => setTimeout(() => r('TIMEOUT'), 20000))]);
  if (ex === 'TIMEOUT') h.child.kill('SIGKILL');
  rec({ case: `argv ${args.join(' ')}`, exit: ex, stdout: h.out.stdout.trim(), listen: listens(h.tr), stderr1: h.out.stderr.trim().split('\n')[0] });
}
// ---- 4. stdin never closed (provisioner stalls) ----
{
  const h = launch([], { strace: false });
  h.child.stdin.write(valid); // written but never closed
  await new Promise((r) => setTimeout(r, 10000));
  const alive = h.child.exitCode === null;
  h.child.kill('SIGTERM');
  const ex = await h.exited;
  rec({ case: 'stdin left open 10s', aliveAfter10s: alive, stdout: h.out.stdout, exitOnSigterm: ex, listen: listens(h.tr) });
}
console.log('SUMMARY ' + LABEL + ' ' + results.length + ' cases');
