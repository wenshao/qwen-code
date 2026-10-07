// VERIFICATION RIG ONLY (PR #13354): Harness generation change under a running Spring (G3 integration, PR 805c030cbd).
//   G1 idle: restart the Harness, then ACTIVE delete + close of Sessions attached to the old generation
//   G2 mid-delete: detach held at the tap, restart the Harness while the operation is DELETING
// usage: DB=.. ARM=.. node p10-harness-restart.mjs
import * as L from './lib.mjs';
const R = new L.Report('p10-harness-restart');
await L.ensureWorkspace('ws-a', 'st-a');
L.setTapRules([]);
const mk = async (n) => { const c = await L.createSession('public', 'ws-a', `G_WRITE name=${n}-${Date.now().toString(36)}.txt content=${n}`); await L.waitTurns(c.session, 1); return c.session; };
const restartHarness = async () => { await L.closeDb(); R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} harness TERM`, { allowFail: true }).split('\n')[0]); R.say(L.sh(`${L.RIG}/lx/harness.sh ${L.DB} ${L.ARM}`, { allowFail: true })); };
const settle = async (op, ms = 150_000) => L.waitFor(async () => { const r = await L.opRow(op); return ['COMPLETED', 'FAILED'].includes(r?.state) ? r : null; }, ms, 500);
// G1
const s1 = await mk('g1d'), s2 = await mk('g1c'), s3 = await mk('g1t');
const w1 = await L.workerOf(s1), w2 = await L.workerOf(s2);
await restartHarness();
let t0 = L.tapLen();
await L.api('GET', `/v1/agents/sessions/${s1}`);
const d1 = await L.del('public', s1), c2 = await L.closeS('public', s2);
const [r1, r2] = await Promise.all([settle(L.opIdOf('public', d1)), settle(L.opIdOf('public', c2))]);
R.check('[G1] after a Harness restart, ACTIVE delete of a Session attached to the old generation completes', r1.v?.state === 'COMPLETED' && (await L.sessRow(s1)).status === 'DELETED' && !L.alive(w1.pid), { row: await L.opRow(L.opIdOf('public', d1)), ms: r1.ms, wire: L.tapFor2(s1, t0) });
R.check('[G1] after a Harness restart, ACTIVE close completes', r2.v?.state === 'COMPLETED' && (await L.sessRow(s2)).status === 'CLOSED' && !L.alive(w2.pid), { row: await L.opRow(L.opIdOf('public', c2)), ms: r2.ms, wire: L.tapFor2(s2, t0) });
const inp = await L.sendInput(s3, `G_WRITE name=g1t2-${Date.now().toString(36)}.txt content=again`);
const tt = await L.waitTurns(s3, 2, 120_000);
R.check('[G1] control: ordinary Turn on an old-generation Session completes after the Harness restart', inp.status === 202 && tt.rows.at(-1)?.status === 'COMPLETED', { last: tt.rows.at(-1), ms: tt.ms });
// G2
const s4 = await mk('g2');
const w4 = await L.workerOf(s4);
L.setTapRules([{ match: `POST /session/${s4}/detach`, action: 'delay', delayMs: 20000, times: 1 }]);
t0 = L.tapLen();
const d4 = await L.del('public', s4);
const op4 = L.opIdOf('public', d4);
await L.sleep(2000);
R.note('[G2] before Harness restart', { row: await L.opRow(op4), sess: (await L.sessRow(s4)).status });
await restartHarness();
L.setTapRules([]);
const r4 = await settle(op4, 200_000);
R.check('[G2] Harness restarted while the delete is DELETING: operation still completes, worker stopped', r4.v?.state === 'COMPLETED' && (await L.sessRow(s4)).status === 'DELETED' && !L.alive(w4.pid), { row: await L.opRow(op4), ms: r4.ms, wire: L.tapFor2(s4, t0) });
R.done();
await L.closeDb();
