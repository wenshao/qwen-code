// VERIFICATION RIG ONLY (PR #13354): R3-1 with the candidate Harness fix (lifecycle load re-addresses the live attachment).
// Same simulated catalog injection; Spring restart with the Harness kept; then delete / close the hooked Sessions.
import * as L from './lib.mjs';
import fs from 'node:fs';
const R = new L.Report(`p5c-${process.env.LABEL ?? 'cand'}${process.env.RESTART && process.env.RESTART !== 'spring' ? '-' + process.env.RESTART : ''}${process.env.SIG ? '-' + process.env.SIG : ''}`);
const pin = JSON.parse(fs.readFileSync(`${L.LOGD}/hook-pin.json`, 'utf8'));
const REC = `${L.LOGD}/hooks-rec.jsonl`;
const recs = (s) => (fs.existsSync(REC) ? fs.readFileSync(REC, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.session === s) : []);
const evs = (s) => recs(s).map((e) => `${e.event}@${e.t.slice(11, 23)}`);
for (const [w, st] of [['ws-ha', 'st-b'], ['ws-hb', 'st-c']]) await L.ensureWorkspace(w, st);
async function mkHooked(name, ws) {
  L.setTapRules([{ match: '^POST /session$', action: 'inject', merge: { hookCatalog: pin }, times: 1 }]);
  const c = await L.createSession('public', ws, `G_WRITE name=${name}-${Date.now().toString(36)}.txt content=${name}`);
  const t = await L.waitTurns(c.session, 1);
  L.setTapRules([]);
  R.check(`[${name}] hooked Session created, first Turn completes`, t.rows.at(-1)?.status === 'COMPLETED', t.rows.at(-1));
  return c.session;
}
const sd = await mkHooked('cd', 'ws-ha'), sc = await mkHooked('cc', 'ws-hb');
const wd = await L.workerOf(sd), wc = await L.workerOf(sc);
await L.closeDb();
const RESTART = process.env.RESTART ?? 'spring';
if (RESTART === 'spring') {
  R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring ${process.env.SIG ?? 'TERM'}`, { allowFail: true }).split('\n')[0]);
  R.say(L.sh(`HOOKS=${L.LOGD}/hooks.json ${L.RIG}/lx/spring.sh ${L.ARM} ${L.DB}`, { allowFail: true }));
} else {
  R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} harness ${process.env.SIG ?? 'TERM'}`, { allowFail: true }).split('\n')[0]);
  R.say(L.sh(`${L.RIG}/lx/harness.sh ${L.DB} ${L.ARM}`, { allowFail: true }));
}
R.note('restart', { RESTART, SIG: process.env.SIG ?? 'TERM' });
await L.api('GET', `/v1/agents/sessions/${sd}`); // warm-up: drop the pooled socket of the stopped Spring
const t0 = L.tapLen();
const d = await L.del('public', sd), c = await L.closeS('public', sc);
const done = async (op) => L.waitFor(async () => { const r = await L.opRow(op); return ['COMPLETED', 'FAILED'].includes(r?.state) ? r : null; }, 120_000, 300);
const [rd, rc] = await Promise.all([done(L.opIdOf('public', d)), done(L.opIdOf('public', c))]);
const hd = recs(sd), hc = recs(sc);
R.check(`[${RESTART}] hooked ACTIVE delete after ${RESTART} restart completes: End then Delete once, worker stopped, DELETED`, rd.v?.state === 'COMPLETED' && hd.length === 2 && hd[0].event === 'SessionEnd' && hd[1].event === 'SessionDelete' && !L.alive(wd.pid) && (await L.sessRow(sd)).status === 'DELETED', { row: await L.opRow(L.opIdOf('public', d)), ms: rd.ms, hooks: evs(sd), wire: L.tapFor2(sd, t0) });
R.check(`[${RESTART}] hooked ACTIVE close after ${RESTART} restart completes: End once, no Delete, worker stopped, CLOSED`, rc.v?.state === 'COMPLETED' && hc.length === 1 && hc[0].event === 'SessionEnd' && !L.alive(wc.pid) && (await L.sessRow(sc)).status === 'CLOSED', { row: await L.opRow(L.opIdOf('public', c)), ms: rc.ms, hooks: evs(sc), wire: L.tapFor2(sc, t0) });
R.done();
await L.closeDb();
