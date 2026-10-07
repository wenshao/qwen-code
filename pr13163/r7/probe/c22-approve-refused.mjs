// VERIFICATION RIG ONLY (PR #13163, round 7): R1-5. A later Turn waits on an approval Action; the creator approves;
// the first delivery of the answer to the Harness gets a retryable 503 (tap); during the retry backoff can_create is
// revoked, so the next delivery meets the non-retryable workspace_unavailable. Does the answer settle (FAILED) or
// retry forever, and can the creator still cancel the Turn? Spring runs with QWEN_MANAGED_AGENT_APPROVAL_MODE=default.
// usage: DB=<db> node c22-approve-refused.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, waitPending, respond, setTapRules, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST] = process.argv.slice(2);
const r = new Report(`c22-approve-refused-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const restore = () => sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`);
restore();
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const tag = Date.now() % 100000;
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_WRITE name=a1-${tag}.txt content=first` }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = created.json.id;
let p = await waitPending(S, { timeoutMs: 60_000 });
const first = p.action.id;
await respond('public', S, p.action, 'allow', { key: k('allow1') });
r.check('initial Turn COMPLETED after approval', (await waitTurn(S, { timeoutMs: 60_000 })).status === 'COMPLETED');
const l2 = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_WRITE name=a2-${tag}.txt content=second`), { actor: 'alice', key: k('later2') });
p = await waitPending(S, { timeoutMs: 60_000, not: [first] });
r.check('later Turn waits for approval', !p.timeout, p.timeout ? 'timeout' : p.action.id);
const path = (e) => e.path?.startsWith(`/session/${S}/actions/`) && e.path.endsWith('/resolve');
setTapRules([{ match: `POST /session/${S}/actions/.*/resolve`, action: 'respond', status: 503, body: { error: { code: 'rig_unavailable' } }, times: 1 }]);
await sleep(300);
const ex0 = executions(S);
const a = await api('POST', `/v1/agents/sessions/${S}/actions/${p.action.id}/responses`, { kind: 'permission', option_id: 'allow', input_revision: p.action.input_revision ?? p.action.inputRevision, policy_revision: p.action.policy_revision ?? p.action.policyRevision }, { actor: 'alice', key: k('allow2') });
for (let i = 0; i < 100 && !tapEntries().some((e) => path(e) && e.fault === 'respond'); i++) await sleep(100);
sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`);
const t0 = Date.now();
setTapRules([]);
const opq = () => sql(`SELECT state, COALESCE(error_code,''), attempt_count FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`)[0];
let op = opq();
for (let i = 0; i < 300 && op && !['COMPLETED', 'FAILED'].includes(op[0]); i++) { await sleep(100); op = opq(); }
const opMs = Date.now() - t0;
r.note('approval answer (public)', `${a.status} ${a.json.status ?? a.json.error?.code ?? ''}`);
r.note('answer operation 30 s after can_create was revoked (state, error, attempts)', `${j(op)}${['COMPLETED', 'FAILED'].includes(op?.[0]) ? ` at +${opMs} ms` : ' (not settled)'}`);
r.note('resolve calls reaching the Harness', j(tapEntries().filter(path).map((e) => `${e.fault ?? '-'}:${e.status ?? '-'}`)));
r.note('Action row', j(sql(`SELECT state, COALESCE(decision_receipt_id,'') FROM managed_agent_action WHERE action_id='${p.action.id}'`)[0]));
r.note('Turn before the cancel', j(turnRow(S).at(-1)));
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: l2.json.turn_id }, { actor: 'alice', key: k('cancel') });
const end = await waitTurn(S, { timeoutMs: 60_000 });
r.note('creator cancel after that', `${c.status} ${c.json.status ?? c.json.error?.code} → ${end.status} ${end.error ?? ''} ${end.timeout ? '(not terminal)' : `at +${end.ms} ms`}`);
await sleep(1000);
r.note(`Workspace file child/a2-${tag}.txt / executions added`, `${readWs(ST, `child/a2-${tag}.txt`)} / ${executions(S) - ex0}`);
restore();
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, answer: a.status, op, opMs, cancel: c.status, end: end.status });
process.exit(0);
