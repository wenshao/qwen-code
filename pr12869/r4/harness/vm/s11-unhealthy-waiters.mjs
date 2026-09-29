// The F1 fix serves waiters of a HEALTHY observation. These probes check the other side on the real server:
//   dead    - the worker is SIGKILLed, then warm/acquire are fired back to back across two scans: none may be served
//   revoked - the binding stays healthy, but the Session loses its access: none may be served
import * as d from './drive.mjs';
import fs from 'node:fs';
const [mode, storage = 'a', seconds = '12'] = process.argv.slice(2);
const say = (...a) => console.log(d.now(), `[${mode}]`, ...a);
const ws = `ws-${storage}`;
try { d.seed(ws, `st-${storage}`); } catch { /* seeded */ }
const sid = await d.createSession(ws);
const first = `rs-first-${sid.slice(-6)}`;
const w0 = await d.warm(sid); const a0 = await d.acquire(sid, first);
const c0 = await d.create(sid, first, 'call-before', 'echo before > before.txt');
for (let i = 0; i < 40; i++) { const s = await d.status(sid, first, c0.json.executionCallId); if (s.json?.status?.state === 'settled') break; await d.sleep(100); }
const r0 = await d.release(sid, first);
say(`healthy start: warm ${w0.status}, acquire ${a0.status}, execute ${c0.status}, release ${r0.status}`);
const binding = () => d.sql(`SELECT binding_id, binding_state, runtime_generation, IF(loss_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.source'))), IF(stop_evidence_json IS NULL,'-','stop proof'), JSON_UNQUOTE(JSON_EXTRACT(resource_handle_json,'$.resourceId')) FROM qwen_runtime_binding WHERE isolation_key='${sid}' ORDER BY runtime_generation`);
const b0 = binding()[0];
const reg = JSON.parse(fs.readFileSync(`/var/lib/qwen-rt/${d.DB}/${b0[5]}.json`, 'utf8'));
const workersNow = () => d.workers().split('\n').filter((l) => l.includes('managed-runtime-worker')).map((l) => Number(l.trim().split(/\s+/)[0]));
const before = workersNow();
if (mode === 'dead') {
  process.kill(reg.pid, 'SIGKILL');
  say(`worker pid ${reg.pid} SIGKILLed; firing warm and acquire for ${seconds} s`);
} else {
  d.sql(`DELETE FROM managed_workspace_access WHERE tenant_id='${d.TENANT}' AND workspace_id='${ws}'`);
  say(`access of the Session's actor revoked (binding stays healthy); firing warm and acquire for ${seconds} s`);
}
const end = Date.now() + Number(seconds) * 1000;
const tally = { warm: {}, acquire: {} }; const served = []; let n = 0;
const key = (r) => (r.status === 200 ? '200' : `${r.status} ${r.json?.code ?? JSON.stringify(r.json).slice(0, 60)}`);
async function loop(kind) {
  while (Date.now() < end) {
    const r = kind === 'warm' ? await d.warm(sid, { timeoutMs: 20000 }) : await d.acquire(sid, `rs-${mode}-${n++}`, { timeoutMs: 20000 });
    tally[kind][key(r)] = (tally[kind][key(r)] ?? 0) + 1;
    if (r.status === 200) served.push({ at: d.now(), kind });
    await d.sleep(3);
  }
}
await Promise.all([loop('warm'), loop('warm'), loop('acquire'), loop('acquire')]);
const scans = d.sql(`SELECT operation_generation, record_version FROM qwen_runtime_binding WHERE binding_id='${b0[0]}'`)[0];
say('answers:', JSON.stringify(tally));
say(`served while it must not be: ${served.length}`, served.length ? JSON.stringify(served.slice(0, 5)) : '');
say('binding now:', JSON.stringify(binding().map((r) => `gen ${r[2]} ${r[1]} loss=${r[3]} ${r[4]}`)), `operation_generation=${scans[0]}`);
const after = workersNow();
say(`worker processes before ${JSON.stringify(before)} after ${JSON.stringify(after)}; new workers: ${after.filter((p) => !before.includes(p)).length}`);
say('holders of this Session:', d.sql(`SELECT COUNT(*) FROM managed_workspace_execution_lease WHERE binding_id='${b0[0]}' AND holder_key IS NOT NULL`)[0][0],
  '| runtime sessions not released:', d.sql(`SELECT COUNT(*) FROM qwen_runtime_session WHERE binding_id='${b0[0]}' AND session_state <> 'RELEASED'`)[0][0]);
