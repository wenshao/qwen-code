// Runs the PR's own Hosted file-tool driver unchanged against MySQL 8.4.7 + the PR jar.
import * as L from './lib.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DB = process.env.DB ?? 'o2b', HTTP = 18894, BPORT = 19894;
const STS = (process.argv[2] ?? 's30,s31').split(',');
L.openLog(`s6-author-driver-${process.env.LABEL ?? 'pr'}`);
const sessions = [];
for (const st of STS) {
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='ws-${st}'`)[0][0] === '0') L.seedRegistry(DB, `ws-${st}`, `st-${st}`);
  const id = await L.createWorkspaceSession(HTTP, `ws-${st}`);
  sessions.push({ sessionId: id, workspaceId: `ws-${st}`, directory: `${L.RIG}/roots/${st}/child` });
}
const cfg = `${L.RIG}/run/driver-${process.env.LABEL ?? 'pr'}.json`;
fs.writeFileSync(cfg, JSON.stringify({ tenantId: L.TENANT, sessions, storeUrl: `http://127.0.0.1:${HTTP}`, brokerUrl: `http://127.0.0.1:${BPORT}/` }));
const t0 = Date.now();
let out, ok = false;
try {
  out = execFileSync(L.NODE22, ['--import', 'tsx', 'integration-tests/helpers/hosted-workspace-tool-turn-driver.ts', cfg], { cwd: process.env.DRIVER_WT ?? L.WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  ok = true;
} catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); L.say('driver', `FAILED status=${e.status}`); }
L.say('driver', `exit=${ok ? 0 : 'non-zero'} ${Date.now() - t0}ms`);
fs.writeFileSync(`${L.RIG}/out/s6-driver-${process.env.LABEL ?? 'pr'}.out`, out);
for (const line of out.split('\n').filter((l) => /HOSTED_WORKSPACE|AssertionError|Error:|assert/i.test(l)).slice(0, 12)) L.say('driver-out', line.slice(0, 300));
process.exit(ok ? 0 : 1);
