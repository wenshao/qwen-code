// Round 3 side check: a second Workspace (ws-a2, cwd "project2") on the same storage as ws-a1 ("project").
// Runs the same two turns on whichever server jar/dist the service runs (reset.sh <db> JAR=... DIST=...),
// first with project2 absent, then after creating it. Reports turn terminals and the Harness failure line.
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as P from './pop.mjs';
const TAG = process.env.TAG ?? 'cwd';
L.openLog(`m3-cwd-${TAG}`);
const { say } = L;
const results = {};
say(`${L.hostFacts()} jar=${L.env().JAR} dist=${L.env().DIST} db=${L.DB()}`);
await P.rollout(['a']);
const rig = await L.startRig(`cwd-${TAG}`);
L.seedWs('ws-a1', 'a'); L.seedWs('ws-a2', 'a');
const turn = async (label, ws, cwd) => {
  const s = new L.HSession(rig.h, await L.createSession(ws, cwd), ws);
  const c = await s.create(L.FILES);
  const r = await s.prompt(`WRITE ${label}.txt x`);
  const log = fs.readFileSync(rig.h.logPath, 'utf8').split('\n').filter((l) => r.promptId && l.includes(r.promptId)).join(' | ').slice(0, 300);
  await s.detach();
  results[label] = { ws, cwd, create: c.status, terminal: P.term(r), harness: log };
  say(`   ${label.padEnd(18)} ${ws}/${cwd} exists=${fs.existsSync(`${L.root('a')}/${cwd}`)} create=${c.status} -> ${P.term(r).slice(0, 160)}${log ? ` | ${log.slice(0, 160)}` : ''}`);
};
await turn('a1-project', 'ws-a1', 'project');
await turn('a2-missing-dir', 'ws-a2', 'project2');
fs.mkdirSync(`${L.root('a')}/project2`);
await turn('a2-after-mkdir', 'ws-a2', 'project2');
await turn('a1-same-dir-as-a2', 'ws-a2', 'project');
await rig.stop();
fs.writeFileSync(`${L.OUT}/m3-cwd-${TAG}.json`, JSON.stringify(results, null, 1));
say('M3CWD-DONE');
