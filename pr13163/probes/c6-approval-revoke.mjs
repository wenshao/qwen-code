// VERIFICATION RIG ONLY (PR #13163): the bot's open question. A later Turn waits on a pending approval Action
// (not on a held model reply); the creator's can_create is revoked (or the Workspace DRAINING); the creator cancels.
// Spring must run with QWEN_MANAGED_AGENT_APPROVAL_MODE=default.
// usage: DB=<db> node c6-approval-revoke.mjs <workspace> <storage> <revoke|draining>
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, waitPending, respond, listActions, actionRow, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST, MODE] = [process.argv[2], process.argv[3], process.argv[4] ?? 'revoke'];
const r = new Report(`c6-approval-${MODE}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const restore = () => { sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`); sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE ${W}`); };
restore();
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const tag = Date.now() % 100000;
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_WRITE name=p1-${tag}.txt content=first` }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('Session approval_mode = default', one(`SELECT approval_mode FROM managed_agent_session WHERE session_id='${S}'`) === 'default');
let p = await waitPending(S, { timeoutMs: 60_000 });
await respond('public', S, p.action, 'allow', { key: k('allow1') });
let t = await waitTurn(S, { timeoutMs: 60_000 });
r.check('initial Turn COMPLETED after approval', t.status === 'COMPLETED', j(t));
const seen = [p.action.id];
const l2 = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_WRITE name=p2-${tag}.txt content=second`), { actor: 'alice', key: k('later2') });
p = await waitPending(S, { timeoutMs: 60_000, not: seen });
r.check('later Turn waits for approval', !p.timeout, p.timeout ? 'timeout' : p.action.id);
const pendingId = p.action.id;
seen.push(pendingId);
const ex0 = executions(S);
if (MODE === 'revoke') sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
else sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE ${W}`);
const t0 = Date.now();
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: l2.json.turn_id }, { actor: 'alice', key: k('cancel') });
r.note(`cancel under ${MODE} while an Action is pending`, `${c.status} ${c.json.status ?? c.json.error?.code} in ${c.ms} ms`);
t = await waitTurn(S, { timeoutMs: 60_000 });
const endAt = Date.now() - t0;
await sleep(1500);
r.note('Turn end', `${t.status} ${t.error} at +${endAt} ms`);
r.note('pending Action row after the cancel (state, receipt, digest)', j(actionRow(pendingId)));
const la = await listActions('public', S);
r.note('public Actions list after the cancel', j((la.json.data ?? []).map((x) => ({ id: x.id, status: x.status ?? x.state }))));
const late = await respond('public', S, p.action, 'allow', { key: k('late') });
r.note('answering the cancelled Turn\'s Action', `${late.status} ${late.json.error?.code ?? late.json.status}`);
await sleep(1500);
r.note(`Workspace file child/p2-${tag}.txt`, `${readWs(ST, `child/p2-${tag}.txt`)}; executions added=${executions(S) - ex0}`);
r.check('cancel 202, Turn CANCELLED, file not written', c.status === 202 && t.status === 'CANCELLED' && readWs(ST, `child/p2-${tag}.txt`) === null, `${c.status} ${t.status}`);
restore();
const l3 = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_WRITE name=p3-${tag}.txt content=third`), { actor: 'alice', key: k('later3') });
p = await waitPending(S, { timeoutMs: 60_000, not: seen });
if (!p.timeout) { await respond('public', S, p.action, 'allow', { key: k('allow3') }); }
t = await waitTurn(S, { timeoutMs: 60_000 });
r.check('after restore the next later Turn completes', t.status === 'COMPLETED' && readWs(ST, `child/p3-${tag}.txt`) === 'THIRD', `${l3.status} ${j(t)} ${readWs(ST, `child/p3-${tag}.txt`)}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, mode: MODE, cancel: c.status, end: t, action: actionRow(pendingId) });
process.exit(0);
