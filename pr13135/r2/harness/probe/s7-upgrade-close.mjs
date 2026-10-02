// VERIFICATION RIG ONLY (PR #13135): after a jar upgrade, close every bound Session created by the previous build.
import { Report, sql, bindingOf, handleOf, registration, procState, getSession, closeSession, waitOp, opIdOf, sessStatus, LX, j } from './lib.mjs';
const rep = new Report(`s7-upgrade-close-${process.env.ARM ?? 'head'}`);
const rows = sql("SELECT session_id, workspace_id FROM managed_agent_session WHERE workspace_id IS NOT NULL AND status = 'ACTIVE' ORDER BY created_at");
for (const [S, ws] of rows) {
  const [b] = bindingOf(S);
  const h = b ? handleOf(b[0]) : null;
  const pid = h ? registration(h.resourceId)?.pid ?? 0 : 0;
  const cmd = pid ? LX(`tr '\\0' ' ' < /proc/${pid}/cmdline 2>/dev/null | cut -c1-90 || true`) : '';
  const caps = (await getSession(S)).json.capabilities;
  const r = await closeSession('public', S, { key: 'close-upgrade' });
  const w = await waitOp(S, opIdOf('public', r), { timeoutMs: 90_000 });
  const [b1] = bindingOf(S);
  rep.check(`${ws}: Session created by the previous build closes after the upgrade`, w.json.status === 'completed' && sessStatus(S) === 'CLOSED' && (pid === 0 || procState(pid) === 'gone') && b1?.[1] === 'RELEASED',
    j({ caps_close: caps?.session_close, admit: r.status, op: w.json.status, ms: w.ms, session: sessStatus(S), worker: `${pid}:${procState(pid)}`, workerCmd: cmd, binding: b1 }));
}
rep.done();
