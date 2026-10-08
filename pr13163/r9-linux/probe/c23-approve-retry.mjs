// VERIFICATION RIG ONLY (PR #13163, round 9): R3-1 / 234037eb + 00be8ed0 on the real stack.
// A later Turn waits on an approval Action; the creator approves; the first delivery of the answer to the Harness
// gets a retryable 503 (tap); during the retry backoff the operator changes Workspace state (MODE). We then watch
// the ACTION_RESPONSE operation for HOLD ms, and finally either restore the state (AFTER=restore) or have the
// creator cancel the Turn while the state stays changed (AFTER=cancel).
// Expected at head: operator-reversible refusals (revoke / draining / unread) keep the answer PENDING and
// undelivered, and a restore delivers it exactly once; a structural change (regen / storage) still fails it
// terminally; a cancel ends the Turn and settles the answer.
// usage: DB=<db> [HOLD=12000] node c23-approve-retry.mjs <workspace> <storage> <mode> <after>
//   mode: revoke | draining | unread | regen | storage      after: restore | cancel
import { execSync } from 'node:child_process';
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, waitPending, respond, setTapRules, tapEntries, Report, sleep, TENANT, j } from './lib.mjs';
const [WS, ST, MODE, AFTER] = process.argv.slice(2);
const HOLD = Number(process.env.HOLD ?? 12_000);
const r = new Report(`c23-approve-retry-${MODE}-${AFTER}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const restore = () => {
  if (MODE === 'hold503') setTapRules([]);
  sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=1, storage_id='st-${ST}' WHERE ${W}`);
  sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`);
};
const fault = {
  revoke: () => sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`),
  draining: () => sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE ${W}`),
  unread: () => sql(`UPDATE managed_workspace_access SET can_read=FALSE, can_create=FALSE WHERE ${W} AND actor_id='alice'`),
  regen: () => sql(`UPDATE managed_workspace_registry SET workspace_generation=workspace_generation+1 WHERE ${W}`),
  storage: () => sql(`UPDATE managed_workspace_registry SET storage_id='st-h' WHERE ${W}`),
  // Control without any Workspace change: the Harness keeps answering 503 until the "restore" clears the tap rule.
  hold503: () => {},
}[MODE];
if (!fault || !['restore', 'cancel'].includes(AFTER)) throw new Error(`bad args ${MODE} ${AFTER}`);
const reversible = ['revoke', 'draining', 'unread', 'hold503'].includes(MODE);
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
const A = p.action.id;
const isResolve = (e) => e.path?.startsWith(`/session/${S}/actions/`) && e.path.endsWith('/resolve');
const resolves = () => tapEntries().filter(isResolve).map((e) => `${e.fault ?? '-'}:${e.status ?? '-'}`);
// Count only deliveries of THIS answer: resolve calls after the injected 503 (the first Action's resolve precedes it).
const delivered = () => { const all = tapEntries().filter(isResolve); const i = all.findIndex((e) => e.fault === 'respond'); return i < 0 ? 0 : all.slice(i + 1).filter((e) => !e.fault && e.status >= 200 && e.status < 300).length; };
setTapRules([{ match: `POST /session/${S}/actions/.*/resolve`, action: 'respond', status: 503, body: { error: { code: 'rig_unavailable' } }, times: 1 }]);
await sleep(300);
const ex0 = executions(S);
const a = await respond('public', S, p.action, 'allow', { key: k('allow2') });
for (let i = 0; i < 100 && !tapEntries().some((e) => isResolve(e) && e.fault === 'respond'); i++) await sleep(100);
fault();
const t0 = Date.now();
if (MODE === 'hold503') setTapRules([{ match: `POST /session/${S}/actions/.*/resolve`, action: 'respond', status: 503, body: { error: { code: 'rig_unavailable' } }, times: 100000 }]);
else setTapRules([]);
const opq = () => sql(`SELECT state, COALESCE(error_code,''), attempt_count FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`)[0];
const actionState = () => sql(`SELECT state, COALESCE(decision_receipt_id,'') FROM managed_agent_action WHERE action_id='${A}'`)[0];
const settledOp = (o) => o && ['COMPLETED', 'FAILED'].includes(o[0]);
// Hold: sample the operation while the changed state stands.
const seen = new Set(); let op = opq(); let settledAt = null;
while (Date.now() - t0 < HOLD) { op = opq(); seen.add(op?.[0]); if (settledOp(op) && settledAt === null) settledAt = Date.now() - t0; await sleep(200); }
r.note('approval answer (public)', `${a.status} ${a.json?.status ?? a.json?.error?.code ?? ''}`);
r.note(`answer operation after ${HOLD} ms under ${MODE} (state, error, attempts)`, `${j(op)}${settledAt !== null ? ` settled at +${settledAt} ms` : ' (not settled)'}; states seen ${j([...seen])}`);
r.note('resolve calls reaching the Harness during the hold', j(resolves()));
r.note('Action row during the hold', j(actionState()));
r.note(`Workspace file child/a2-${tag}.txt during the hold`, String(readWs(ST, `child/a2-${tag}.txt`)));
const holdDelivered = delivered();
const holdFile = readWs(ST, `child/a2-${tag}.txt`);
if (reversible) {
  r.check(`${MODE}: answer stays retryable (PENDING, not FAILED) while the state is changed`, !settledOp(op), j(op));
  r.check(`${MODE}: nothing delivered to the Harness while the state is changed`, holdDelivered === 0 && holdFile === null, `delivered=${holdDelivered} file=${holdFile}`);
} else {
  r.check(`${MODE}: structural change fails the answer terminally`, op?.[0] === 'FAILED' && op?.[1] === 'workspace_unavailable', j(op));
  r.check(`${MODE}: nothing delivered to the Harness`, holdDelivered === 0 && holdFile === null, `delivered=${holdDelivered} file=${holdFile}`);
}
let summary;
if (process.env.RESTART_CMD) {
  // Cold attachment cache (00be8ed0): restart the dispatcher replica while the changed state still stands.
  const tr = Date.now();
  const out = execSync(process.env.RESTART_CMD, { encoding: 'utf8' }).trim().split('\n').at(-1);
  r.note('dispatcher replica restarted with the state still changed (cold attachment cache)', `${out} (${Date.now() - tr} ms)`);
  await sleep(Number(process.env.POST_RESTART_MS ?? 8000));
  const o = opq();
  r.note('answer operation after the restart, state still changed', `${j(o)}; resolve calls ${j(resolves())}`);
  if (reversible) r.check(`${MODE}: after the cold restart the answer is still retryable and undelivered`, !settledOp(o) && delivered() === 0, `${j(o)} delivered=${delivered()}`);
}
if (AFTER === 'restore') {
  restore();
  const t1 = Date.now();
  let o2 = opq();
  for (let i = 0; i < 400 && !settledOp(o2); i++) { await sleep(200); o2 = opq(); }
  const settleMs = Date.now() - t1;
  const end = await waitTurn(S, { timeoutMs: reversible ? 90_000 : 20_000 });
  await sleep(1000);
  const file = readWs(ST, `child/a2-${tag}.txt`);
  r.note('answer operation after the restore', `${j(o2)}${settledOp(o2) ? ` at +${settleMs} ms` : ' (not settled within 80 s)'}`);
  r.note('Action row after the restore', j(actionState()));
  r.note('Turn after the restore', `${end.status} ${end.error ?? ''} ${end.timeout ? '(not terminal)' : `at +${end.ms} ms`}`);
  r.note('resolve calls reaching the Harness (all)', j(resolves()));
  r.note(`Workspace file child/a2-${tag}.txt / executions added`, `${file} / ${executions(S) - ex0}`);
  if (reversible) {
    r.check('restore: the committed answer is delivered (op COMPLETED, Action decided)', o2?.[0] === 'COMPLETED' && actionState()?.[0] === 'decided', `${j(o2)} ${j(actionState())}`);
    r.check('restore: exactly one successful resolve reached the Harness', delivered() === 1, j(resolves()));
    r.check('restore: the Turn completes and the approved write lands', end.status === 'COMPLETED' && file !== null, `${end.status} file=${file}`);
  } else {
    r.check('restore after a structural failure: the failed answer is not resurrected', o2?.[0] === 'FAILED' && delivered() === 0 && file === null, `${j(o2)} delivered=${delivered()} file=${file}`);
  }
  summary = { op: o2, settleMs, end: end.status, file, delivered: delivered() };
  // Leave nothing running: a stranded Turn (structural arm) is cancelled so the next probe starts idle.
  if (end.timeout) {
    const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: l2.json.turn_id }, { actor: 'alice', key: k('cleanup-cancel') });
    const e2 = await waitTurn(S, { timeoutMs: 60_000 });
    r.note('cleanup cancel of the stranded Turn', `${c.status} → ${e2.status} ${e2.timeout ? '(not terminal)' : `at +${e2.ms} ms`}`);
  }
} else {
  const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: l2.json.turn_id }, { actor: 'alice', key: k('cancel') });
  const end = await waitTurn(S, { timeoutMs: 60_000 });
  r.note('creator cancel with the state still changed', `${c.status} ${c.json?.status ?? c.json?.error?.code ?? ''} → ${end.status} ${end.error ?? ''} ${end.timeout ? '(not terminal)' : `at +${end.ms} ms`}`);
  // The pending answer must settle once its Action is no longer requested; wait past one max backoff.
  const t1 = Date.now();
  let o2 = opq();
  for (let i = 0; i < 400 && !settledOp(o2); i++) { await sleep(200); o2 = opq(); }
  const settleMs = Date.now() - t1;
  const att1 = o2?.[2];
  await sleep(5000);
  const att2 = opq()?.[2];
  const file = readWs(ST, `child/a2-${tag}.txt`);
  r.note('answer operation after the cancel', `${j(o2)}${settledOp(o2) ? ` at +${settleMs} ms` : ' (not settled within 80 s)'}; attempts 5 s later ${att2}`);
  r.note('Action row after the cancel', j(actionState()));
  r.note('resolve calls reaching the Harness (all)', j(resolves()));
  r.note(`Workspace file child/a2-${tag}.txt / executions added`, `${file} / ${executions(S) - ex0}`);
  r.check('cancel: creator cancel is admitted and the Turn ends CANCELLED', c.status === 202 && end.status === 'CANCELLED', `${c.status} ${end.status}`);
  r.check('cancel: the pending answer settles and stops retrying', settledOp(o2) && att1 === att2, `${j(o2)} attempts ${att1}→${att2}`);
  r.check('cancel: the approved write never lands', file === null && delivered() === 0, `file=${file} delivered=${delivered()}`);
  summary = { op: o2, settleMs, cancel: c.status, end: end.status, file, delivered: delivered() };
  restore();
}
r.note('Harness calls for the Session after the first 503 (method path status)', j((() => { const all = tapEntries().filter((e) => e.path?.startsWith(`/session/${S}`) && !e.path.endsWith('/events') && !e.path.endsWith('/heartbeat')); const i = all.findIndex((e) => e.fault === 'respond'); return all.slice(i).map((e) => `${e.method} ${e.path.replace(S, ':id').replace(/actions\/[^/]+/, 'actions/:a')} ${e.fault ? e.fault + ':' : ''}${e.status ?? '-'}`).reduce((acc, x) => { const l = acc.at(-1); if (l && l[0] === x) l[1]++; else acc.push([x, 1]); return acc; }, []).map(([x, n]) => (n > 1 ? `${x} ×${n}` : x)); })()));
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, mode: MODE, after: AFTER, answer: a.status, hold: { op, settledAt, seen: [...seen], delivered: holdDelivered }, ...summary });
process.exit(0);
