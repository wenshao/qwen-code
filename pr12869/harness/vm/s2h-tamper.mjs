// R8: registrations that are missing or damaged when the host comes back must stay blocked. Run while the server is stopped.
import * as d from './drive.mjs';
import fs from 'node:fs';
const label = process.argv[2];
const file = `/rig/out/${label}-arms.json`;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const dir = `/var/lib/qwen-rt/${d.DB}`;
const key = (storage) => d.sql(`SELECT JSON_UNQUOTE(JSON_EXTRACT(resource_handle_json,'$.resourceId')) FROM qwen_runtime_binding WHERE storage_id='st-${storage}'`)[0][0];
const plan = { A: 'registration record deleted', B: 'registration record overwritten with 40 bytes of garbage', C: 'untouched', D: 'registration record keeps its bytes but names another machine (hostId edited)' };
for (const [arm, what] of Object.entries(plan)) {
  const k = key(state.arms[arm].storage); const p = `${dir}/${k}.json`;
  if (arm === 'A') fs.rmSync(p);
  if (arm === 'B') fs.writeFileSync(p, 'x'.repeat(40), { mode: 0o600 });
  if (arm === 'D') { const r = JSON.parse(fs.readFileSync(p, 'utf8')); const h = JSON.parse(r.handle); h.hostId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; r.handle = JSON.stringify(h); fs.writeFileSync(p, JSON.stringify(r), { mode: 0o600 }); }
  state.arms[arm].tamper = what; state.arms[arm].key = k;
  console.log(d.now(), `arm ${arm} st-${state.arms[arm].storage} ${k.slice(0, 12)}….json: ${what}`);
}
fs.writeFileSync(file, JSON.stringify(state, null, 1));
