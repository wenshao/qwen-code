// VERIFICATION RIG ONLY (PR #13354): Harness-first rollout — base Spring against the head Harness.
import * as L from './lib.mjs';
const R = new L.Report('p7b-harness-first');
await L.ensureWorkspace('ws-a', 'st-a');
for (const surface of ['public', 'web']) {
  const c = await L.createSession(surface, 'ws-a', `G_WRITE name=hf-${surface}-${Date.now().toString(36)}.txt content=hf`);
  const t = await L.waitTurns(c.session, 1);
  const w0 = await L.workerOf(c.session);
  const r = await L.read(surface, c.session);
  R.check(`[${surface}] Turn works on base Spring + head Harness`, t.rows.at(-1)?.status === 'COMPLETED', t.rows.at(-1));
  const d = await L.del(surface, c.session);
  R.check(`[${surface}] base Spring still refuses ACTIVE delete`, d.status === 409, `${d.status} ${L.code(d)} caps=${L.j(L.caps(surface, r))}`);
  const t0 = L.tapLen();
  const cl = await L.closeS(surface, c.session);
  const cw = await L.waitOp(surface, c.session, L.opIdOf(surface, cl), 60_000);
  R.check(`[${surface}] legacy close (DELETE /session) on the head Harness completes, worker stopped`, cw.json.status === 'completed' && (await L.sessRow(c.session)).status === 'CLOSED' && !L.alive(w0.pid), { op: cw.json.status, ms: cw.waited, wire: L.tapFor2(c.session, t0) });
}
R.done();
await L.closeDb();
