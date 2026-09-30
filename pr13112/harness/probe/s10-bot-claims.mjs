// VERIFICATION RIG ONLY (PR #13112): runtime checks of three claims in the /review bot's round-1 findings.
// usage: DB=<db> node s10-bot-claims.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, turnRow, executions, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';

const [WS, ST] = [process.argv[2] ?? 'ws-a', process.argv[3] ?? 'a'];
const r = new Report(`s10-bot-claims-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const create = async (actor, text) => {
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor, key: k(`create-${actor}`) });
  await waitTurn(c.json.id, { timeoutMs: 90_000 });
  return c.json.id;
};

// (a) R1-12 location 1: a colleague who created her OWN bound Session on the same Workspace.
const A = await create('alice', 'G_FILES name=a.txt tag=a0');
const C = await create('carol', 'G_FILES name=c.txt tag=c0');
r.check('carol created her own bound Session on the same Workspace', turnRow(C).at(-1)?.[1] === 'COMPLETED', j(turnRow(C)));
const cg = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: A }, { actor: 'carol' });
r.check("alice's Session: carol's workspaceTurns=false", cg.json.capabilities?.workspaceTurns === false, j(cg.json.capabilities));
const before = executions(A);
const cs = await api('POST', `/v1/agents/sessions/${A}/events`, msg('G_FILES name=a.txt tag=by-carol'), { actor: 'carol', key: k('carol-submit') });
r.check("carol (creator of another bound Session) submits to alice's -> 409", cs.status === 409 && cs.json.error?.code === 'workspace_unavailable', `${cs.status} ${cs.json.error?.code}`);
const cr = await api('PATCH', `/v1/agents/sessions/${A}`, { title: 'by carol' }, { actor: 'carol', key: k('carol-rename') });
r.check("carol renames alice's -> 409", cr.status === 409, `${cr.status} ${cr.json.error?.code}`);
r.check("alice's Session gained no execution", executions(A) === before, `${executions(A)}`);

// (b) R1-3: rename by the creator after her can_create was revoked
sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE tenant_id='${TENANT}' AND workspace_id='${WS}' AND actor_id='alice'`);
const cmdBefore = Number(one(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id='${A}'`));
const rb = await api('PATCH', `/v1/agents/sessions/${A}`, { title: 'after revoke' }, { actor: 'alice', key: k('rename-revoked') });
r.note('R1-3: creator rename after can_create revoked', `${rb.status} ${rb.json.error?.code ?? ''} "${rb.json.error?.message ?? ''}" retryable-header=${rb.headers['retry-after'] ?? '-'}`);
r.note('R1-3: command rows / title after the refusal', `commands +${Number(one(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id='${A}'`)) - cmdBefore}, pending=${one(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id='${A}' AND command_status='PENDING'`) ?? '?'}, title=${JSON.stringify(one(`SELECT COALESCE(title,'') FROM managed_agent_session WHERE session_id='${A}'`))}`);
const ev = await api('GET', `/v1/agents/sessions/${A}/events?limit=200`, undefined, { actor: 'bob' });
const upd = (ev.json.data ?? []).filter((e) => String(e.type).startsWith('session.update'));
r.note('R1-3: public session.update* events', j(upd.map((e) => e.type)));
sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE tenant_id='${TENANT}' AND workspace_id='${WS}' AND actor_id='alice'`);
const ra = await api('PATCH', `/v1/agents/sessions/${A}`, { title: 'after restore' }, { actor: 'alice', key: k('rename-restored') });
r.note('R1-3: rename again after the grant is restored', `${ra.status} ${ra.json.metadata?.title ?? ra.json.error?.code}`);

// (c) R1-15: rename of a bound Session created with empty input
const e = await api('POST', '/api/agent/web-shell/v1/sessions/create', { agentId: 'qwen-code', idempotencyKey: k('empty'), input: [], workspace: { workspaceId: WS, cwdRelative: 'child' } }, { actor: 'alice' });
const E = e.json.sessionId;
await sleep(1500);
const tapBefore = tapEntries().filter((t) => t.method === 'POST' && t.path === '/session').length;
r.note('R1-15: empty-input bound Session', `${e.status} session=${E} turns=${turnRow(E).length} harness_boot_id=${one(`SELECT COALESCE(harness_boot_id,'NULL') FROM managed_agent_session WHERE session_id='${E}'`)}`);
const re = await api('PATCH', `/v1/agents/sessions/${E}`, { title: 'renamed empty' }, { actor: 'alice', key: k('rename-empty') });
await sleep(1000);
const creates = tapEntries().filter((t) => t.method === 'POST' && t.path === '/session');
const mine = creates.slice(tapBefore).filter((t) => JSON.stringify(t.body ?? {}).includes(E));
r.note('R1-15: rename result', `${re.status} ${re.json.metadata?.title ?? re.json.error?.code}`);
r.note('R1-15: Harness POST /session created by the rename', `${mine.length} (${mine.map((t) => `${t.status} toolProfile=${t.body?.toolProfile ?? t.body?.tool_profile ?? '?'}`).join(', ')})`);
r.note('R1-15: harness_boot_id after the rename', one(`SELECT COALESCE(harness_boot_id,'NULL') FROM managed_agent_session WHERE session_id='${E}'`));
r.done({ alice: A, carol: C, empty: E });
