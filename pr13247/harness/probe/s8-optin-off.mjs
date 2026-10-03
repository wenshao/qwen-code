// VERIFICATION RIG ONLY (PR #13247) S8: Spring restarted with workspace-files-enabled=false over a DB that holds bound Sessions.
import { api, Report, j, sql, one } from './lib.mjs';
import { pubChange, webChange, opId, pubOp } from './cwd.mjs';

const R = new Report('s8-optin-off');
const s = process.env.SESSION;
const done = one(`SELECT operation_id FROM managed_agent_operation WHERE session_id='${s}' AND operation_kind='CWD_CHANGE' AND state='COMPLETED' LIMIT 1`);
const rev = Number(one(`SELECT context_revision FROM managed_agent_session WHERE session_id='${s}'`));
const k = (p) => `s8-${p}-${Date.now()}`;
const cr = await pubChange(s, 'child', rev, { key: k('c') });
const wr = await webChange(s, 'child', rev, { key: k('w') });
R.check('creator: 409 workspace_unavailable on both surfaces', cr.status === 409 && cr.json.error?.code === 'workspace_unavailable' && wr.status === 409 && wr.json.error?.code === 'workspace_unavailable', `${cr.status} ${cr.json.error?.code} / ${wr.status} ${wr.json.error?.code}`);
const sm = await pubChange(s, 'child', rev, { key: k('m'), actor: 'mallory' });
const unknown = await pubChange('no-such-session', 'child', 1, { key: k('u'), actor: 'mallory' });
const gm = await api('GET', `/v1/agents/sessions/${s}`, undefined, { actor: 'mallory' });
R.note('stranger mallory on the bound Session (cwd) vs an unknown id vs GET', `${sm.status} ${sm.json.error?.code} | unknown ${unknown.status} ${unknown.json.error?.code} | GET ${gm.status} ${gm.json.error?.code ?? ''}`);
const keyRow = sql(`SELECT idempotency_key, target_cwd_relative, expected_context_revision FROM managed_agent_operation WHERE operation_id='${done}'`)[0];
const rp = await pubChange(s, keyRow[1], Number(keyRow[2]), { key: keyRow[0] });
R.note('replay of a completed change after the opt-in was turned off', `${rp.status} ${rp.json.error?.code ?? (rp.json.replayed ? 'replayed' : '')}`);
const g = await pubOp(s, done);
R.check('operation read still works with the opt-in off', g.status === 200 && g.json.status === 'completed', `${g.status} ${g.json.status}`);
R.done({});
