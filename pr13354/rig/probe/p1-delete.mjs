// VERIFICATION RIG ONLY (PR #13354): ACTIVE files Session delete on both surfaces, with neighbour + shared-file checks.
// usage: DB=.. ARM=head|base|merge node p1-delete.mjs [reps]
import * as L from './lib.mjs';
const reps = Number(process.argv[2] ?? 2);
const R = new L.Report('p1-delete');
const l3 = L.ARM !== 'base';
await L.ensureWorkspace('ws-a', 'st-a');
const summary = [];
for (const surface of ['public', 'web']) {
  for (let i = 0; i < reps; i++) {
    const tag = `${surface}-${i}-${Date.now().toString(36)}`;
    const s = await L.createSession(surface, 'ws-a', `G_WRITE name=del-${tag}.txt content=d-${tag}`);
    const n = await L.createSession(surface, 'ws-a', `G_WRITE name=nb-${tag}.txt content=n-${tag}`);
    await L.waitTurns(s.session, 1); await L.waitTurns(n.session, 1);
    const pre = await L.read(surface, s.session);
    const w0 = await L.workerOf(s.session), nw0 = await L.workerOf(n.session);
    R.check(`[${tag}] setup: both Sessions ACTIVE with live workers`, pre.json.status === 'active' || pre.json.status === 'ACTIVE' || pre.status === 200 && w0.pidAlive && nw0.pidAlive, { s: w0, n: nw0 });
    R.check(`[${tag}] capability delete=${l3}`, L.caps(surface, pre).delete === l3, L.caps(surface, pre));
    const t0 = L.tapLen();
    const key = L.uid('k');
    const d = await L.del(surface, s.session, { key });
    if (!l3) {
      R.check(`[${tag}] base: ACTIVE delete refused 409 session_state_conflict`, d.status === 409 && L.code(d) === 'session_state_conflict', `${d.status} ${L.code(d)}`);
      const after = await L.workerOf(s.session);
      R.check(`[${tag}] base: no operation, worker untouched`, (await L.opsOf(s.session)).length === 0 && after.pidAlive, after);
      summary.push({ surface, tag, status: d.status, code: L.code(d) });
      continue;
    }
    const op = L.opIdOf(surface, d);
    R.check(`[${tag}] DELETE accepted 202 with operation`, d.status === 202 && !!op, `${d.status} op=${op} ${L.code(d)}`);
    const mid = await L.sessRow(s.session);
    const done = await L.waitOp(surface, s.session, op, 60_000);
    R.check(`[${tag}] operation completed`, done.json.status === 'completed', `${done.json.status} after ${done.waited} ms`);
    const row = await L.opRow(op);
    const srow = await L.sessRow(s.session);
    const w1 = await L.workerOf(s.session);
    const binds = await L.bindings(s.session);
    R.check(`[${tag}] op row COMPLETED proto=1 effects receipt saved, receipt id`, row.state === 'COMPLETED' && row.proto === 1 && row.effects === 1 && !!row.receipt, row);
    R.check(`[${tag}] Session DELETED tombstone (deleted_at set)`, srow.status === 'DELETED' && !!srow.deleted_at, { mid: mid.status, final: srow.status, deleted_at: srow.deleted_at });
    R.check(`[${tag}] retirement row written`, (await L.retirement(s.session)).length === 1, await L.retirement(s.session));
    R.check(`[${tag}] original worker stopped (pid gone), registration RETIRED, binding RELEASED with drain receipt`, w0.pid && !L.alive(w0.pid) && w1.regState === 'RETIRED' && binds.every((b) => b.state === 'RELEASED' && b.drainRcpt === 1), { w0pid: w0.pid, w1, binds: binds.map((b) => ({ state: b.state, stopEv: b.stopEv, drainRcpt: b.drainRcpt })) });
    const gone = await L.read(surface, s.session);
    R.check(`[${tag}] Session hidden after delete (404)`, gone.status === 404, `${gone.status} ${L.code(gone)}`);
    const opAfter = await L.opRead(surface, s.session, op);
    R.check(`[${tag}] completed operation still readable`, opAfter.status === 200 && opAfter.json.status === 'completed', `${opAfter.status} ${opAfter.json.status}`);
    const wire = L.tapFor2(s.session, t0);
    R.check(`[${tag}] Harness wire: lifecycle-authorized detach, no legacy DELETE /session (no-catalog Session: no-Hook receipt from Store, no /lifecycle call)`, wire.some((x) => x.startsWith('POST /session/:id/detach -> 204')) && !wire.some((x) => x.startsWith('DELETE /session/:id')) && !wire.some((x) => x.includes('/lifecycle')), wire);
    const replay = await L.del(surface, s.session, { key });
    R.check(`[${tag}] replay same key -> same operation`, L.opIdOf(surface, replay) === op && [200, 202].includes(replay.status), `${replay.status} ${L.opIdOf(surface, replay)} replay=${replay.headers['x-qwen-idempotent-replay']}`);
    R.check(`[${tag}] shared files intact (deleted Session's file + neighbour's file)`, L.readWs('a', `child/del-${tag}.txt`) === `D-${tag}`.toUpperCase() && L.readWs('a', `child/nb-${tag}.txt`) === `N-${tag}`.toUpperCase());
    const nw1 = await L.workerOf(n.session);
    const nIn = await L.sendInput(n.session, `G_WRITE name=nb2-${tag}.txt content=after-${tag}`);
    const nT = await L.waitTurns(n.session, 2);
    R.check(`[${tag}] neighbour unaffected: worker alive, new Turn completes, new file written`, nw1.pidAlive && nw1.pid === nw0.pid && nIn.status === 202 && nT.rows.at(-1).status === 'COMPLETED' && L.readWs('a', `child/nb2-${tag}.txt`) === `AFTER-${tag}`.toUpperCase(), { nw1, input: nIn.status, last: nT.rows.at(-1) });
    const ev = await L.events(s.session);
    summary.push({ surface, tag, status: d.status, completedMs: done.waited, events: ev.slice(-3), wire });
    R.note(`[${tag}] last events`, ev.slice(-4));
  }
}
R.done({ summary });
await L.closeDb();
