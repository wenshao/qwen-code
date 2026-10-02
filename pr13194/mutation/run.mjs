// VERIFICATION RIG ONLY (PR #13194): mutation runner. Each mutant is one exact-anchor replacement in the PR head (committed tree),
// followed by the focused unit tests and the real-MySQL ITs; the file is restored with git checkout afterwards.
// usage: node run.mjs [ids...]    (BASELINE runs first; results -> mut/results.json)
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
const R = '/Users/wenshao/pr13135-rig';
const W = '/Users/wenshao/git/qwen-code-pr13194-mut';
const MOD = `${W}/packages/sdk-java/managed-agent-server`;
const SRC = `${MOD}/src/main/java/com/alibaba/qwen/code/managedagent`;
const all = JSON.parse(fs.readFileSync(`${R}/p94/mut/mutants.json`, 'utf8'));
const pick = process.argv.slice(2);
const list = [{ id: 'BASELINE' }, ...all.filter((m) => !pick.length || pick.includes(m.id))];
const UNIT = 'WorkspaceSessionRetentionTest,ManagedAgentApiContractTest,ManagedSessionLifecycleTest,ManagedSessionOperationStoreTest,SessionLifecycleCoordinatorTest,WorkspaceSessionCloseTest,WorkspaceRecoveryStoreTest';
const IT = 'WorkspaceSessionRetentionMySqlIT,WorkspaceSessionCloseMySqlIT';
const outFile = `${R}/p94/mut/results.json`;
const results = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
function failures(dir) {
  if (!fs.existsSync(dir)) return { ran: 0, failed: [] };
  let ran = 0; const failed = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('TEST-') && x.endsWith('.xml'))) {
    const xml = fs.readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of xml.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      ran++;
      if (/<(failure|error)\b/.test(m[4] ?? '')) failed.push(`${m[2].split('.').pop()}.${m[1]}`);
    }
  }
  return { ran, failed };
}
for (const m of list) {
  const t0 = Date.now();
  if (m.id !== 'BASELINE') {
    const p = `${SRC}/${m.file}`;
    const s = fs.readFileSync(p, 'utf8');
    const n = s.split(m.from).length - 1;
    if (n !== 1) { results[m.id] = { ...m, verdict: `ANCHOR x${n}` }; console.log(`${m.id} ANCHOR x${n}`); continue; }
    fs.writeFileSync(p, s.replace(m.from, m.to));
  }
  const r = spawnSync('mvn', ['-B', '-ntp', '-o', `-Dmaven.repo.local=${R}/m2`, '-Pmysql-integration',
    '-Dmysql.url=jdbc:mysql://127.0.0.1:33135/p94_mut?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false', '-Dmysql.user=root', '-Dmysql.password=<local-rig-db-password>',
    `-Dtest=${UNIT}`, '-Dsurefire.failIfNoSpecifiedTests=false', `-Dit.test=${IT}`, '-Dfailsafe.failIfNoSpecifiedTests=false',
    '-Dmaven.test.failure.ignore=true', '-Dcheckstyle.skip=true', 'clean', 'verify'], { cwd: MOD, encoding: 'utf8', env: { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}` }, maxBuffer: 1 << 28 });
  fs.writeFileSync(`${R}/p94/mut/${m.id}.log`, r.stdout + r.stderr);
  const compileErr = /COMPILATION ERROR/.test(r.stdout);
  const u = failures(`${MOD}/target/surefire-reports`);
  const i = failures(`${MOD}/target/failsafe-reports`);
  if (m.id !== 'BASELINE') execSync(`git -C ${W} checkout -- packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/${m.file}`);
  const failed = [...u.failed, ...i.failed];
  const verdict = compileErr ? 'COMPILE-ERROR' : m.id === 'BASELINE' ? (failed.length ? 'BASELINE-RED' : 'BASELINE-GREEN') : failed.length ? 'KILLED' : 'SURVIVED';
  results[m.id] = { ...m, verdict, unitRan: u.ran, itRan: i.ran, failed, secs: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`${m.id} ${verdict} unit=${u.ran} it=${i.ran} failed=${failed.length} ${failed.slice(0, 3).join(', ')} (${results[m.id].secs}s)`);
}
console.log('MUT-DONE', execSync(`git -C ${W} status --porcelain`).toString().trim() || 'tree clean');
