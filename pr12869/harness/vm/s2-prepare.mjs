// Builds the four arms before the reboot. Usage: s2-prepare.mjs <label>
import * as d from './drive.mjs';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const label = process.argv[2] ?? 'r1';
const say = (...a) => console.log(d.now(), ...a);
const state = { label, db: d.DB, host: d.hostFacts(), arms: {} };
say('host', JSON.stringify(state.host));
const record = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: f.slice(0, 12), ...JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')) }));

async function arm(name, storage) {
  const ws = `ws-${storage}`;
  try { d.seed(ws, `st-${storage}`); } catch { /* already seeded */ }
  const sid = await d.createSession(ws);
  const rsid = `rs-${name}-${sid.slice(-6)}`;
  const w = await d.warm(sid);
  const a = await d.acquire(sid, rsid);
  say(`arm ${name}: session=${sid} warm=${w.status} acquire=${a.status}`);
  if (w.status !== 200 || a.status !== 200) throw new Error(`arm ${name} setup failed ${JSON.stringify([w, a])}`);
  const nonce = `nonce-${name}-${randomUUID().slice(0, 8)}`;
  state.arms[name] = { storage, workspace: ws, sid, rsid, nonce, dir: `/srv/ws/${storage}/project` };
  return state.arms[name];
}
async function settle(arm, callId, command) {
  const c = await d.create(arm.sid, arm.rsid, callId, command);
  for (let i = 0; i < 60; i++) {
    const s = await d.status(arm.sid, arm.rsid, c.json.executionCallId);
    if (s.json?.status?.state === 'settled') return c.json.executionCallId;
    await d.sleep(250);
  }
  throw new Error(`${callId} did not settle`);
}
async function escape(arm, stay) {
  const c = await d.create(arm.sid, arm.rsid, 'call-escape', `node /opt/qwen/rig/escape-parent.js ${arm.nonce} ${stay ? 'stay' : ''}`);
  arm.escapeCall = c.json.executionCallId;
  for (let i = 0; i < 40 && !fs.existsSync(`${arm.dir}/escaped-pid`); i++) await d.sleep(250);
  arm.escapedPid = Number(fs.readFileSync(`${arm.dir}/escaped-pid`, 'utf8'));
  say(`arm ${arm.storage}: escaped writer pid=${arm.escapedPid} call=${arm.escapeCall} create=${c.status} state=${c.json?.status?.state}`);
}

// A: settled receipt + in-flight foreground call + escaped writer (s2b-prepared.mjs adds 130 reserved executions)
const A = await arm('A', 'a');
A.settledCall = await settle(A, 'call-settled', 'echo settled-before-reboot > settled.txt; cat settled.txt');
await escape(A, true);
// B: idle holder
await arm('B', 'b');
// C: holder whose authorization disappears before the reboot
const C = await arm('C', 'c');
C.settledCall = await settle(C, 'call-settled', 'echo c-settled');
// D: worker-only death before the reboot, escaped writer keeps writing
const D = await arm('D', 'd');
await escape(D, true);

fs.writeFileSync(`/rig/out/${label}-arms.json`, JSON.stringify(state, null, 1));
console.log(d.snapshot());
console.log(JSON.stringify(record(`/var/lib/qwen-rt/${d.DB}`).map((r) => ({ file: r.file, state: r.state, pid: r.pid, started: r.started, endpoint: r.endpoint, bootId: JSON.parse(r.handle).bootId })), null, 0));
console.log(d.workers());
