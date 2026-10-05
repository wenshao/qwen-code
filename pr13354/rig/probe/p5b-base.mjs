// VERIFICATION RIG ONLY (PR #13354): BASE arm with the same simulated Hook catalog injection.
//   B1 close without restart (pre-PR semantics: which Hooks run on close?)
//   B2 close after a Spring restart with the Harness kept (does the legacy DELETE path complete?)
import * as L from './lib.mjs';
import fs from 'node:fs';
const R = new L.Report('p5b-base');
const pin = JSON.parse(fs.readFileSync(`${L.LOGD}/hook-pin.json`, 'utf8'));
const REC = `${L.LOGD}/hooks-rec.jsonl`;
const evs = (s) => (fs.existsSync(REC) ? fs.readFileSync(REC, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.session === s).map((e) => `${e.event}@${e.t.slice(11, 23)}`) : []);
for (const [w, st] of [['ws-ha', 'st-b'], ['ws-hb', 'st-c']]) await L.ensureWorkspace(w, st);
async function mkHooked(name, ws) {
  L.setTapRules([{ match: '^POST /session$', action: 'inject', merge: { hookCatalog: pin }, times: 1 }]);
  const c = await L.createSession('public', ws, `G_WRITE name=${name}-${Date.now().toString(36)}.txt content=${name}`);
  const t = await L.waitTurns(c.session, 1);
  L.setTapRules([]);
  R.check(`[${name}] hooked Session created, first Turn completes`, t.rows.at(-1)?.status === 'COMPLETED', t.rows.at(-1));
  return c.session;
}
const s1 = await mkHooked('b1', 'ws-ha');
let t0 = L.tapLen();
const c1 = await L.closeS('public', s1);
const w1 = await L.waitOp('public', s1, L.opIdOf('public', c1), 60_000);
R.note('[B1] base ACTIVE close of a hooked Session (no restart)', { op: w1.json.status, ms: w1.waited, hooks: evs(s1), wire: L.tapFor2(s1, t0) });
const s2 = await mkHooked('b2', 'ws-hb');
const w2 = await L.workerOf(s2);
await L.closeDb();
R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring TERM`, { allowFail: true }).split('\n')[0]);
R.say(L.sh(`HOOKS=${L.LOGD}/hooks.json ${L.RIG}/lx/spring.sh base ${L.DB}`, { allowFail: true }));
t0 = L.tapLen();
const c2 = await L.closeS('public', s2);
const r2 = await L.waitFor(async () => { const r = await L.opRow(L.opIdOf('public', c2)); return ['COMPLETED', 'FAILED'].includes(r?.state) ? r : null; }, 120_000, 500);
R.check('[B2] base: hooked ACTIVE close after Spring restart (Harness kept) completes via legacy DELETE', r2.v?.state === 'COMPLETED' && (await L.sessRow(s2)).status === 'CLOSED' && !L.alive(w2.pid), { row: await L.opRow(L.opIdOf('public', c2)), ms: r2.ms, hooks: evs(s2), wire: L.tapFor2(s2, t0) });
R.done();
await L.closeDb();
