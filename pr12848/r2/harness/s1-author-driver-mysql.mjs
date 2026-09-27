// Runs the PR's own six-Workspace driver unchanged, but against real MySQL
// 8.4.7 behind the packaged Spring server (the PR's IT uses H2 in MySQL mode).
import * as L from './lib.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DB = process.env.DB ?? 'p848a';
const HTTP = Number(process.env.HTTP ?? 18848);
const BPORT = Number(process.env.BPORT ?? 19848);
const ROOTS = process.env.ROOTS ?? 'roots1';
const ARM = process.env.ARM ?? 'pr';
const LETTERS = (process.argv[2] ?? 'a,b,c,d,e,f').split(',');
const PROFILES = ['hosted-workspace-files/1', 'hosted-workspace-files/1', 'hosted-workspace-shell/1', 'hosted-workspace-shell/1', 'hosted-workspace-shell/1', 'hosted-workspace-shell/1'];
L.openLog(`s1-author-driver-mysql-${ARM}`);
const sessions = [];
for (const [i, st] of LETTERS.entries()) {
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='ws-${st}'`)[0][0] === '0')
    L.seedRegistry(DB, `ws-${st}`, `st-${st}`);
  const id = await L.createWorkspaceSession(HTTP, `ws-${st}`);
  sessions.push({ sessionId: id, workspaceId: `ws-${st}`, directory: `${L.RIG}/${ROOTS}/${st}/child`, toolProfile: PROFILES[i] });
}
const cfg = `${L.RIG}/run/driver-${DB}.json`;
const resultFile = `${L.RIG}/run/shell-output-${DB}.json`;
fs.writeFileSync(cfg, JSON.stringify({ tenantId: L.TENANT, sessions, resultFile, storeUrl: `http://127.0.0.1:${HTTP}`, brokerUrl: `http://127.0.0.1:${BPORT}/` }));
L.say('config', sessions.map((s) => `${s.workspaceId} ${s.toolProfile}`));
const t0 = Date.now();
let out;
let ok = false;
try {
  out = execFileSync(L.NODE22, ['--import', 'tsx', 'integration-tests/helpers/hosted-workspace-tool-turn-driver.ts', cfg], { cwd: `${L.SP}/wt-${ARM}`, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 400000, maxBuffer: 64 * 1024 * 1024 });
  ok = true;
  L.say('driver', `arm=${ARM} exit=0 ${Date.now() - t0}ms`);
} catch (e) {
  out = (e.stdout ?? '') + (e.stderr ?? '');
  L.say('driver', `FAILED status=${e.status} ${Date.now() - t0}ms`);
}
fs.writeFileSync(`${L.RIG}/out/s1-driver-${DB}.out`, out);
for (const line of out.split('\n').filter((l) => /HOSTED_WORKSPACE|AssertionError|Error:|assert/i.test(l)).slice(0, 20)) L.say('driver-out', line.slice(0, 300));
for (const s of sessions) {
  const once = `${s.directory}/shell-once.txt`;
  L.say('fs', `${s.workspaceId}: proof.txt=${JSON.stringify(fs.existsSync(`${s.directory}/proof.txt`) ? fs.readFileSync(`${s.directory}/proof.txt`, 'utf8') : null)} shell-once.txt=${JSON.stringify(fs.existsSync(once) ? fs.readFileSync(once, 'utf8') : null)} parent proof.txt exists=${fs.existsSync(`${s.directory}/../proof.txt`)}`);
}
L.say('mysql', L.sql(DB, 'SELECT VERSION()')[0][0]);
L.say('tool-result resources', L.sql(DB, "SELECT kind, state, COUNT(*), SUM(byte_length), MAX(byte_length) FROM qwen_managed_session_resource WHERE kind LIKE 'managed-tool-result-%' GROUP BY 1,2"));
L.say('executions', L.sql(DB, "SELECT execution_state, IFNULL(execution_status,'-'), COUNT(*) FROM qwen_tool_execution GROUP BY 1,2"));
process.exit(ok ? 0 : 1);
