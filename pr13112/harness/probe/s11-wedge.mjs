// VERIFICATION RIG ONLY (PR #13112): after a refused rename left a PENDING mutation, what still works on the Session?
import { api, one, sql, waitTurn, Report, sleep, j } from './lib.mjs';
const S = process.argv[2];
const r = new Report('s11-wedge-' + (process.argv[3] ?? 't0'));
const k = (s) => `${s}-${Date.now()}`;
r.note('pending commands', j(sql(`SELECT operation, command_status, FROM_UNIXTIME(created_at/1000) FROM managed_agent_command WHERE session_id='${S}' AND command_status<>'COMPLETED'`)));
const t = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=a.txt tag=after-wedge-' + Date.now() % 1000 }] }, { actor: 'alice', key: k('turn') });
const w = t.status === 202 ? await waitTurn(S, { timeoutMs: 90_000 }) : null;
r.note('later Turn', `${t.status} ${t.json.error?.code ?? ''} ${w ? j(w) : ''}`);
const rn = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'retry ' + Date.now() % 1000 }, { actor: 'alice', key: k('rename') });
r.note('rename', `${rn.status} ${rn.json.metadata?.title ?? rn.json.error?.code}`);
const g = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
r.note('session', `${g.status} status=${g.json.status} title=${JSON.stringify(g.json.metadata?.title ?? g.json.title)}`);
r.done();
