// E: a worker that dies before READY (interrupted startup).  F: a binding created seconds before the power loss.
import * as d from './drive.mjs';
import fs from 'node:fs';
const label = process.argv[2];
const file = `/rig/out/${label}-arms.json`;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const say = (...a) => console.log(d.now(), ...a);
async function open(name, storage) {
  const ws = `ws-${storage}`;
  try { d.seed(ws, `st-${storage}`); } catch { /* seeded */ }
  const sid = await d.createSession(ws);
  state.arms[name] = { storage, workspace: ws, sid, rsid: `rs-${name}-${sid.slice(-6)}`, dir: `/srv/ws/${storage}/project` };
  return state.arms[name];
}
const E = await open('E', 'e');
fs.writeFileSync('/var/lib/qwen-rt/fail-worker', 'x');
const we = await d.warm(E.sid, { timeoutMs: 20000 });
say('arm E warm while the worker cannot start:', we.status, JSON.stringify(we.json), `${we.ms} ms`);
fs.rmSync('/var/lib/qwen-rt/fail-worker');
say('arm E binding:', JSON.stringify(d.sql(`SELECT binding_state, resource_handle_version, IFNULL(runtime_endpoint,'-') FROM qwen_runtime_binding WHERE storage_id='st-e'`)));
const F = await open('F', 'f');
const wf = await d.warm(F.sid); const af = await d.acquire(F.sid, F.rsid);
say('arm F (fresh) warm/acquire:', wf.status, af.status);
fs.writeFileSync(file, JSON.stringify(state, null, 1));
