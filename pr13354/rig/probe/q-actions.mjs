import * as L from './lib.mjs';
const s = (await L.sql("SELECT session_id, approval_mode FROM managed_agent_session WHERE status='ACTIVE' ORDER BY created_at DESC LIMIT 1"))[0];
console.log(L.j(s));
const r = await L.api('GET', `/v1/agents/sessions/${s.session_id}/actions`);
console.log(r.status, JSON.stringify(r.json).slice(0, 700));
console.log(L.j(await L.turns(s.session_id)));
await L.closeDb();
