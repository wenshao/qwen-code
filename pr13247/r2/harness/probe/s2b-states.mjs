// VERIFICATION RIG ONLY (PR #13247) S2b: Session status gate. Bound close is unavailable on the macOS (non-durable)
// stack, so CLOSED/ARCHIVED/... are seeded with SQL on otherwise real Sessions; the admission only reads the status.
import { Report, ensureWorkspace, createSession, waitTurn, j, sql, WS, ST } from './lib.mjs';
import { pubChange, webChange, opId, waitCwdOp, binding, mkdirWs } from './cwd.mjs';

const R = new Report('s2b-states');
ensureWorkspace(WS, `st-${ST}`);
mkdirWs(ST, 'child2');
const c = await createSession('public', WS, 'PLAIN');
const s = c.session;
await waitTurn(s);
const key = `s2b-${Date.now()}`;
const a = await pubChange(s, 'child2', 1, { key });
const w = await waitCwdOp(s, opId(a));
R.check('setup: one completed change (rev 2)', w.json.status === 'completed' && binding(s).rev === 2, w.json.status);
const set = (st) => sql(`UPDATE managed_agent_session SET status='${st}' WHERE session_id='${s}'`);
for (const st of ['CLOSING', 'CLOSED', 'ARCHIVING', 'ARCHIVED', 'DELETING', 'DELETED']) {
  set(st);
  const cr = await pubChange(s, 'child', 2, { key: `s2b-${st}-${Date.now()}` });
  const wr = await webChange(s, 'child', 2, { key: `s2b-w-${st}-${Date.now()}` });
  const sm = await pubChange(s, 'child', 2, { key: `s2b-m-${st}-${Date.now()}`, actor: 'mallory' });
  const rb = await pubChange(s, 'child', 2, { key: `s2b-b-${st}-${Date.now()}`, actor: 'bob' });
  const rp = await pubChange(s, 'child2', 1, { key });
  const want = st === 'DELETED' ? [404, 'session_not_found'] : [409, 'session_state_conflict'];
  R.check(`${st}: creator ${want.join(' ')} (both surfaces); stranger 404; reader ${st === 'DELETED' ? '404' : '403'}`,
    cr.status === want[0] && cr.json.error?.code === want[1] && wr.status === want[0] && wr.json.error?.code === want[1] && sm.status === 404 && rb.status === (st === 'DELETED' ? 404 : 403),
    `creator ${cr.status} ${cr.json.error?.code} | web ${wr.status} ${wr.json.error?.code} | mallory ${sm.status} | bob ${rb.status} ${rb.json.error?.code}`);
  R.check(`${st}: replay of the completed change still answers the original operation (replay precedes the status gate)`, rp.status === 202 && rp.json.replayed === true && opId(rp) === opId(a), `${rp.status} ${rp.json.replayed} ${rp.json.error?.code ?? ''}`);
}
set('ACTIVE');
R.check('status restored; binding untouched by all refusals', j(binding(s)).includes('"cwd":"child2","rev":2'), j(binding(s)));
R.done({ session: s });
