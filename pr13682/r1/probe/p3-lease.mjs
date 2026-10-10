// VERIFICATION RIG ONLY (PR #13682): a slow approval delivery past its initial lease. The answer reaches the Harness
// at once, but the Harness's reply is held HOLD ms (tap delay-after, longer than the dispatch lease). A second,
// Harness-enabled replica C is running. We sample the ACTION_RESPONSE row every second: does the lease get renewed,
// and does C (or B) take the delivery over while A is still waiting?
// usage: DB=<db> HOLD=20000 node p3-lease.mjs <workspace> <storage>
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, waitPending, respond, setTapRules, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST] = process.argv.slice(2);
const HOLD = Number(process.env.HOLD ?? 20_000);
const r = new Report(`p3-lease-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const tag = Date.now() % 100000;
const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_WRITE name=a1-${tag}.txt content=first` }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = created.json.id;
let p = await waitPending(S, { timeoutMs: 60_000 });
const first = p.action.id;
await respond('public', S, p.action, 'allow', { key: k('allow1') });
r.check('initial Turn COMPLETED after approval', (await waitTurn(S, { timeoutMs: 60_000 })).status === 'COMPLETED');
await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_WRITE name=a2-${tag}.txt content=second`), { actor: 'alice', key: k('later2') });
p = await waitPending(S, { timeoutMs: 60_000, not: [first] });
r.check('later Turn waits for approval', !p.timeout);
const isResolve = (e) => e.path?.startsWith(`/session/${S}/actions/`) && e.path.endsWith('/resolve');
const mark = tapEntries().length;
setTapRules([{ match: `POST /session/${S}/actions/.*/resolve`, action: process.env.HOLD_MODE ?? 'delay', delayMs: HOLD, times: 1 }]);
await sleep(400);
const ex0 = executions(S);
const t0 = Date.now();
const ans = await respond('public', S, p.action, 'allow', { key: k('allow2') });
const opq = () => sql(`SELECT state, delivery_state, attempt_count, claim_generation, COALESCE(lease_owner,''), COALESCE(lease_until,0), COALESCE(error_code,'') FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`)[0];
const owners = new Map(); const tl = [];
let o = opq();
while (Date.now() - t0 < HOLD + 15_000 && !['COMPLETED', 'FAILED'].includes(o?.[0])) {
  o = opq();
  if (o?.[4] && !owners.has(o[4])) owners.set(o[4], `owner${owners.size + 1}`);
  const leaseLeft = o?.[5] ? Math.round((Number(o[5]) - Date.now()) / 1000) : null;
  const row = [Math.round((Date.now() - t0) / 1000), o?.[0], o?.[1], `att${o?.[2]}`, `gen${o?.[3]}`, owners.get(o?.[4]) ?? '-', leaseLeft === null ? '-' : `${leaseLeft}s`, o?.[6] || ''];
  if (j(tl.at(-1)?.slice(1)) !== j(row.slice(1))) tl.push(row);
  await sleep(1000);
}
const end = await waitTurn(S, { timeoutMs: 60_000 });
await sleep(1000);
const file = readWs(ST, `child/a2-${tag}.txt`);
const res = tapEntries().slice(mark).filter(isResolve).map((e) => `${e.fault ?? '-'}:${e.status}${e.heldMs ? ` held ${e.heldMs}` : ''}`);
r.note('answer', `${ans.status}`);
r.note('ACTION_RESPONSE row over time [s, state, delivery, attempts, claim gen, owner, lease left, error]', j(tl));
r.note('resolve calls reaching the Harness', j(res));
r.note('Turn / file / executions added', `${end.status} / ${file} / ${executions(S) - ex0}`);
const takeover = owners.size > 1 || tl.some((x) => x[4] !== 'gen1');
r.check('no other replica takes the delivery over while the reply is held', !takeover && res.length === 1, `owners ${owners.size}, attempts ${j([...new Set(tl.map((x) => x[3]))])}, resolves ${res.length}`);
r.check('the answer completes once and the Turn finishes', ['COMPLETED'].includes(o?.[0]) && end.status === 'COMPLETED' && file === 'SECOND', `${o?.[0]} ${end.status} ${file}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, timeline: tl, owners: owners.size, resolves: res, op: o, end: end.status, file });
process.exit(0);
