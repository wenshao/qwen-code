// Healthy-traffic probe: does the maintenance scan disturb a READY binding?
import * as d from './drive.mjs';
const [sid, rsid, seconds = '60', label = 'arm'] = process.argv.slice(2);
const end = Date.now() + Number(seconds) * 1000;
const tally = { warm: {}, acquire: {}, exec: {} };
const samples = [];
const bump = (kind, r) => {
  const key = r.status === 200 ? '200' : `${r.status} ${r.json?.error?.code ?? r.json?.code ?? JSON.stringify(r.json).slice(0, 80)}`;
  tally[kind][key] = (tally[kind][key] ?? 0) + 1;
  if (r.status !== 200 && samples.length < 6) samples.push({ at: d.now(), kind, status: r.status, body: r.json, ms: r.ms });
};
let n = 0;
async function warmLoop() { while (Date.now() < end) { bump('warm', await d.warm(sid, { timeoutMs: 20000 })); await d.sleep(5); } }
async function acquireLoop() { while (Date.now() < end) { bump('acquire', await d.acquire(sid, rsid, { timeoutMs: 20000 })); await d.sleep(7); } }
async function execLoop() {
  while (Date.now() < end) {
    const c = await d.create(sid, rsid, `load-${label}-${n++}`, 'true', { timeoutMs: 20000 });
    bump('exec', c);
    await d.sleep(40);
  }
}
const ver0 = d.sql('SELECT record_version, operation_generation FROM qwen_runtime_binding WHERE binding_state="READY" LIMIT 1')[0];
await Promise.all([warmLoop(), warmLoop(), acquireLoop(), execLoop()]);
const ver1 = d.sql('SELECT record_version, operation_generation FROM qwen_runtime_binding WHERE binding_state="READY" LIMIT 1')[0];
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ label, seconds: Number(seconds), trusted: process.env.TRUSTED_LABEL,
  requests: { warm: total(tally.warm), acquire: total(tally.acquire), exec: total(tally.exec) }, tally,
  binding: { record_version: [ver0?.[0], ver1?.[0]], operation_generation: [ver0?.[1], ver1?.[1]] }, samples }, null, 1));
