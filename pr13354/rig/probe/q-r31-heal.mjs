// VERIFICATION RIG ONLY (PR #13354): after the R3-1 run, restart Spring too (both now restarted) and watch the stuck ops.
import * as L from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync(`${L.OUT}/p5-r31-ids.json`, 'utf8'));
const REC = `${L.LOGD}/hooks-rec.jsonl`;
const rec = (s) => fs.readFileSync(REC, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.session === s).map((e) => `${e.event}@${e.t.slice(11, 23)}`);
const R = new L.Report('q-r31-heal');
const w3 = await L.workerOf(ids.s3), w4 = await L.workerOf(ids.s4);
await L.closeDb();
R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring TERM`, { allowFail: true }).split('\n')[0]);
R.say(L.sh(`HOOKS=${L.LOGD}/hooks.json ${L.RIG}/lx/spring.sh head ${L.DB}`, { allowFail: true }));
const t0 = L.tapLen(), tS = Date.now();
const r = await L.waitFor(async () => { const a = await L.opRow(ids.op3), b = await L.opRow(ids.op4); return a.state === 'COMPLETED' && b.state === 'COMPLETED' ? [a, b] : null; }, 240_000, 1000);
const a = await L.opRow(ids.op3), b = await L.opRow(ids.op4);
R.note('after restarting Spring as well', { ms: Date.now() - tS, timeout: !!r.timeout, del: a, close: b, sess: [(await L.sessRow(ids.s3)).status, (await L.sessRow(ids.s4)).status], hooksDel: rec(ids.s3), hooksClose: rec(ids.s4), wireDel: L.tapFor2(ids.s3, t0), wireClose: L.tapFor2(ids.s4, t0), workers: [w3.pid, L.alive(w3.pid), w4.pid, L.alive(w4.pid)] });
R.done();
await L.closeDb();
