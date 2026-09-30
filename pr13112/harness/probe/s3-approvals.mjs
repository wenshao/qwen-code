// VERIFICATION RIG ONLY (PR #13112): later Turns of a bound Session in approval mode "default" (D6b Actions).
// Spring must run with QWEN_MANAGED_AGENT_APPROVAL_MODE=default.  usage: DB=<db> node s3-approvals.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, waitPending, respond, listActions, actionRow, modelEntries, Report, sleep, TENANT, j } from './lib.mjs';

const [WS, ST] = [process.argv[2] ?? 'ws-b', process.argv[3] ?? 'b'];
const r = new Report(`s3-approvals-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });

const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_WRITE name=a1.txt content=first' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('Session approval_mode = default', one(`SELECT approval_mode FROM managed_agent_session WHERE session_id='${S}'`) === 'default', one(`SELECT approval_mode FROM managed_agent_session WHERE session_id='${S}'`));
let p = await waitPending(S, { timeoutMs: 60_000 });
r.check('initial Turn asks for approval', !p.timeout, p.timeout ? j(p.last?.json).slice(0, 200) : p.action.id);
let a = await respond('public', S, p.action, 'allow', { key: k('allow1') });
r.check('creator allows -> 202', a.status === 202 || a.status === 200, `${a.status}`);
let t = await waitTurn(S, { timeoutMs: 60_000 });
r.check('initial Turn COMPLETED, a1.txt = FIRST', t.status === 'COMPLETED' && readWs(ST, 'child/a1.txt') === 'FIRST', `${j(t)} ${readWs(ST, 'child/a1.txt')}`);
const seen = [p.action.id];

// later Turn with an approval
const l2 = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_WRITE name=a2.txt content=second'), { actor: 'alice', key: k('later2') });
r.check('creator later Turn -> 202', l2.status === 202, `${l2.status} ${l2.json.error?.code ?? ''}`);
p = await waitPending(S, { timeoutMs: 60_000, not: seen });
r.check('later Turn asks for approval', !p.timeout, p.timeout ? 'timeout' : p.action.id);
seen.push(p.action.id);
const carol = await respond('public', S, p.action, 'allow', { key: k('carol'), actor: 'carol' });
r.check('another creator-capable actor cannot answer (D6b creator rule)', carol.status >= 400, `${carol.status} ${carol.json.error?.code}`);
a = await respond('public', S, p.action, 'allow', { key: k('allow2') });
t = await waitTurn(S, { timeoutMs: 60_000 });
r.check('creator allows; later Turn COMPLETED, a2.txt = SECOND', t.status === 'COMPLETED' && readWs(ST, 'child/a2.txt') === 'SECOND', `${a.status} ${j(t)} ${readWs(ST, 'child/a2.txt')}`);

// cancel a later Turn that is waiting for an approval
const l3 = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_WRITE name=a3.txt content=third'), { actor: 'alice', key: k('later3') });
p = await waitPending(S, { timeoutMs: 60_000, not: seen });
r.check('third Turn waits for approval', !p.timeout, p.timeout ? 'timeout' : p.action.id);
const pendingId = p.action.id;
seen.push(pendingId);
const cStart = Date.now();
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: l3.json.turn_id }, { actor: 'alice', key: k('cancel3') });
r.check('creator cancels the waiting Turn -> 202', c.status === 202, `${c.status} ${c.json.error?.code ?? ''}`);
t = await waitTurn(S, { timeoutMs: 40_000 });
r.check('waiting Turn ends CANCELLED', t.status === 'CANCELLED', `${j(t)} after ${Date.now() - cStart} ms`);
await sleep(1500);
r.check('a3.txt was not written', readWs(ST, 'child/a3.txt') === null, `${readWs(ST, 'child/a3.txt')}`);
r.note('the pending Action after the cancel (state, receipt, digest)', j(actionRow(pendingId)));
const la = await listActions('public', S);
r.note('public actions list after the cancel', j((la.json.data ?? []).map((x) => ({ id: x.id, status: x.status ?? x.state }))));
const late = await respond('public', S, p.action, 'allow', { key: k('late') });
r.check('answering the cancelled Turn\'s Action is refused', late.status >= 400, `${late.status} ${late.json.error?.code}`);

// the Session keeps working
const l4 = await api('POST', `/v1/agents/sessions/${S}/events`, msg('G_WRITE name=a4.txt content=fourth'), { actor: 'alice', key: k('later4') });
p = await waitPending(S, { timeoutMs: 60_000, not: seen });
r.check('fourth Turn asks for approval (Workspace free after the cancel)', l4.status === 202 && !p.timeout, `${l4.status} ${p.timeout ? 'timeout' : p.action.id}`);
if (!p.timeout) {
  a = await respond('public', S, p.action, 'allow', { key: k('allow4') });
  t = await waitTurn(S, { timeoutMs: 60_000 });
  r.check('fourth Turn COMPLETED, a4.txt = FOURTH', t.status === 'COMPLETED' && readWs(ST, 'child/a4.txt') === 'FOURTH', `${j(t)} ${readWs(ST, 'child/a4.txt')}`);
}
r.note('Turn history', j(turnRow(S)));
r.done({ session: S });
process.exit(r.fail ? 1 : 0);
