import * as L from './lib.mjs';
import fs from 'node:fs';
const st = JSON.parse(fs.readFileSync(`${L.OUT}/p6-state.json`, 'utf8'));
for (const k of ['mixed_public', 'mixed_web']) {
  const s = st[k].s;
  console.log(k, s, L.j(await L.sessRow(s)), L.j(await L.opsOf(s)), L.j(await L.workerOf(s)), L.j(L.tapFor2(s)), L.j(await L.journalHead(s)));
}
await L.closeDb();
