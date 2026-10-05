// VERIFICATION RIG ONLY (PR #13354): a Turn waiting on a tool approval must refuse ACTIVE delete with 409 turn_active.
import * as L from './lib.mjs';
const R = new L.Report('p9-approval');
await L.ensureWorkspace('ws-c', 'st-c'); await L.ensureWorkspace('ws-d', 'st-d');
for (const surface of ['public', 'web']) {
  const c = await L.createSession(surface, surface === 'web' ? 'ws-d' : 'ws-c', `G_WRITE name=appr-${surface}-${Date.now().toString(36)}.txt content=a`);
  const pend = await L.waitFor(async () => { const r = await L.api('GET', `/v1/agents/sessions/${c.session}/actions`); const a = (r.json.data ?? []).find((x) => x.state === 'requested'); return a ?? null; }, 60_000, 300);
  const turn = (await L.turns(c.session)).at(-1);
  const d = await L.del(surface, c.session);
  R.check(`[${surface}] approval-waiting Turn -> ACTIVE delete refused 409 turn_active, nothing admitted`, !!pend.v && d.status === 409 && L.code(d) === 'turn_active' && (await L.opsOf(c.session)).length === 0, { action: pend.v?.id, actionState: pend.v?.state, turn: turn?.status, del: `${d.status} ${L.code(d)}` });
  const a = pend.v;
  const resp = await L.api('POST', `/v1/agents/sessions/${c.session}/actions/${a.id}/responses`, { kind: 'permission', option_id: 'allow', input_revision: a.input_revision, policy_revision: a.policy_revision }, { key: L.uid('resp') });
  const t = await L.waitTurns(c.session, 1, 60_000);
  const d2 = await L.del(surface, c.session);
  const w = await L.waitOp(surface, c.session, L.opIdOf(surface, d2), 60_000);
  R.check(`[${surface}] after approving and settling, the delete succeeds`, t.rows.at(-1)?.status === 'COMPLETED' && d2.status === 202 && w.json.status === 'completed', { resp: resp.status, turn: t.rows.at(-1)?.status, del: d2.status, op: w.json.status });
}
R.done();
await L.closeDb();
