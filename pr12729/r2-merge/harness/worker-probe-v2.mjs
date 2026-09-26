// Boot v2 (managed-context/1) worker on the merge tree: installs a context
// for session-1, then sends Tool v3 requests with canaries; a v2 execute in
// the same session is the positive control. Env: REPO, OUT.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const REPO = process.env.REPO, OUT = process.env.OUT;
const v3 = JSON.parse(fs.readFileSync(`${REPO}/packages/core/src/managed-runtime/contracts/managed-tool-result-v1.fixtures.json`, 'utf8'));
const mc = JSON.parse(fs.readFileSync(`${REPO}/packages/cli/src/serve/contracts/managed-context-v1.fixtures.json`, 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr12729-v2-'));
fs.mkdirSync(path.join(root, 'services', 'api'), { recursive: true });
const cwd = path.join(fs.realpathSync.native(root), 'services', 'api');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pr12729-home-'));
const boot = { ...mc.boot, mountRoot: root };
const child = spawn(process.execPath, [`${REPO}/dist/cli.js`, 'managed-runtime-worker'], {
  env: { ...process.env, QWEN_HOME: home, QWEN_RUNTIME_DIR: path.join(home, 'rt') }, stdio: ['pipe', 'pipe', 'pipe'] });
fs.writeFileSync(`${OUT}/worker-v2.pid`, String(child.pid));
let stderr = ''; child.stderr.on('data', (d) => (stderr += d));
child.stdin.end(JSON.stringify(boot));
const ready = await new Promise((resolve, reject) => {
  readline.createInterface({ input: child.stdout }).once('line', (l) => resolve(JSON.parse(l)));
  child.once('exit', (c) => reject(new Error(`worker exited ${c}: ${stderr}`)));
  setTimeout(() => reject(new Error('no ready line')), 60000);
});
const H = { authorization: `Bearer ${boot.token}`, 'cache-control': 'no-store', 'content-type': 'application/json',
  'x-qwen-managed-lease-id': boot.leaseId, 'x-qwen-managed-lease-epoch': String(boot.epoch) };
const rows = [];
async function call(label, route, body, method = 'POST') {
  const res = await fetch(ready.url + route, { method, headers: H, body: method === 'POST' ? JSON.stringify(body) : undefined });
  const text = await res.text(); let code = '';
  try { const j = JSON.parse(text); code = j.error?.code ?? j.code ?? j.state ?? (j.protocolVersion ? 'ok' : ''); } catch {}
  rows.push({ label, status: res.status, bytes: text.length, code });
  return { status: res.status, text };
}
const install = mc.installationSequences.find((s) => s.id === 'installs-a-context').steps[0].request;
await call('v3 context install (declared on boot v2)', '/internal/managed-runtime/v3/context', install);
await call('v3 attest, empty body (declared on boot v2)', '/internal/managed-runtime/v3/attest', {});
const ref = (callId) => ({ sessionId: install.sessionId, promptId: 'prompt-1', callId, argsDigest: `digest-${callId}` });
for (const route of v3.routes) await call(`v3 canonical ${route.key}`, route.path, v3.requests[route.key]);
const v3exec = (name, id) => ({ ...v3.requests.execute, reference: ref(id), input: { command: `touch canary-${name}` } });
await call('v3 execute, session-1 (canary A)', '/internal/managed-runtime/v3/execute', v3exec('A', 'call-A'));
const v2exec = (name, id) => ({ protocolVersion: 2, reference: ref(id), toolName: 'run_shell_command', input: { command: `touch canary-${name}` } });
await call('v2 body -> v3 execute (canary B)', '/internal/managed-runtime/v3/execute', v2exec('B', 'call-B'));
await call('v3 body -> v2 execute (canary C)', '/internal/managed-runtime/v2/execute', v3exec('C', 'call-C'));
await new Promise((r) => setTimeout(r, 3000));
const before = Object.fromEntries(['A', 'B', 'C'].map((n) => [n, fs.existsSync(path.join(cwd, `canary-${n}`))]));
const pos = await call('v2 body -> v2 execute, session-1 (canary P, control)', '/internal/managed-runtime/v2/execute', v2exec('P', 'call-P'));
let state = JSON.parse(pos.text).state;
for (let i = 0; i < 60 && state !== 'settled'; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const s = await fetch(ready.url + '/internal/managed-runtime/v2/status', { method: 'POST', headers: H, body: JSON.stringify({ protocolVersion: 2, reference: ref('call-P') }) });
  state = (await s.json()).state;
}
rows.push({ label: 'control status after polling', status: '', code: state });
const result = { ready, rows, canariesAfterRefusals: before, control: fs.existsSync(path.join(cwd, 'canary-P')), listing: fs.readdirSync(cwd) };
fs.writeFileSync(`${OUT}/worker-probe-v2.json`, JSON.stringify(result, null, 2));
console.log('ready', JSON.stringify(ready));
for (const r of rows) console.log(String(r.status).padEnd(4), String(r.bytes ?? '').padEnd(5), String(r.code).padEnd(36), r.label);
console.log('canaries after refusals:', before, ' control:', result.control, ' dir:', result.listing);
child.kill('SIGTERM');
