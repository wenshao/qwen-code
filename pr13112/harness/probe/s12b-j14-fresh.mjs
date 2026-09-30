// VERIFICATION RIG ONLY (PR #13112): J14 mutant jar from a fresh start: carol created her own bound Session, then drives alice's.
import { api, one, register, waitTurn, executions, readWs, sql, Report, TENANT, j } from './lib.mjs';
const r = new Report('s12b-j14-fresh');
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='ws-a'`) === '0') register('ws-a', 'st-a');
const k = (s) => `${s}-${Date.now()}`;
const mk = async (actor, text) => { const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text }], workspace: { workspace_id: 'ws-a', cwd_relative: 'child' } }, { actor, key: k(actor) }); await waitTurn(c.json.id, { timeoutMs: 90_000 }); return c.json.id; };
const A = await mk('alice', 'G_FILES name=a.txt tag=a0');
const B = await mk('bob-none', 'PLAIN');
const C = await mk('carol', 'G_FILES name=c.txt tag=c0');
const before = executions(A);
const x = await api('POST', `/v1/agents/sessions/${A}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=carol-was-here.txt tag=j14' }] }, { actor: 'carol', key: k('j14') });
const t = x.status === 202 ? await waitTurn(A, { timeoutMs: 90_000 }) : null;
r.note("J14 jar: carol (created her own Session C) submits to alice's Session A", `${x.status} ${x.json.error?.code ?? ''} ${t ? j(t) : ''}`);
r.note("alice's Workspace after carol's Turn", `child/carol-was-here.txt=${JSON.stringify(readWs('a', 'child/carol-was-here.txt'))}; A executions ${before} -> ${executions(A)}`);
r.note("execution authority for A (creator row)", j(sql(`SELECT CONVERT(actor_id USING utf8mb4) FROM managed_workspace_create_command WHERE session_id='${A}'`)));
r.done();
