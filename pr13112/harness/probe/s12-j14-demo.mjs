// VERIFICATION RIG ONLY (PR #13112): with the J14 mutant jar (createdSession ignores session_id), what can carol do
// to alice's Session? Shows what the missing negative control guards.
import { api, waitTurn, executions, readWs, sql, Report, j } from './lib.mjs';
const [A, C] = [process.argv[2], process.argv[3]];
const r = new Report('s12-j14-demo');
const k = (s) => `${s}-${Date.now()}`;
const g = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: A }, { actor: 'carol' });
r.note("carol's workspaceTurns on alice's Session", j(g.json.capabilities));
const before = executions(A);
const x = await api('POST', `/v1/agents/sessions/${A}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=carol-was-here.txt tag=j14' }] }, { actor: 'carol', key: k('j14') });
const t = x.status === 202 ? await waitTurn(A, { timeoutMs: 90_000 }) : null;
r.note("carol submits to alice's Session", `${x.status} ${x.json.error?.code ?? ''} ${t ? j(t) : ''}`);
r.note("alice's Workspace file written by carol's Turn", `child/carol-was-here.txt=${JSON.stringify(readWs('a', 'child/carol-was-here.txt'))}; executions ${before} -> ${executions(A)}`);
r.note('whose grants authorized it', j(sql(`SELECT CONVERT(actor_id USING utf8mb4) FROM managed_workspace_create_command WHERE session_id='${A}'`)));
r.done();
