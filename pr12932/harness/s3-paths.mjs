// S3: path-shape probes the design note lists as follow-up (§8), on the real
// Spring/Tomcat stack: Session ID with trailing spaces, `;` path parameters,
// an encoded slash. Harness disabled; the Turn row is written directly.
import fs from 'node:fs';
import path from 'node:path';
import { SP, OUT, TENANT, openLog, say, sql, freshDb, startSpring, api, createSession } from './lib.mjs';
const TAG = process.argv[2] ?? 'pr';
const ENGINE = process.argv[3] ?? 'mysql';
const DB = `s3_${TAG}_${ENGINE}`;
const PORT = { mysql: 19501, mariadb: 19502 }[ENGINE] + (TAG === 'pr' ? 0 : 10);
openLog(`s3-${TAG}-${ENGINE}`);
freshDb(ENGINE, DB);
await startSpring(`s3-${TAG}-${ENGINE}`, { jar: path.join(SP, 'jars', `${TAG}-server.jar`), engine: ENGINE, db: DB, port: PORT, harnessPort: 1, storePort: PORT, harness: false });
const sid = await createSession(PORT, {});
const now = Date.now();
sql(ENGINE, DB, `INSERT INTO managed_agent_turn (tenant_id, session_id, turn_id, prompt_id, input_json, payload_digest, status, created_at, updated_at, completed_at) VALUES ('${TENANT}', '${sid}', 'turn_x', UUID(), '[]', 'd', 'COMPLETED', ${now}, ${now}, ${now})`);
const rows = [];
for (const [what, url] of [
  ['Session GET, exact ID', `/v1/agents/sessions/${sid}`],
  ['Session GET, ID + trailing space', `/v1/agents/sessions/${sid}%20`],
  ['Turn list, Session ID + trailing space', `/v1/agents/sessions/${sid}%20/turns`],
  ['Turn detail, Session ID + trailing space', `/v1/agents/sessions/${sid}%20/turns/turn_x`],
  ['Turn detail, turn_x;v=1', `/v1/agents/sessions/${sid}/turns/turn_x;v=1`],
  ['Turn detail, turn_x%3Bv=1 (encoded ;)', `/v1/agents/sessions/${sid}/turns/turn_x%3Bv=1`],
  ['Turn detail, turn%2Fx (encoded /)', `/v1/agents/sessions/${sid}/turns/turn%2Fx`],
]) {
  const r = await api(PORT, 'GET', url);
  const body = typeof r.json === 'string' ? `${r.headers['content-type']} ${r.json.replace(/\s+/g, ' ').slice(0, 90)}` : JSON.stringify(r.json.error ?? { id: r.json.id, session_id: r.json.session_id, data: r.json.data?.map((t) => t.id) });
  rows.push({ what, status: r.status, body });
  say('PROBE', `${what} -> ${r.status} ${body}`);
}
fs.writeFileSync(path.join(OUT, `s3-${TAG}-${ENGINE}.json`), JSON.stringify(rows, null, 2));
process.exit(0);
