// VERIFICATION RIG ONLY (PR #13354): fresh mixed fleet — head Spring started against a base (pre-L3) Harness.
import * as L from './lib.mjs';
const R = new L.Report('p7-mixed');
await L.ensureWorkspace('ws-a', 'st-a');
const caps = await (await fetch(`http://127.0.0.1:${L.HARNESS_PORT}/capabilities`, { headers: { Authorization: `Bearer ${L.HTOKEN}` } })).json();
R.note('Harness advertises lifecycle protocol?', { lifecycleProtocolVersion: caps.lifecycleProtocolVersion ?? null });
for (const surface of ['public', 'web']) {
  const c = await L.createSession(surface, 'ws-a', `G_WRITE name=mx-${surface}-${Date.now().toString(36)}.txt content=mx`);
  const t = await L.waitTurns(c.session, 1);
  const w0 = await L.workerOf(c.session);
  const r = await L.read(surface, c.session);
  R.check(`[${surface}] Turn works on head Spring + base Harness`, t.rows.at(-1)?.status === 'COMPLETED', t.rows.at(-1));
  R.check(`[${surface}] capabilities withdraw ACTIVE close/delete (Harness lacks lifecycle protocol)`, L.caps(surface, r).delete === false && L.caps(surface, r).close === false, L.caps(surface, r));
  const d = await L.del(surface, c.session);
  R.check(`[${surface}] ACTIVE delete refused, nothing admitted`, d.status === 409 && (await L.opsOf(c.session)).length === 0, `${d.status} ${L.code(d)} ops=${L.j(await L.opsOf(c.session))}`);
  const cl = await L.closeS(surface, c.session);
  const cw = cl.status === 202 ? await L.waitOp(surface, c.session, L.opIdOf(surface, cl), 30_000) : { json: {} };
  R.note(`[${surface}] ACTIVE close on mixed fleet`, { admit: `${cl.status} ${L.code(cl)}`, op: cw.json.status ?? null, row: cl.status === 202 ? await L.opRow(L.opIdOf(surface, cl)) : null, workerAlive: L.alive(w0.pid), sess: (await L.sessRow(c.session)).status });
}
R.done();
await L.closeDb();
