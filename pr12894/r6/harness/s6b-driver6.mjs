// The merged six-Workspace Hosted driver (files x2 + Shell x4, local capture path) against MySQL + this jar.
import * as L from './lib.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DB = process.env.DB ?? 'o2k', HTTP = 18894, BPORT = 19894;
const STS = (process.argv[2] ?? 's30,s31,s32,s33,s34,s35').split(',');
const PROFILES = ['hosted-workspace-files/1', 'hosted-workspace-files/1', 'hosted-workspace-shell/1', 'hosted-workspace-shell/1', 'hosted-workspace-shell/1', 'hosted-workspace-shell/1'];
L.openLog(`s6b-driver6-${process.env.LABEL ?? 'pr'}`);
const sessions = [];
for (const [i, st] of STS.entries()) {
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='ws-${st}'`)[0][0] === '0') L.seedRegistry(DB, `ws-${st}`, `st-${st}`);
  sessions.push({ sessionId: await L.createWorkspaceSession(HTTP, `ws-${st}`), workspaceId: `ws-${st}`, directory: `${process.env.ROOTS ?? L.RIG + '/roots'}/${st}/child`, toolProfile: PROFILES[i] });
}
const cfg = `${L.RIG}/run/driver6-${process.env.LABEL ?? 'pr'}.json`;
fs.writeFileSync(cfg, JSON.stringify({ tenantId: L.TENANT, sessions, resultFile: `${L.RIG}/run/driver6-result-${process.env.LABEL ?? 'pr'}.json`, storeUrl: `http://127.0.0.1:${HTTP}`, brokerUrl: `http://127.0.0.1:${BPORT}/` }));
const t0 = Date.now();
let out, ok = false;
try { out = execFileSync(L.NODE22, ['--import', 'tsx', 'integration-tests/helpers/hosted-workspace-tool-turn-driver.ts', cfg], { cwd: process.env.DRIVER_WT ?? L.WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000, maxBuffer: 256 * 1024 * 1024 }); ok = true; }
catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); }
L.say('driver6', `exit=${ok ? 0 : 'non-zero'} ${Date.now() - t0}ms load=${execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).replace(/.*averages: /, '').trim()}`);
fs.writeFileSync(`${L.RIG}/out/s6b-driver6-${process.env.LABEL ?? 'pr'}.out`, out);
for (const line of out.split('\n').filter((l) => /HOSTED_WORKSPACE|AssertionError|Error:|assert|Timed out/i.test(l)).slice(0, 8)) L.say('driver-out', line.slice(0, 300));
process.exit(ok ? 0 : 1);
