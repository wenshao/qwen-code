// Main's FG6a reply-loss driver (merged into this PR's IT) on MySQL 8.4.7.
// `status` is omitted: it needs the IT's in-JVM transport gate.
import * as L from './lib.mjs';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
const DB = process.env.DB ?? 'p848f';
const HTTP = Number(process.env.HTTP ?? 18848);
const BPORT = Number(process.env.BPORT ?? 19848);
const ROOTS = process.env.ROOTS ?? 'roots6';
const ARM = process.env.ARM ?? 'r6';
const CASES = ['acquire', 'prepare', 'prepare-twice', 'start', 'cancel', 'release', 'release-before-forward'];
const LETTERS = (process.argv[2] ?? 'a2,b2,c2,d2,e2,f2,g2').split(',');
L.openLog(`s18-fg6a-${ARM}`);
const gate = createServer((req, res) => { res.writeHead(204); res.end(); });
await new Promise((r) => gate.listen(0, '127.0.0.1', r));
const sessions = [];
for (const [i, st] of LETTERS.entries()) {
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='ws-${st}'`)[0][0] === '0') L.seedRegistry(DB, `ws-${st}`, `st-${st}`);
  const dir = `${L.RIG}/${ROOTS}/${st}/child`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/proof.txt`, 'x');
  sessions.push({ sessionId: await L.createWorkspaceSession(HTTP, `ws-${st}`), workspaceId: `ws-${st}`, directory: dir, toolProfile: 'hosted-workspace-files/1', fault: CASES[i] });
}
const cfg = `${L.RIG}/run/fg6a-${DB}.json`;
fs.writeFileSync(cfg, JSON.stringify({ tenantId: L.TENANT, sessions, storeUrl: `http://127.0.0.1:${HTTP}`, brokerUrl: `http://127.0.0.1:${BPORT}/`, statusGateUrl: `http://127.0.0.1:${gate.address().port}/release` }));
const t0 = Date.now();
let out = '';
let ok = false;
try {
  out = execFileSync(L.NODE22, ['--import', 'tsx', 'integration-tests/helpers/hosted-broker-reply-loss-driver.ts', cfg], { cwd: `${L.SP}/wt-${ARM}`, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  ok = true;
} catch (e) {
  out = (e.stdout ?? '') + (e.stderr ?? '');
}
L.say('fg6a', `${ok ? 'exit=0' : 'FAILED'} ${Date.now() - t0} ms; cases: ${CASES.join(', ')}`);
for (const line of out.split('\n').filter((l) => /HOSTED_REPLY_LOSS_OK|AssertionError|Error:/.test(l)).slice(0, 12)) L.say('fg6a-out', line.slice(0, 260));
for (const s of sessions) L.say('fs', `${s.fault}: proof.txt=${JSON.stringify(fs.readFileSync(`${s.directory}/proof.txt`, 'utf8'))}`);
gate.close();
process.exit(ok ? 0 : 1);
