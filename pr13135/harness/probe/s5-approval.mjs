// VERIFICATION RIG ONLY (PR #13135): a Turn waiting on an approval blocks close (409 turn_active) on both surfaces;
// after the approval is answered and the Turn completes, close succeeds. Spring must run with approval mode default.
import { Report, createSession, closeSession, opIdOf, waitTurn, waitOp, waitPending, respond, sessStatus, ensureWorkspace, j, fenceRows, lxWs, bindingOf, handleOf, registration, procState, turnRow } from './lib.mjs';
const [WS = 'wsap-j', ST = 'j'] = process.argv.slice(2);
const rep = new Report(`s5-approval-${process.env.ARM ?? 'head'}-${WS}`);
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, `G_WRITE name=approved.txt content=approved-${ST}`);
const S = c.session;
const p = await waitPending(S);
rep.check('Turn waits on an approval', !p.timeout, `action=${p.action?.id ?? p.action?.actionId} turn=${turnRow(S).at(-1)?.[1]}`);
for (const surface of ['public', 'web']) {
  const r = await closeSession(surface, S, { key: `close-ap-${surface}` });
  rep.check(`${surface}: close while the approval is pending refused 409 turn_active`, r.status === 409 && r.json.error?.code === 'turn_active', `status=${r.status} code=${r.json.error?.code}`);
}
rep.check('refusals: Session ACTIVE, no fence', sessStatus(S) === 'ACTIVE' && fenceRows(S) === 0, `status=${sessStatus(S)} fence=${fenceRows(S)}`);
const a = await respond('public', S, p.action, 'allow', { key: 'allow-1' });
rep.note('approval answered', `${a.status} ${a.json.status ?? a.json.error?.code}`);
const t = await waitTurn(S);
rep.check('Turn completes after approval', t.status === 'COMPLETED', `${t.status} ${t.error} file=${lxWs(ST, 'child/approved.txt')}`);
const [b] = bindingOf(S); const pid = b ? registration(handleOf(b[0]).resourceId)?.pid ?? 0 : 0;
const r = await closeSession('web', S, { key: 'close-ap-web' });
const w = await waitOp(S, opIdOf('web', r), { surface: 'web', timeoutMs: 60_000 });
rep.check('the key refused while pending now closes the Session', r.status === 202 && w.json.status === 'completed' && sessStatus(S) === 'CLOSED' && procState(pid) === 'gone', `admit=${r.status} op=${w.json.status} session=${sessStatus(S)} pid=${pid}:${procState(pid)}`);
rep.done({ session: S });
