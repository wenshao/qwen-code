// VERIFICATION RIG ONLY (PR #13112): admission vs execution after the Workspace generation moves (re-registration).
import { api, sql, one, register, waitTurn, modelCalls, Report, TENANT, j } from './lib.mjs';
const [WS, ST] = [process.argv[2] ?? 'ws-c', process.argv[3] ?? 'c'];
const r = new Report(`s13-generation-drift-${WS}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const k = (s) => `${s}-${Date.now()}`;
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=gen.txt tag=g0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: k('c') });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', '');
sql(`UPDATE managed_workspace_registry SET workspace_generation = workspace_generation + 1 WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`);
const caps = (await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor: 'alice' })).json.capabilities;
const m0 = modelCalls();
const t = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=gen.txt tag=g1' }] }, { actor: 'alice', key: k('t') });
const w = t.status === 202 ? await waitTurn(S, { timeoutMs: 90_000 }) : null;
r.note('after a generation bump: capability / later Turn', `workspaceTurns=${caps?.workspaceTurns} submit=${t.status} ${t.json.error?.code ?? ''} turn=${w ? j(w) : '-'} modelCalls+${modelCalls() - m0}`);
const rn = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'gen drift' }, { actor: 'alice', key: k('rn') });
r.note('after a generation bump: rename', `${rn.status} ${rn.json.error?.code ?? rn.json.metadata?.title} pending=${one(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id='${S}' AND command_status='PENDING'`)}`);
sql(`UPDATE managed_workspace_registry SET workspace_generation = workspace_generation - 1 WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`);
r.done({ session: S });
