// VERIFICATION RIG ONLY: the PR server on a database that the base server created (Flyway V23 applied at startup).
// usage: DB=d6up node s8b-upgraded.mjs
import fs from 'node:fs';
import { api, one, sql, listActions, getOp, waitTurn, waitOp, sessionRow, Report, j, RIG, DB } from './lib.mjs';
const BASE_V = process.env.BASE_V ?? '22';
const NEW_V = process.env.NEW_V ?? '23';
const R = new Report(`s8b-upgraded-v${BASE_V}-to-v${NEW_V}`);
const st = JSON.parse(fs.readFileSync(`${RIG}/out/${DB}/base-state.json`, 'utf8'));
const hist = sql(`SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 2`);
R.check(`Flyway applied V${NEW_V} (managed actions) on top of the base schema V${BASE_V}`, hist[0][0] === NEW_V && hist[0][1] === 'managed actions' && hist[0][2] === '1' && hist[1][0] === BASE_V, j(hist));
const old = [st.bound, st.closed, st.open].map((id) => `'${id}'`).join(',');
R.check('Sessions created before the migration default to yolo', sql(`SELECT DISTINCT approval_mode FROM managed_agent_session WHERE session_id IN (${old})`).map((r) => r[0]).join() === 'yolo', `modes=${j(sql(`SELECT approval_mode, COUNT(*) FROM managed_agent_session WHERE session_id IN (${old}) GROUP BY approval_mode`))}`);
const pub = await api('GET', `/v1/agents/sessions/${st.bound}`);
const web = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: st.bound });
R.check('old Workspace Session reads back; actions capability false on both surfaces', pub.status === 200 && pub.json.capabilities?.actions === false && web.json.capabilities?.actions === false, `public=${j(pub.json.capabilities)} web=${j(web.json.capabilities)}`);
const la = await listActions('public', st.bound);
const lw = await listActions('web', st.bound);
R.check('old Session: Action list answers 200 and empty', la.status === 200 && la.json.data.length === 0 && lw.status === 200 && lw.json.data.length === 0, `public=${j(la.json)} web=${j(lw.json)}`);
const ev = await api('GET', `/v1/agents/sessions/${st.bound}/events?limit=100`);
const turns = await api('GET', `/v1/agents/sessions/${st.bound}/turns`);
R.check('old Session: events and Turns still read', ev.status === 200 && JSON.stringify(ev.json).includes('D6_DONE') && turns.json.data?.[0]?.status === 'completed', `events HTTP ${ev.status}, turn=${turns.json.data?.[0]?.status}`);
const op = await getOp('public', st.closed, st.closeOp);
const same = j({ ...op.json, replayed: undefined }) === j({ ...st.closeOpBody, replayed: undefined });
R.check('a lifecycle operation completed before the migration reads back unchanged (no action fields)', op.status === 200 && same && !('action_resolution' in op.json) && !('failure_code' in op.json), j(op.json));
const close = await api('POST', `/v1/agents/sessions/${st.open}/close`, undefined, { key: 'close-after-upgrade' });
const cd = await waitOp(st.open, close.json.id, { timeoutMs: 90_000 }); // a killed Harness keeps its 60 s journal writer lease (D4)
R.check('lifecycle operations still run after the migration (close of a pre-migration Session)', close.status === 202 && cd.json.status === 'completed' && cd.json.type === 'close', `HTTP ${close.status} ${j(cd.json)}`);
const cols = sql(`SELECT column_name, column_type, is_nullable, COALESCE(column_default,'NULL') FROM information_schema.columns WHERE table_schema='${DB}' AND ((table_name='managed_agent_operation' AND column_name IN ('action_id','response_json','error_code','decision_receipt_id')) OR (table_name='managed_agent_session' AND column_name='approval_mode')) ORDER BY table_name, ordinal_position`);
R.note(`columns added by V${NEW_V}`, j(cols));
const ex = sql(`EXPLAIN SELECT * FROM managed_agent_action WHERE tenant_id = 't' AND session_id = 's' AND state = 'requested' ORDER BY created_at DESC, action_id DESC LIMIT 21`)[0];
R.check('the pending list query uses managed_agent_action_pending_idx', ex.join(' ').includes('managed_agent_action_pending_idx'), ex.join(' | '));
R.done();
