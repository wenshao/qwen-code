// Drives the shipped worker (node dist/cli.js managed-runtime-worker) as an
// "old peer": every canonical Tool v3 request must get the gate's empty 404
// and leave no side effect; v3 bodies on v2 routes must get 400; a v2 body
// with the same command is the positive control that proves the canary works.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const REPO = process.env.REPO;
const OUT = process.env.OUT;
const v3 = JSON.parse(fs.readFileSync(`${REPO}/packages/core/src/managed-runtime/contracts/managed-tool-result-v1.fixtures.json`, 'utf8'));
const v2 = JSON.parse(fs.readFileSync(`${REPO}/packages/cli/src/serve/contracts/managed-runtime-tool-v2.fixtures.json`, 'utf8'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pr12729-ws-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pr12729-home-'));
const canaryDir = path.join(work, 'canaries');
fs.mkdirSync(canaryDir);

const boot = {
  type: 'boot', version: 1,
  capabilityDigest: `sha256:${'a'.repeat(64)}`, epoch: 4, isolationClass: 'workspace',
  leaseId: 'lease-01', provisionRequestId: 'provision-01', runtimeIncarnation: 'incarnation-01',
  runtimeInstanceId: 'runtime-01', tenantId: 'tenant-a', token: 'fixture-token',
  workspaceCwd: work, workspaceGeneration: '7', workspaceId: 'workspace-a',
};
const child = spawn(process.execPath, [`${REPO}/dist/cli.js`, 'managed-runtime-worker'], {
  env: { ...process.env, QWEN_HOME: home, QWEN_RUNTIME_DIR: path.join(home, 'rt') },
  stdio: ['pipe', 'pipe', 'pipe'],
});
fs.writeFileSync(`${OUT}/worker.pid`, String(child.pid));
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
child.stdin.end(JSON.stringify(boot));
const ready = await new Promise((resolve, reject) => {
  const rl = readline.createInterface({ input: child.stdout });
  rl.once('line', (l) => resolve(JSON.parse(l)));
  child.once('exit', (c) => reject(new Error(`worker exited ${c}: ${stderr}`)));
  setTimeout(() => reject(new Error('no ready line')), 60000);
});
const H = { ...v2.suites[0].canonicalRequest.headers };
const rows = [];
async function call(label, route, body, { method = 'POST', headers = H } = {}) {
  const res = await fetch(ready.url + route, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let code = '';
  try { const j = JSON.parse(text); code = j.error?.code ?? j.code ?? j.state ?? JSON.stringify(j).slice(0, 36); } catch {}
  const row = { label, method, route, status: res.status, bytes: text.length, contentType: res.headers.get('content-type') ?? '-', code };
  rows.push(row);
  return { res, text, row };
}
const canary = (name) => path.join(canaryDir, name);
const exists = (name) => fs.existsSync(canary(name));
const ref = (callId) => ({ ...v3.requests.execute.reference, callId });

// 1) canonical v3 requests, verbatim, on every v3 route
for (const route of v3.routes) await call(`v3 canonical ${route.key}`, route.path, v3.requests[route.key]);
// 2) a v3 execute whose command would leave a canary
const v3exec = (name, callId) => ({ ...v3.requests.execute, reference: ref(callId), input: { command: `touch ${canary(name)}` } });
await call('v3 execute (canary A)', '/internal/managed-runtime/v3/execute', v3exec('A', 'call-A'));
// other methods on a v3 path
for (const m of ['GET', 'PUT', 'OPTIONS', 'HEAD']) await call(`v3 ${m} execute`, '/internal/managed-runtime/v3/execute', null, { method: m });
// 3) v2 body on v3 route
const v2exec = (name, callId) => ({ protocolVersion: 2, reference: ref(callId), toolName: 'run_shell_command', input: { command: `touch ${canary(name)}` } });
await call('v2 body -> v3 execute (canary B)', '/internal/managed-runtime/v3/execute', v2exec('B', 'call-B'));
// 4) v3 bodies on v2 routes
await call('v3 body -> v2 execute (canary C)', '/internal/managed-runtime/v2/execute', v3exec('C', 'call-C'));
const { toolResult, capture, ...v3minusExtras } = v3exec('D', 'call-D');
await call('v3 body w/ protocolVersion 2 -> v2 execute (canary D)', '/internal/managed-runtime/v2/execute', { ...v3minusExtras, protocolVersion: 2, toolResult, capture });
await call('v2 body + toolResult only -> v2 execute (canary E)', '/internal/managed-runtime/v2/execute', { ...v2exec('E', 'call-E'), toolResult: 'managed-tool-result/1' });
for (const key of ['status', 'cancel']) await call(`v3 body -> v2 ${key}`, `/internal/managed-runtime/v2/${key}`, v3.requests[key]);
// give any stray execution time to land
await new Promise((r) => setTimeout(r, 3000));
const before = { A: exists('A'), B: exists('B'), C: exists('C'), D: exists('D'), E: exists('E') };
// 5) positive control: the same command as a v2 body on the v2 route executes
const pos = await call('v2 body -> v2 execute (canary P, control)', '/internal/managed-runtime/v2/execute', v2exec('P', 'call-P'));
let state = JSON.parse(pos.text).state;
for (let i = 0; i < 60 && state !== 'settled'; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const s = await fetch(ready.url + '/internal/managed-runtime/v2/status', { method: 'POST', headers: H, body: JSON.stringify({ protocolVersion: 2, reference: ref('call-P') }) });
  state = (await s.json()).state;
}
rows.push({ label: 'control status after polling', status: '', code: state });
const after = { P: exists('P') };
// status on the refused v2 calls: the worker holds no record of them
for (const id of ['call-C', 'call-D', 'call-E']) {
  const s = await fetch(ready.url + '/internal/managed-runtime/v2/status', { method: 'POST', headers: H, body: JSON.stringify({ protocolVersion: 2, reference: ref(id) }) });
  rows.push({ label: `v2 status of refused ${id}`, status: s.status, code: (await s.json()).state });
}
const result = { ready, rows, canariesAfterRefusals: before, controlCanary: after, canaryDirListing: fs.readdirSync(canaryDir), workerStderrBytes: stderr.length };
fs.writeFileSync(`${OUT}/worker-probe.json`, JSON.stringify(result, null, 2));
for (const r of rows) console.log(String(r.status).padEnd(4), String(r.bytes ?? '').padEnd(5), String(r.contentType ?? '').slice(0, 24).padEnd(25), String(r.code).padEnd(36), r.label);
console.log('canaries after refusals:', before, ' control canary:', after, ' dir:', fs.readdirSync(canaryDir));
child.kill('SIGTERM');
