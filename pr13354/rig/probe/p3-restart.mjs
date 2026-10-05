// VERIFICATION RIG ONLY (PR #13354): restart Spring (TERM / KILL) while the Harness keeps its attachments,
// then delete / close / run an ordinary Turn. The new Spring's connector has an empty attachment cache (R3-1 precondition).
// usage: DB=.. ARM=head|base|merge node p3-restart.mjs <TERM|KILL>
import * as L from './lib.mjs';
const SIG = process.argv[2] ?? 'TERM';
const R = new L.Report(`p3-restart-${SIG}`);
const l3 = L.ARM !== 'base';
await L.ensureWorkspace('ws-a', 'st-a');
L.setTapRules([]);
const tag = `${SIG}-${Date.now().toString(36)}`;
const mk = async (name) => { const c = await L.createSession('public', 'ws-a', `G_WRITE name=${name}-${tag}.txt content=${name}`); await L.waitTurns(c.session, 1); return c.session; };
const sDel = await mk('rs-del'), sClose = await mk('rs-close'), sTurn = await mk('rs-turn'), sWebDel = await mk('rs-wdel');
const before = {};
for (const s of [sDel, sClose, sTurn, sWebDel]) before[s] = await L.workerOf(s);
const hpid = L.sh(`cat ${L.VARRUN}/harness.pid`);
R.say(`harness pid=${hpid}; workers ${L.j(Object.values(before).map((w) => w.pid))}`);
await L.closeDb();
const t0 = Date.now();
R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring ${SIG}`, { allowFail: true }));
R.say(L.sh(`${L.RIG}/lx/spring.sh ${L.ARM} ${L.DB}`, { allowFail: true }));
R.say(`spring restarted in ${Date.now() - t0} ms; harness still pid ${L.sh(`kill -0 ${hpid} && echo alive || echo dead`)}`);
const survived = {};
for (const s of [sDel, sClose, sTurn, sWebDel]) survived[s] = await L.workerOf(s);
R.note('workers after Spring restart', Object.values(survived).map((w) => `${w.pid}:${w.pidAlive ? 'alive' : 'gone'}:${w.bstate}`));
const tap0 = L.tapLen();
const runs = [];
const one = async (label, surface, s, fn) => {
  const r = await fn(surface, s);
  const op = L.opIdOf(surface, r);
  const w = op ? await L.waitOp(surface, s, op, 45_000) : { json: {} };
  const row = op ? await L.opRow(op) : null;
  const wire = L.tapFor2(s, tap0);
  runs.push({ label, admit: r.status, code: L.code(r), status: w.json.status, waited: w.waited, row, wire, sess: (await L.sessRow(s)).status, worker: await L.workerOf(s) });
  return runs.at(-1);
};
const d = await one('delete public', 'public', sDel, (sf, s) => L.del(sf, s));
const wd = await one('delete web', 'web', sWebDel, (sf, s) => L.del(sf, s));
const c = await one('close public', 'public', sClose, (sf, s) => L.closeS(sf, s));
if (l3) {
  R.check(`[${SIG}] ACTIVE delete (public) after Spring restart completes`, d.admit === 202 && d.status === 'completed' && d.sess === 'DELETED', d);
  R.check(`[${SIG}] ACTIVE delete (web) after Spring restart completes`, wd.admit === 202 && wd.status === 'completed' && wd.sess === 'DELETED', wd);
} else {
  R.check(`[${SIG}] base: ACTIVE delete still refused`, d.admit === 409, d);
}
R.check(`[${SIG}] ACTIVE close after Spring restart completes`, c.admit === 202 && c.status === 'completed' && c.sess === 'CLOSED', c);
for (const x of [d, wd, c]) R.check(`[${SIG}] ${x.label}: original worker stopped`, x.admit !== 202 || (!x.worker.pidAlive && x.worker.regState === 'RETIRED'), x.worker);
const inp = await L.sendInput(sTurn, `G_WRITE name=rs-turn2-${tag}.txt content=again`);
const tt = await L.waitTurns(sTurn, 2, 90_000);
R.check(`[${SIG}] control: ordinary Turn on an untouched Session after restart completes`, inp.status === 202 && tt.rows.at(-1).status === 'COMPLETED', { input: inp.status, last: tt.rows.at(-1), ms: tt.ms, wire: L.tapFor2(sTurn, tap0) });
R.done({ runs });
await L.closeDb();
