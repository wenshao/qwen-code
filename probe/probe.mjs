// PR #12787 Windows real-machine probe. Runs the REAL acquireLock() of both
// arms (esbuild-bundled from each arm's standalone-update.ts) against a real
// fixture whose .deferred marker holds the PID of a real cmd.exe "bat".
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquireLock as lockBase } from './arm-base.mjs';
import { acquireLock as lockPr } from './arm-pr.mjs';

const [label, batPidArg, workRoot, outFile] = process.argv.slice(2);
const batPid = Number(batPidArg);

function whoamiGroups() {
  try {
    const csv = execFileSync('whoami', ['/groups', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    const il = csv.split(/\r?\n/).find((l) => l.includes('Mandatory Label')) ?? '';
    const admin = csv.split(/\r?\n/).find((l) => l.includes('S-1-5-32-544')) ?? '(not a member)';
    return { integrity: il.split('","')[0].replace(/^"/, ''), administrators: admin.split('","').slice(-1)[0]?.replace(/"$/, '') };
  } catch (e) { return { error: String(e) }; }
}
function user() {
  try { return execFileSync('whoami', [], { encoding: 'utf8' }).trim(); } catch { return '?'; }
}
function rawProbe(pid) {
  try { process.kill(pid, 0); return 'no-throw (alive)'; } catch (e) { return e.code ?? String(e); }
}
function state(standaloneDir, lockPath) {
  const d = `${standaloneDir}.deferred`;
  return {
    newDir: fs.existsSync(`${standaloneDir}.new`),
    newPayload: fs.existsSync(path.join(`${standaloneDir}.new`, 'payload.txt')),
    deferred: fs.existsSync(d) ? fs.readFileSync(d, 'utf8') : null,
    lock: fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null,
  };
}
function runCase(armName, acquireLock, scenario) {
  const dir = fs.mkdtempSync(path.join(workRoot, `${label}-${armName}-${scenario}-`));
  const standaloneDir = path.join(dir, 'qwen-code');
  const lockPath = path.join(dir, '.qwen-update.lock');
  if (scenario !== 'steal-lock') {
    fs.mkdirSync(`${standaloneDir}.new`, { recursive: true });
    fs.writeFileSync(path.join(`${standaloneDir}.new`, 'payload.txt'), 'staged install');
    fs.writeFileSync(`${standaloneDir}.deferred`, String(batPid));
  }
  // theft: lock held by the exited CLI (dead PID), the shape a deferred swap leaves behind
  if (scenario === 'theft') fs.writeFileSync(lockPath, '999999999');
  // steal-lock: lock held by the live bat PID itself, no marker
  if (scenario === 'steal-lock') fs.writeFileSync(lockPath, String(batPid));
  const before = state(standaloneDir, lockPath);
  let outcome;
  try { outcome = { returned: acquireLock(lockPath, standaloneDir) }; }
  catch (e) { outcome = { threw: e instanceof Error ? e.message : String(e) }; }
  const after = state(standaloneDir, lockPath);
  return { arm: armName, scenario, outcome, before, after };
}

const result = {
  label, node: process.version, platform: process.platform, pid: process.pid,
  user: user(), token: whoamiGroups(), batPid, rawProbe: rawProbe(batPid), cases: [],
};
for (const scenario of ['fast', 'theft', 'steal-lock']) {
  result.cases.push(runCase('base', lockBase, scenario));
  result.cases.push(runCase('pr', lockPr, scenario));
}
result.rawProbeAfter = rawProbe(batPid);
const line = 'PROBE_JSON ' + JSON.stringify(result);
console.log(line);
if (outFile) fs.writeFileSync(outFile, line + '\n');
