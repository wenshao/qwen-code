// Healthy traffic, one Hosted tool turn = warm + acquire(new Runtime Session) + execute + release.
import * as d from './drive.mjs';
import fs from 'node:fs';
const [label, armName, seconds = '120', tag = 'arm'] = process.argv.slice(2);
const arm = armName.startsWith('sid:') ? { sid: armName.slice(4) } : JSON.parse(fs.readFileSync(`/rig/out/${label}-arms.json`, 'utf8')).arms[armName];
const end = Date.now() + Number(seconds) * 1000;
const tally = { warm: {}, acquire: {}, execute: {}, release: {} }; const failures = [];
const key = (r) => (r.status === 200 ? '200' : `${r.status} ${r.json?.code ?? JSON.stringify(r.json).slice(0, 60)}`);
const note = (kind, r, turn) => { const k = key(r); tally[kind][k] = (tally[kind][k] ?? 0) + 1;
  if (r.status !== 200) failures.push({ at: d.now(), turn, step: kind, status: r.status, code: r.json?.code, message: r.json?.error, ms: r.ms }); return r.status === 200; };
let turn = 0;
// release whatever Runtime Session the arm still holds from an earlier script
for (const row of d.sql(`SELECT runtime_session_id FROM qwen_runtime_session WHERE harness_session_id='${arm.sid}' AND session_state IN ('READY','ACQUIRING')`)) await d.release(arm.sid, row[0]);
while (Date.now() < end) {
  turn++;
  const rsid = `turn-${tag}-${turn}`;
  if (!note('warm', await d.warm(arm.sid, { timeoutMs: 30000 }), turn)) { await d.sleep(20); continue; }
  if (!note('acquire', await d.acquire(arm.sid, rsid, { timeoutMs: 30000 }), turn)) { await d.sleep(20); continue; }
  const c = await d.create(arm.sid, rsid, `c-${tag}-${turn}`, 'true', { timeoutMs: 30000 });
  if (note('execute', c, turn)) for (let i = 0; i < 100; i++) { const s = await d.status(arm.sid, rsid, c.json.executionCallId); if (s.json?.status?.state === 'settled') break; await d.sleep(20); }
  note('release', await d.release(arm.sid, rsid), turn);
}
const b = d.sql(`SELECT binding_state, runtime_generation, record_version, operation_generation FROM qwen_runtime_binding WHERE isolation_key='${arm.sid}' ORDER BY runtime_generation DESC LIMIT 1`)[0];
console.log(JSON.stringify({ tag, seconds: Number(seconds), turns: turn, tally, binding: { state: b[0], generation: b[1], record_version: b[2], operation_generation: b[3] }, failures }, null, 1));
