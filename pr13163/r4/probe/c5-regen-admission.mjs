// VERIFICATION RIG ONLY (PR #13163): after a re-registration (generation or storage moves), are submit and rename
// refused before any Turn or command row is written, and does the Session recover once the binding is current again?
// usage: DB=<db> node c5-regen-admission.mjs <workspace> <storage> <regen|storage>
import { api, sql, one, register, waitTurn, turnRow, modelCalls, Report, TENANT, j } from './lib.mjs';
const [WS, ST, MODE] = [process.argv[2], process.argv[3], process.argv[4] ?? 'regen'];
const r = new Report(`c5-${MODE}-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=1, storage_id='st-${ST}' WHERE ${W}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=gen.txt tag=g0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const counts = () => ({ turns: Number(one(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${S}'`)), commands: sql(`SELECT operation, command_status FROM managed_agent_command WHERE session_id='${S}' ORDER BY created_at`).map((x) => x.join(':')) });
if (MODE === 'regen') sql(`UPDATE managed_workspace_registry SET workspace_generation=workspace_generation+1 WHERE ${W}`);
else sql(`UPDATE managed_workspace_registry SET storage_id='st-h' WHERE ${W}`);
const before = counts();
const caps = (await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor: 'alice' })).json.capabilities;
const m0 = modelCalls();
const t = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=gen.txt tag=g1' }] }, { actor: 'alice', key: k('t') });
const w = t.status === 202 ? await waitTurn(S, { timeoutMs: 90_000 }) : null;
const rn = await api('PATCH', `/v1/agents/sessions/${S}`, { title: `drift ${MODE}` }, { actor: 'alice', key: k('rn') });
const after = counts();
r.note(`after ${MODE}: capability`, `workspaceTurns=${caps?.workspaceTurns}`);
r.note(`after ${MODE}: submit`, `${t.status} ${t.json.error?.code ?? t.json.turn_id} in ${t.ms} ms; turn=${w ? j(w) : '-'}; model calls +${modelCalls() - m0}`);
r.note(`after ${MODE}: rename`, `${rn.status} ${rn.json.error?.code ?? rn.json.metadata?.title}`);
r.note('rows before -> after the refused requests', `${j(before)} -> ${j(after)}`);
r.check('submit refused 409 workspace_unavailable', t.status === 409 && t.json.error?.code === 'workspace_unavailable', `${t.status} ${t.json.error?.code}`);
r.check('no Turn row written', after.turns === before.turns, `${before.turns} -> ${after.turns}`);
r.check('rename refused 409', rn.status === 409, `${rn.status} ${rn.json.error?.code}`);
r.check('no command row written', after.commands.length === before.commands.length, `${before.commands.length} -> ${after.commands.length}`);
sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=1, storage_id='st-${ST}' WHERE ${W}`);
const rn2 = await api('PATCH', `/v1/agents/sessions/${S}`, { title: `restored ${MODE}` }, { actor: 'alice', key: k('rn2') });
const t2 = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=gen.txt tag=g2' }] }, { actor: 'alice', key: k('t2') });
const w2 = t2.status === 202 ? await waitTurn(S, { timeoutMs: 90_000 }) : null;
r.check('after restore: rename 200 and later Turn COMPLETED', rn2.status === 200 && w2?.status === 'COMPLETED', `${rn2.status} ${rn2.json.error?.code ?? rn2.json.metadata?.title}; ${t2.status} ${w2?.status}`);
r.note('Turn history', j(turnRow(S)));
r.done({ session: S, mode: MODE, workspaceTurns: caps?.workspaceTurns, submit: { status: t.status, code: t.json.error?.code, ms: t.ms, turn: w }, rename: { status: rn.status, code: rn.json.error?.code }, before, after });
process.exit(0);
