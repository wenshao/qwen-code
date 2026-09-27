import * as d from './drive.mjs';
const ws = process.argv[2] ?? 'ws-a', st = process.argv[3] ?? 'st-a';
console.log(d.now(), 'host', JSON.stringify(d.hostFacts()));
try { d.seed(ws, st); } catch (e) { console.log('seed skipped:', String(e.message).split('\n')[1] ?? e.message); }
const sid = await d.createSession(ws);
console.log('session', sid);
console.log('warm', JSON.stringify(await d.warm(sid)));
const rsid = `rs-${sid.slice(-8)}`;
console.log('acquire', JSON.stringify(await d.acquire(sid, rsid)));
const c = await d.create(sid, rsid, 'call-echo', 'pwd; id -un; echo hello-from-worker > smoke.txt; ls -la');
console.log('create', JSON.stringify(c).slice(0, 600));
const id = c.json.executionCallId ?? c.json.execution?.executionCallId;
for (let i = 0; i < 20; i++) {
  const s = await d.status(sid, rsid, id);
  console.log('status', s.status, JSON.stringify(s.json).slice(0, 700));
  if (JSON.stringify(s.json).includes('SETTLED') || JSON.stringify(s.json).includes('settled')) break;
  await d.sleep(500);
}
console.log(d.snapshot());
console.log(d.workers());
