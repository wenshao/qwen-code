// s9: the real public DELETE on a legacy (no Workspace) Session that never had a private journal head.
import * as L from './lib.mjs';
L.openLog('s9-legacy-delete');
const c = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code' }, { key: `legacy-${Date.now()}` });
const sid = c.json.id;
L.say('create', `${c.status} ${sid} workspace=${JSON.stringify(c.json.workspace ?? null)} head=${JSON.stringify(L.headRow(sid))}`);
const d = await L.api('DELETE', `/v1/agents/sessions/${sid}`, undefined, { key: `legacy-del-${sid}` });
const opId = d.json.operation_id ?? d.json.id;
L.say('delete', `${d.status} op=${opId} ${JSON.stringify(d.json).slice(0, 160)}`);
let op;
for (let i = 0; i < 120; i++) { op = await L.api('GET', `/v1/agents/sessions/${sid}/operations/${opId}`); if (/complet/i.test(JSON.stringify(op.json.status ?? op.json.state ?? ''))) break; await L.sleep(250); }
L.say('operation', `${op.status} ${JSON.stringify(op.json).slice(0, 200)}`);
L.say('after', { session: L.one(`SELECT status FROM managed_agent_session WHERE session_id='${sid}'`), head: L.headRow(sid), retirement: L.retirement(sid) });
const w = await L.acquire(sid, 'global-ws');
L.say('writer-after', `${w.status} ${w.code}`);
