// node run-mutants.mjs <arm: head|base|merge> <db host:port> [ids...]
// Applies each mutant to the arm's mutation worktree, runs the targeted
// classes plus ManagedAgentMySqlIT from a clean build, records which tests
// failed, and restores the tree. Results land in results/mutants/<arm>/.
import { MUTANTS } from './mutants.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RIG = '/Users/wenshao/git/pr13347-rig';
const [arm, hostPort, ...only] = process.argv.slice(2);
const WT = { head: '/Users/wenshao/git/pr13347-mut', base: '/Users/wenshao/git/pr13347-mutb', merge: '/Users/wenshao/git/pr13347-mutm', r1: '/Users/wenshao/git/pr13347-mutr1' }[arm];
const M2 = arm === 'merge' ? `${RIG}/m2-merge` : `${RIG}/m2`;
if (!WT || !hostPort) throw new Error('usage: run-mutants.mjs head|base|merge host:port [ids]');
const MODULE = path.join(WT, 'packages/sdk-java/managed-agent-server');
const OUT = path.join(RIG, 'results/mutants', arm);
fs.mkdirSync(OUT, { recursive: true });
const UNIT = ['ManagedExtensionRecordStoreTest', 'ManagedAgentApiContractTest',
  'ManagedSessionStoreIntegrationTest', 'ManagedExtensionProjectionContractTest',
  'ManagedArtifactApiIntegrationTest'].join(',');
const MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql';
const [host, port] = hostPort.split(':');
const db = `managed_agent_mut_${arm}`;

function git(...args) {
  return execFileSync('git', ['-C', WT, ...args], { encoding: 'utf8' });
}
function restore() {
  git('checkout', '--', '.');
  const dirty = git('status', '--porcelain', '--untracked-files=no').trim();
  if (dirty) throw new Error(`tree not clean after restore:\n${dirty}`);
}
function apply(m) {
  for (const [file, find, replace] of m.edits) {
    const p = path.join(WT, file);
    const text = fs.readFileSync(p, 'utf8');
    const n = text.split(find).length - 1;
    if (n !== 1) return `anchor x${n} in ${path.basename(file)}`;
    fs.writeFileSync(p, text.replace(find, () => replace));
  }
  return null;
}
function reports() {
  const failed = [];
  let run = 0;
  for (const dir of ['target/surefire-reports', 'target/failsafe-reports']) {
    const d = path.join(MODULE, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((f) => /^TEST-.*\.xml$/.test(f))) {
      const xml = fs.readFileSync(path.join(d, f), 'utf8');
      for (const m of xml.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
        run++;
        const body = m[4] || '';
        const bad = body.match(/<(failure|error)(?: message="([^"]*)")?[^>]*>/);
        if (bad) {
          const cls = m[2].split('.').pop();
          const at = (body.match(new RegExp(`at [\\w.$]*${cls}\\.[\\w$]+\\(${cls}\\.java:(\\d+)\\)`)) || [])[1];
          failed.push({ test: `${cls}.${m[1]}`, kind: bad[1], at: at ? `${cls}.java:${at}` : null,
            message: (bad[2] || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ').replace(/&amp;/g, '&').slice(0, 400) });
        }
      }
    }
  }
  return { run, failed };
}
function runSuite(label) {
  execFileSync(MYSQL, ['--no-defaults', '-uroot', '-pruntime-broker', `-h${host}`, `-P${port}`,
    '-e', `DROP DATABASE IF EXISTS ${db}`], { stdio: 'ignore' });
  const log = path.join(OUT, `${label}.log`);
  const t0 = Date.now();
  const r = spawnSync('/bin/bash', ['-c', [
    `cd ${MODULE} &&`, `TZ=UTC M2=${M2} ${RIG}/mvn.sh -o -B --no-transfer-progress -Pmysql-integration`,
    `-Dtest=${UNIT} -Dsurefire.failIfNoSpecifiedTests=false`,
    "'-Dit.test=ManagedAgentMySqlIT,!ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql' -Dfailsafe.failIfNoSpecifiedTests=false",
    '-Dmaven.test.failure.ignore=true -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true',
    `'-Dmysql.url=jdbc:mysql://${hostPort}/${db}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false'`,
    '-Dmysql.user=root -Dmysql.password=runtime-broker clean verify',
    `> ${log} 2>&1`].join(' ')], { encoding: 'utf8' });
  const compileError = /COMPILATION ERROR|BUILD FAILURE/.test(fs.readFileSync(log, 'utf8'));
  return { rc: r.status, seconds: Math.round((Date.now() - t0) / 1000), compileError, ...reports() };
}

restore();
const head = git('rev-parse', '--short=10', 'HEAD').trim();
const list = only.length ? MUTANTS.filter((m) => only.includes(m.id)) : MUTANTS;
const doBaseline = !only.length || only.includes('baseline');
if (doBaseline) {
  const res = { id: 'baseline', arm, head, ...runSuite('baseline') };
  fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(res, null, 2));
  console.log(`[${arm}] baseline run=${res.run} failed=${res.failed.length} ${res.seconds}s`);
}
for (const m of list) {
  restore();
  const skip = apply(m);
  let res;
  if (skip) {
    res = { id: m.id, arm, head, status: 'n/a', reason: skip };
  } else {
    const diff = git('diff', '--stat').trim();
    const r = runSuite(m.id);
    res = { id: m.id, arm, head, status: r.compileError ? 'compile-error' : r.failed.length ? 'killed' : 'survived', diff, ...r };
  }
  restore();
  fs.writeFileSync(path.join(OUT, `${m.id}.json`), JSON.stringify(res, null, 2));
  console.log(`[${arm}] ${m.id} ${m.name}: ${res.status}${res.failed ? ` (${res.failed.length} failed of ${res.run}; ${res.seconds}s)` : ''}${res.reason ? ' ' + res.reason : ''}`);
  for (const f of (res.failed || []).slice(0, 4)) console.log(`    - ${f.test} @${f.at} ${f.message.slice(0, 160)}`);
}
