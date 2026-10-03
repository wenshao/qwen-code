// VERIFICATION RIG ONLY (PR #13163): the creator cancels a running later Turn of a bound Session while the
// Workspace authorization that admits new work is refused. The refusal stays in place until the Turn has ended
// (RESTORE=late, default) or is lifted 1 s after the cancel (RESTORE=early).
// usage: DB=<db> node c1-cancel-refused.mjs <workspace> <storage> <mode> [actor]
//   mode: revoke | draining | regen | storage | unread | control
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, modelEntries, Report, sleep, TENANT, j } from './lib.mjs';

const [WS, ST, MODE, ACTOR] = [process.argv[2], process.argv[3], process.argv[4] ?? 'revoke', process.argv[5] ?? 'alice'];
const RESTORE = process.env.RESTORE ?? 'late';
const HOLD = Number(process.env.HOLD ?? 30000);
const r = new Report(`c1-${MODE}-${ACTOR}-${RESTORE}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
const block = {
  revoke: () => sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE ${W} AND actor_id='alice'`),
  draining: () => sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE ${W}`),
  regen: () => sql(`UPDATE managed_workspace_registry SET workspace_generation=workspace_generation+1 WHERE ${W}`),
  storage: () => sql(`UPDATE managed_workspace_registry SET storage_id='st-h' WHERE ${W}`),
  unread: () => sql(`UPDATE managed_workspace_access SET can_read=FALSE, can_create=FALSE WHERE ${W} AND actor_id='alice'`),
  control: () => {},
}[MODE];
const unblock = () => {
  sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=TRUE WHERE ${W} AND actor_id='alice'`);
  sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=1, storage_id='st-${ST}' WHERE ${W}`);
};
unblock();

const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=base.txt tag=c0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const ex0 = executions(S);
const file = `late-${MODE}-${Date.now() % 100000}.txt`;
const tag = `c1-${MODE}-${Date.now() % 100000}`;
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_SLOW name=${file} hold=${HOLD} tag=${tag}`), { actor: 'alice', key: k('slow') });
r.check('later Turn admitted', sub.status === 202, `${sub.status} ${sub.json.turn_id ?? sub.json.error?.code}`);
for (let i = 0; i < 300 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
const t0 = Date.now();
block();
const caps = (await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor: 'alice' })).json.capabilities;
const cancel = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: ACTOR, key: k('cancel') });
r.note(`cancel by ${ACTOR} under ${MODE}`, `${cancel.status} ${cancel.json.status ?? cancel.json.error?.code} in ${cancel.ms} ms; workspaceTurns=${caps?.workspaceTurns}`);
if (RESTORE === 'early') { await sleep(1000); unblock(); r.note('refusal lifted', `+${Date.now() - t0} ms`); }
const end = await waitTurn(S, { timeoutMs: HOLD + 60_000 });
const endAt = Date.now() - t0;
await sleep(1500);
const aborted = modelEntries().find((e) => e.kind === 'SLOW-aborted' && e.tag === tag);
const replied = modelEntries().find((e) => e.kind === 'SLOW-reply' && e.tag === tag);
const content = readWs(ST, `child/${file}`);
r.note('Turn end', `${end.status} ${end.error} at +${endAt} ms`);
r.note('model request', aborted ? `aborted after ${aborted.heldMs} ms` : replied ? `NOT aborted: answered with write_file after ${HOLD} ms` : 'neither');
r.note(`Workspace file child/${file}`, `${content}`);
const exLater = executions(S) - ex0;
r.note('tool executions added by the later Turn', `${exLater}`);
if (RESTORE === 'late') { unblock(); r.note('refusal lifted after the Turn ended', `+${Date.now() - t0} ms`); }
// The Session must still take a later Turn once authorization is back.
const next = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_WRITE name=after-${file} content=after`), { actor: 'alice', key: k('next') });
const nextEnd = next.status === 202 ? await waitTurn(S, { timeoutMs: 90_000 }) : null;
r.note('next later Turn after restore', `${next.status} ${next.json.error?.code ?? ''} -> ${nextEnd ? nextEnd.status : '-'}; file=${readWs(ST, `child/after-${file}`)}`);
r.note('Turn history', j(turnRow(S)));
const commands = sql(`SELECT operation, command_status FROM managed_agent_command WHERE session_id='${S}' ORDER BY created_at`);
r.note('command rows', j(commands));
r.done({ session: S, mode: MODE, actor: ACTOR, restore: RESTORE, cancel: { status: cancel.status, code: cancel.json.error?.code ?? cancel.json.status, ms: cancel.ms }, workspaceTurns: caps?.workspaceTurns, end: { ...end, at: endAt }, aborted: aborted?.heldMs ?? null, replied: !!replied, file: content, executionsAdded: exLater, next: nextEnd?.status ?? next.status });
process.exit(0);
