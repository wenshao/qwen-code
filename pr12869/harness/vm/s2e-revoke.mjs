// C: the actor loses access, the product Session is deleted, the Registry changes (the mount is removed in the env file).
import * as d from './drive.mjs';
import fs from 'node:fs';
const label = process.argv[2];
const { C } = JSON.parse(fs.readFileSync(`/rig/out/${label}-arms.json`, 'utf8')).arms;
const say = (...a) => console.log(d.now(), ...a);
const del = await d.http('DELETE', `${d.API}/v1/agents/sessions/${C.sid}`, { headers: { 'X-Qwen-Tenant-Id': d.TENANT, 'X-Rig-Actor': 'alice', 'Idempotency-Key': `del-${C.sid}` } });
say('public DELETE session C ->', del.status, JSON.stringify(del.json).slice(0, 200));
say('session row', JSON.stringify(d.sql(`SELECT status, IFNULL(deleted_at,'-') FROM managed_agent_session WHERE session_id='${C.sid}'`)));
d.sql(`DELETE FROM managed_workspace_access WHERE tenant_id='${d.TENANT}' AND workspace_id='${C.workspace}'`);
if (d.sql(`SELECT status FROM managed_agent_session WHERE session_id='${C.sid}'`)[0][0] !== 'DELETED')
  d.sql(`UPDATE managed_agent_session SET status='DELETED', deleted_at=2 WHERE session_id='${C.sid}'`);
d.sql(`UPDATE managed_workspace_registry SET storage_id='changed', workspace_generation=2, state='REMOVED' WHERE tenant_id='${d.TENANT}' AND workspace_id='${C.workspace}'`);
say('after revoke: session', JSON.stringify(d.sql(`SELECT status FROM managed_agent_session WHERE session_id='${C.sid}'`)),
  'access rows', d.sql(`SELECT COUNT(*) FROM managed_workspace_access WHERE workspace_id='${C.workspace}'`)[0][0],
  'registry', JSON.stringify(d.sql(`SELECT storage_id, workspace_generation, state FROM managed_workspace_registry WHERE workspace_id='${C.workspace}'`)));
const w = await d.warm(C.sid);
say('warm C with revoked authorization ->', w.status, JSON.stringify(w.json));
