// Runs the PR's own integration driver unchanged, but against real MySQL 8.4.7
// (the PR's IT uses H2 in MySQL mode).
import * as L from './lib.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DB = 'rig2';
const ARM = process.env.ARM ?? 'pr';
const [SA, SB] = (process.argv[2] ?? 'a,b').split(',');
L.openLog(`s1-author-driver-mysql-${ARM}-${SA}${SB}`);
for (const st of [SA, SB]) if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='ws-${st}'`)[0][0] === '0') L.seedRegistry(DB, `ws-${st}`, `st-${st}`);
const sessions = [];
for (const [ws, dir] of [[`ws-${SA}`, SA], [`ws-${SB}`, SB]]) {
  const id = await L.createWorkspaceSession(18832, ws);
  sessions.push({ sessionId: id, workspaceId: ws, directory: `${L.RIG}/roots2/${dir}/child` });
}
const cfg = `${L.RIG}/run/driver-rig2.json`;
fs.writeFileSync(cfg, JSON.stringify({ tenantId: L.TENANT, sessions, storeUrl: 'http://127.0.0.1:18832', brokerUrl: 'http://127.0.0.1:19832/' }));
L.say('config', sessions);
const t0 = Date.now();
let out;
try {
  out = execFileSync(L.NODE22, ['--import', 'tsx', 'integration-tests/helpers/hosted-workspace-tool-turn-driver.ts', cfg], { cwd: `${L.SP}/wt-${ARM}`, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  L.say('driver', `arm=${ARM} exit=0 ${Date.now() - t0}ms`);
} catch (e) {
  out = (e.stdout ?? '') + (e.stderr ?? '');
  L.say('driver', `FAILED status=${e.status}`);
}
for (const line of out.split('\n').filter((l) => /HOSTED_WORKSPACE|Broker |Error|assert/i.test(l)).slice(0, 20)) L.say('driver-out', line);
for (const s of sessions) L.say('fs', `${s.workspaceId}: child/proof.txt=${JSON.stringify(fs.existsSync(`${s.directory}/proof.txt`) ? fs.readFileSync(`${s.directory}/proof.txt`, 'utf8') : null)} root proof.txt exists=${fs.existsSync(`${s.directory}/../proof.txt`)}`);
L.say('mysql', L.sql(DB, "SELECT VERSION()")[0][0]);
L.say('holders', L.holders(DB));
L.say('executions', L.sql(DB, "SELECT execution_state, IFNULL(execution_status,'-'), COUNT(*) FROM qwen_tool_execution GROUP BY 1,2"));
