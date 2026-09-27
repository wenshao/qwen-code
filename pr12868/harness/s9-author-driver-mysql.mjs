// Runs the PR's own Hosted Workspace driver UNCHANGED, but against the
// packaged Spring server on real MySQL 8.4.7 (HostedWorkspaceToolTurnIT pins
// an in-memory H2 database).
// usage: BROKER_TOKEN=hosted-tools-broker-token DB=.. ports.. node s9-author-driver-mysql.mjs a,b
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const letters = (process.argv[2] ?? 'a,b').split(',');
L.openLog(`s9-author-driver-mysql-${L.ARM}`);
const sessions = [];
for (const st of letters) {
  const ws = `ws-${st}-${Date.now()}`;
  L.seedRegistry(ws, `st-${st}`);
  sessions.push({ sessionId: await L.createSession(ws), workspaceId: ws, directory: fs.realpathSync(path.join(L.ROOTS, st, 'child')) });
}
const cfg = path.join(L.RIG, 'run', `driver-${L.DB}.json`);
fs.writeFileSync(cfg, JSON.stringify({ tenantId: L.TENANT, sessions, storeUrl: `http://127.0.0.1:${L.HTTP_PORT}`, brokerUrl: `${L.BROKER_URL}/` }));
const NODE22 = `${process.env.HOME}/.local/share/fnm/node-versions/v22.23.2/installation/bin/node`;
const mark = L.ledgerMark();
const t0 = Date.now();
let out;
let ok = false;
try {
  out = execFileSync(NODE22, ['--import', 'tsx', 'integration-tests/helpers/hosted-workspace-tool-turn-driver.ts', cfg], {
    cwd: L.WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 400000, maxBuffer: 64 * 1024 * 1024 });
  ok = true;
  L.say('driver', `arm=${L.ARM} exit=0 ${Date.now() - t0}ms`);
} catch (e) {
  out = (e.stdout ?? '') + (e.stderr ?? '');
  L.say('driver', `FAILED status=${e.status} ${Date.now() - t0}ms`);
}
for (const line of out.split('\n').filter((l) => /HOSTED_WORKSPACE|AssertionError|Error:|assert/i.test(l)).slice(0, 20)) L.say('driver-out', line.slice(0, 300));
for (const s of sessions)
  L.say('fs', `${s.workspaceId}: child/proof.txt=${JSON.stringify(fs.existsSync(`${s.directory}/proof.txt`) ? fs.readFileSync(`${s.directory}/proof.txt`, 'utf8') : null)} parent proof.txt exists=${fs.existsSync(`${s.directory}/../proof.txt`)}`);
L.say('mysql', `version ${L.sql('SELECT VERSION()')[0][0]}, database ${L.DB}`);
const ids = sessions.map((s) => `'${s.sessionId}'`).join(',');
L.say('executions', JSON.stringify(L.sql(`SELECT execution_state, IFNULL(execution_status,'-'), COUNT(*) FROM qwen_tool_execution WHERE harness_session_id IN (${ids}) GROUP BY 1,2`)));
L.say('runtime sessions', JSON.stringify(L.sql(`SELECT session_state, COUNT(*) FROM qwen_runtime_session WHERE harness_session_id IN (${ids}) GROUP BY 1`)));
const entries = L.ledger(mark);
const counts = {};
for (const e of entries) {
  const k = `${e.path.replace('/internal/managed-runtime', '')}${e.kind ? `[${e.kind}]` : ''} -> ${e.status}`;
  counts[k] = (counts[k] ?? 0) + 1;
}
L.say('wire', Object.entries(counts).map(([k, n]) => `${n}x ${k}`).join(', '));
const releases = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'release');
const ordered = releases.every(({ e, i }) => entries.slice(i + 1).find((x) => x.port === e.port && x.path.endsWith('/activation')));
L.say('release order', `${releases.length} worker release acknowledgements, each followed by a Workspace deactivation on the same worker: ${ordered}`);
process.exit(ok ? 0 : 1);
