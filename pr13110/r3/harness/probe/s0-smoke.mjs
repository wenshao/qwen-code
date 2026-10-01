import { workspace, createWorkspaceSession, sql, one } from './lib.mjs';
const w = await workspace('a', 'ws-smoke');
const id = await createWorkspaceSession(w.workspaceId);
console.log('session', id, w);
console.log(sql(`SELECT session_id, status FROM managed_agent_session WHERE session_id='${id}'`));
console.log('flyway', one('SELECT MAX(CAST(version AS UNSIGNED)) FROM flyway_schema_history'), one('SELECT VERSION()'));
