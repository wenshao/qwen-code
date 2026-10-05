import * as L from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync(`${L.OUT}/p5-r31-ids.json`, 'utf8'));
const REC = `${L.LOGD}/hooks-rec.jsonl`;
const rec = (s) => (fs.existsSync(REC) ? fs.readFileSync(REC, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.session === s).map((e) => `${e.event}@${e.t.slice(11, 23)}`) : []);
const out = {};
for (const [k, s, op] of [['del', ids.s3, ids.op3], ['close', ids.s4, ids.op4], ['ctrl', ids.s5, null]]) {
  const w = await L.workerOf(s);
  out[k] = { sess: (await L.sessRow(s)).status, ops: await L.opsOf(s), hooks: rec(s), wireLast: L.tapFor2(s).slice(-3), worker: `${w.pid}:${w.pidAlive}:${w.regState}` };
}
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${L.OUT}/q-r31-state-${process.argv[2] ?? 'x'}.json`, JSON.stringify({ t: new Date().toISOString(), out }, null, 1));
await L.closeDb();
