// VERIFICATION RIG ONLY (PR #13354): SIGKILL Spring mid-delete, then a new Spring takes over (claim generation 2).
//   A: detach reaches the Harness, reply lost (tap drop-after)        -> successor detach must tolerate 404, stop worker, complete
//   B: detach never reaches the Harness (tap drop-before)            -> successor detaches (204) and completes
//   C: completion blocked on a journal-head row lock held elsewhere  -> kill while blocked, release, successor completes
// usage: DB=.. ARM=head|merge node p4-crash.mjs [A,B,C]
import * as L from './lib.mjs';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
const which = (process.argv[2] ?? 'A,B,C').split(',');
const R = new L.Report(`p4-crash-${which.join('')}`);
await L.ensureWorkspace('ws-a', 'st-a');
const restart = async () => { await L.closeDb(); R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring KILL`, { allowFail: true }).split('\n').filter((l) => !l.startsWith('worker-left')).join(' ')); R.say(L.sh(`${L.RIG}/lx/spring.sh ${L.ARM} ${L.DB}`, { allowFail: true })); };
const mk = async (name) => { const c = await L.createSession('public', 'ws-a', `G_WRITE name=${name}-${Date.now().toString(36)}.txt content=${name}`); await L.waitTurns(c.session, 1); return c.session; };
const waitRow = async (op, pred, ms = 150_000) => L.waitFor(async () => { const r = await L.opRow(op); return pred(r) ? r : null; }, ms);
async function finish(label, s, op, w0, tap0, tKill) {
  const fin = await waitRow(op, (r) => r?.state === 'COMPLETED' || r?.state === 'FAILED', 200_000);
  const row = await L.opRow(op);
  const sess = await L.sessRow(s);
  const w1 = await L.workerOf(s);
  R.check(`[${label}] successor completes the delete after SIGKILL (claim gen >= 2)`, row.state === 'COMPLETED' && row.gen >= 2 && sess.status === 'DELETED', { row, sess: sess.status, sinceKillMs: Date.now() - tKill, waitMs: fin.ms });
  R.check(`[${label}] original worker stopped, registration RETIRED`, !L.alive(w0.pid) && w1.regState === 'RETIRED', w1);
  R.note(`[${label}] wire`, L.tapFor2(s, tap0));
  R.check(`[${label}] no SessionEnd/Delete Hook replay, no legacy DELETE, no lifecycle load`, !L.tapFor2(s, tap0).some((x) => x.startsWith('DELETE') || x.includes('/lifecycle') || x.includes('lifecycleLoad')));
}

if (which.includes('A') || which.includes('B')) {
  for (const label of ['A', 'B'].filter((x) => which.includes(x))) {
    const s = await mk(`crash${label}`);
    const w0 = await L.workerOf(s);
    L.setTapRules([{ match: `POST /session/${s}/detach`, action: label === 'A' ? 'drop-after' : 'drop-before', times: 1 }, { match: `POST /session/${s}/detach`, action: 'delay', delayMs: 120000, times: 1 }]);
    const tap0 = L.tapLen();
    const d = await L.del('public', s);
    const op = L.opIdOf('public', d);
    // wait until the faulted detach happened (dropped) and the retry is being held
    await L.waitFor(async () => L.tap().slice(tap0).filter((e) => e.path.includes(`${s}/detach`)).length >= 1, 30_000);
    await L.sleep(1500);
    const mid = await L.opRow(op);
    R.note(`[${label}] before kill`, { mid, sess: (await L.sessRow(s)).status, harnessDetaches: L.tapFor2(s, tap0) });
    L.setTapRules([]);
    const tKill = Date.now();
    await restart();
    await finish(label, s, op, w0, tap0, tKill);
  }
}

if (which.includes('C')) {
  const s = await mk('crashC');
  const w0 = await L.workerOf(s);
  L.setTapRules([{ match: `POST /session/${s}/detach`, action: 'delay', delayMs: 6000, times: 1 }]);
  const tap0 = L.tapLen();
  const d = await L.del('public', s);
  const op = L.opIdOf('public', d);
  await L.sleep(1500);
  const conn = await mysql.createConnection({ host: 'pr13354-db', user: 'root', password: fs.readFileSync(`${L.RIG}/lx/.dbpass`, 'utf8').trim(), database: L.DB });
  await conn.query('BEGIN');
  await conn.query('SELECT state FROM qwen_managed_session_journal_head WHERE session_id=? FOR UPDATE', [s]);
  const blocked = await L.waitFor(async () => Number(await L.one('SELECT COUNT(*) FROM performance_schema.data_lock_waits')) > 0, 30_000);
  R.note('[C] coordinator blocked on the held row lock', { lockWaits: blocked.v, ms: blocked.ms, row: await L.opRow(op), sess: (await L.sessRow(s)).status });
  L.setTapRules([]);
  const tKill = Date.now();
  await L.closeDb();
  R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring KILL`, { allowFail: true }).split('\n').filter((l) => !l.startsWith('worker-left')).join(' '));
  await conn.query('ROLLBACK'); await conn.end();
  R.say(L.sh(`${L.RIG}/lx/spring.sh ${L.ARM} ${L.DB}`, { allowFail: true }));
  await finish('C', s, op, w0, tap0, tKill);
}
L.setTapRules([]);
R.done();
await L.closeDb();
