// VERIFICATION RIG ONLY (PR #13112): the creator's cancel is admitted while the Workspace cannot be authorized
// (grant revoked or Workspace DRAINING), then the condition clears. Does the cancelled Turn still write to the Workspace?
// usage: DB=<db> node s6-cancel-lost.mjs <workspace> <storage> <mode: revoke|draining|control>
import { api, sql, one, register, waitTurn, turnRow, executions, readWs, modelEntries, Report, sleep, TENANT, j } from './lib.mjs';

const [WS, ST, MODE] = [process.argv[2] ?? 'ws-e', process.argv[3] ?? 'e', process.argv[4] ?? 'revoke'];
const r = new Report(`s6-cancel-lost-${WS}-${MODE}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${WS}-${Date.now()}`;
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const block = () => MODE === 'revoke'
  ? sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE tenant_id='${TENANT}' AND workspace_id='${WS}' AND actor_id='alice'`)
  : MODE === 'draining' ? sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) : null;
const unblock = () => {
  sql(`UPDATE managed_workspace_access SET can_create=TRUE WHERE tenant_id='${TENANT}' AND workspace_id='${WS}' AND actor_id='alice'`);
  sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`);
};

const created = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=base.txt tag=c0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('create') });
const S = created.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', '');
const file = `late-${MODE}.txt`;
const tag = `slow-${MODE}-${Date.now() % 100000}`;
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, msg(`G_SLOW name=${file} hold=8000 tag=${tag}`), { actor: 'alice', key: k('slow') });
for (let i = 0; i < 200 && !modelEntries().some((e) => e.kind === 'SLOW' && e.tag === tag); i++) await sleep(100);
const t0 = Date.now();
block();
const cancel = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: sub.json.turn_id }, { actor: 'alice', key: k('cancel') });
r.note(`cancel admitted (${MODE})`, `${cancel.status} ${cancel.json.status ?? cancel.json.error?.code} at +${Date.now() - t0} ms`);
await sleep(1000);
unblock();
r.note('grant / Workspace state restored', `at +${Date.now() - t0} ms`);
const end = await waitTurn(S, { timeoutMs: 60_000 });
await sleep(1500);
const aborted = modelEntries().find((e) => e.kind === 'SLOW-aborted' && e.tag === tag);
const replied = modelEntries().find((e) => e.kind === 'SLOW-reply' && e.tag === tag);
r.note('Turn end', `${end.status} ${end.error} at +${Date.now() - t0} ms`);
r.note('model request', aborted ? `aborted after ${aborted.heldMs} ms (cancel reached the Harness)` : replied ? 'NOT aborted: model answered with write_file after the cancel' : 'neither');
r.note(`Workspace file child/${file} after the cancelled Turn`, `${readWs(ST, `child/${file}`)}`);
r.note('tool executions for the Session', `${executions(S)} (3 = only the initial Turn)`);
r.check(`cancel accepted with 202 (${MODE})`, cancel.status === 202, '');
r.check('cancelled Turn did not touch the Workspace', readWs(ST, `child/${file}`) === null, `${readWs(ST, `child/${file}`)}`);
r.check('Turn ended CANCELLED', end.status === 'CANCELLED', `${end.status}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S });
process.exit(r.fail ? 1 : 0);
