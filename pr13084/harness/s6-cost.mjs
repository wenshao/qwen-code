// s6: database cost of public reads, head vs base (dedicated mysqld, so global counters only see this Spring).
//   one 99 MiB artifact; full download; 1 MiB range; counters from SHOW GLOBAL STATUS (idle rate subtracted)
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM;
L.openLog(`s6-${ARM}${process.env.SUFFIX ?? ''}`);
const SF = `${L.R}/out/s6-${ARM}-${L.DB}-artifact.json`;
let A;
if (fs.existsSync(SF)) A = JSON.parse(fs.readFileSync(SF, 'utf8'));
else {
  const m = await L.makeOutput('cost', `ws-cost-${ARM}-${L.DB}`, process.env.ST ?? 'st-s50', L.genCmd('cost', 99 * 1024 * 1024 + 7, 0, 0));
  A = { session: m.session, a: m.arts.find((x) => x.stream_role === 'stdout') };
  fs.writeFileSync(SF, JSON.stringify(A));
}
const NAMES = ['Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Com_commit', 'Com_rollback', 'Questions', 'Innodb_row_lock_waits'];
const snap = () => Object.fromEntries(L.sql(`SHOW GLOBAL STATUS WHERE Variable_name IN (${NAMES.map((n) => `'${n}'`).join(',')})`, 'mysql').map(([k, v]) => [k, +v]));
const delta = (a, b) => Object.fromEntries(NAMES.map((n) => [n, b[n] - a[n]]));
async function measure(label, fn) {
  const s0 = snap(); const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0; const s1 = snap();
  await L.sleep(ms); const s2 = snap();             // idle window of the same length
  const busy = delta(s0, s1), idle = delta(s1, s2);
  const net = Object.fromEntries(NAMES.map((n) => [n, busy[n] - idle[n]]));
  return { label, ms, ...r, net, idleQuestions: idle.Questions };
}
const out = [];
const full = await measure('full', async () => { const r = await L.streamDownload(A.session, A.a); return { status: r.status, bytes: r.bytes, ended: r.ended, shaOk: r.sha256 === A.a.sha256 }; });
full.perMiB = +(full.net.Questions / (full.bytes / 1048576)).toFixed(1);
out.push(full); L.say('full', full);
const rng = await measure('range-1MiB', async () => { const r = await L.content(A.session, A.a.id, { revision: A.a.revision, range: `bytes=${50 * 1048576}-${51 * 1048576 - 1}` }); return { status: r.status, bytes: r.body.length }; });
out.push(rng); L.say('range', rng);
const list = await measure('list', async () => { const r = await L.artifacts(A.session); return { status: r.status }; });
out.push(list); L.say('list', list);
L.out(`s6-${ARM}${process.env.SUFFIX ?? ''}.json`, { arm: ARM, db: L.DB, artifact: A.a.byte_length, out });
