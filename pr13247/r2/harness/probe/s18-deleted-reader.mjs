// VERIFICATION RIG ONLY (PR #13247 R2) S18: a readable non-creator on a DELETED (tombstoned) bound Session — cwd vs sibling routes.
import { api, Report, ensureWorkspace, createSession, waitTurn, j, sql, WS, ST } from './lib.mjs';
import { pubChange, webChange } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's18-deleted-reader');
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, 'PLAIN'); await waitTurn(c.session);
const s = c.session;
sql(`UPDATE managed_agent_session SET status='DELETED' WHERE session_id='${s}'`);
const k = (p) => `s18-${p}-${Date.now()}`;
const rows = [];
for (const actor of ['alice', 'bob', 'mallory']) {
  const cwd = await pubChange(s, 'child', 1, { key: k(`c-${actor}`), actor });
  const wcwd = await webChange(s, 'child', 1, { key: k(`w-${actor}`), actor });
  const get = await api('GET', `/v1/agents/sessions/${s}`, undefined, { actor });
  const close = await api('POST', `/v1/agents/sessions/${s}/close`, undefined, { key: k(`cl-${actor}`), actor });
  const archive = await api('POST', `/v1/agents/sessions/${s}/archive`, undefined, { key: k(`ar-${actor}`), actor });
  const del = await api('DELETE', `/v1/agents/sessions/${s}`, undefined, { key: k(`dl-${actor}`), actor });
  const turn = await api('POST', `/v1/agents/sessions/${s}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'PLAIN' }] }, { key: k(`t-${actor}`), actor });
  const f = (r) => `${r.status} ${r.json.error?.code ?? r.json.status ?? ''}`.trim();
  const row = { actor, cwd: f(cwd), webCwd: f(wcwd), get: f(get), close: f(close), archive: f(archive), delete: f(del), turn: f(turn) };
  rows.push(row); R.note(actor, j(row));
}
R.done({ rows });
