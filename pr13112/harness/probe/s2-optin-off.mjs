// VERIFICATION RIG ONLY (PR #13112): the same bound Session after Spring restarts WITHOUT harness.workspace-files-enabled.
// usage: DB=<db> node s2-optin-off.mjs <session> <label>
import { api, turnRow, Report, j } from './lib.mjs';

const [S, LABEL] = [process.argv[2], process.argv[3] ?? 'optin-off'];
const r = new Report(`s2-${LABEL}`);
const k = (s) => `${s}-${Date.now()}`;
const before = turnRow(S).length;
const g = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S }, { actor: 'alice' });
r.check('creator still reads the Session; capabilities.workspaceTurns=false', g.status === 200 && g.json.capabilities?.workspaceTurns === false, `${g.status} ${j(g.json.capabilities)}`);
const sub = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'PLAIN' }] }, { actor: 'alice', key: k('sub') });
r.check('creator later Turn -> 409 workspace_unavailable', sub.status === 409 && sub.json.error?.code === 'workspace_unavailable', `${sub.status} ${sub.json.error?.code}`);
const ws = await api('POST', '/api/agent/web-shell/v1/turns/submit', { sessionId: S, idempotencyKey: k('ws'), input: [{ type: 'input_text', text: 'PLAIN' }] }, { actor: 'alice' });
r.check('creator WebShell submit -> 409 workspace_unavailable', ws.status === 409 && ws.json.error?.code === 'workspace_unavailable', `${ws.status} ${ws.json.error?.code}`);
const last = turnRow(S).at(-1)[0];
const c = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: last }, { actor: 'alice', key: k('cancel') });
r.check('creator cancel -> 409 workspace_unavailable', c.status === 409 && c.json.error?.code === 'workspace_unavailable', `${c.status} ${c.json.error?.code}`);
const rn = await api('PATCH', `/v1/agents/sessions/${S}`, { title: 'off' }, { actor: 'alice', key: k('rename') });
r.check('creator rename -> 409 workspace_unavailable', rn.status === 409 && rn.json.error?.code === 'workspace_unavailable', `${rn.status} ${rn.json.error?.code}`);
r.check('no Turn added', turnRow(S).length === before, `${turnRow(S).length}`);
r.done();
process.exit(r.fail ? 1 : 0);
