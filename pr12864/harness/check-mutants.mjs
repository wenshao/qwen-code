// Each mutant of scripts/check-failsafe-reports.js is run against (a) the
// PR's unit tests and (b) failsafe reports copied from real local Maven runs
// of both jobs, replayed into a scratch module tree.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const { WT, SP } = process.env;
const script = path.join(WT, 'scripts/check-failsafe-reports.js');
const original = readFileSync(script, 'utf8');
const mutants = [
  ['skipped cases counted as run', "count('testcase') - count('skipped')", "count('testcase')"],
  ['it.test property ignored', 'it\\.test|failsafe', 'failsafe'],
  ['excludesFile property ignored (D2)', 'failsafe\\.(?:in|ex)cludesFile', 'failsafe\\.includesFile'],
  ['report without properties accepted', 'if (!/<properties\\b/.test(report)) unrecorded.push(file);', ''],
  ['no cross-family check', 'if (!inFamily(simpleName(className))) {', 'if (false) {'],
  ['class needs no test (>= 0)', 'if (ran.get(className) > 0) {', 'if (ran.get(className) >= 0) {'],
  ['only first module checked', 'for (const module of modules) {', 'for (const module of modules.slice(0, 1)) {'],
];
// Real reports: arm name -> [family, modules]
const arms = [
  ['H0-hosted-pr', 'hosted', ['managed-agent-server']],
  ['M0-mariadb-pr', 'non-hosted', ['runtime-broker', 'managed-agent-server']],
  ['N1-root-mvn-config-method', 'non-hosted', ['runtime-broker', 'managed-agent-server']],
  ['N2-hosted-extra-profile', 'hosted', ['managed-agent-server']],
  ['N6-excludes-file-method', 'non-hosted', ['runtime-broker', 'managed-agent-server']],
  ['N4-pom-test-with-space', 'non-hosted', ['runtime-broker', 'managed-agent-server']],
  ['N3-db-down-failure-ignore', 'non-hosted', ['runtime-broker', 'managed-agent-server']],
  ['U1-unit-test-in-failsafe', 'non-hosted', ['runtime-broker', 'managed-agent-server']],
];
const scratch = path.join(SP, 'check-replay');
rmSync(scratch, { recursive: true, force: true });
const available = arms.filter(([arm]) => {
  try { readdirSync(path.join(SP, 'java/reports', arm)); return true; } catch { return false; }
});
for (const [arm, , modules] of available) {
  for (const m of modules) {
    const dst = path.join(scratch, arm, 'packages/sdk-java', m);
    // source tree of the PR head, reports of that real run
    cpSync(path.join(WT, 'packages/sdk-java', m, 'src/test/java'), path.join(dst, 'src/test/java'), { recursive: true });
    mkdirSync(path.join(dst, 'target/failsafe-reports'), { recursive: true });
    try { cpSync(path.join(SP, 'java/reports', arm, m), path.join(dst, 'target/failsafe-reports'), { recursive: true }); } catch {}
  }
}
const replay = () =>
  Object.fromEntries(available.map(([arm, family, modules]) => {
    const r = spawnSync(process.execPath, [script, family, ...modules.map((m) => `packages/sdk-java/${m}`)], { cwd: path.join(scratch, arm), encoding: 'utf8' });
    return [arm, r.status];
  }));
const unit = () => {
  const r = spawnSync('npx', ['vitest', 'run', '--config', './scripts/tests/vitest.config.ts', 'scripts/tests/check-failsafe-reports.test.js'], { cwd: WT, encoding: 'utf8' });
  const m = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '').match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed/);
  return m ? `${m[1] ?? 0} failed / ${Number(m[1] ?? 0) + Number(m[2])}` : 'parse error';
};
const rows = [{ mutant: '(none)', unit: unit(), real: replay() }];
try {
  for (const [name, from, to] of mutants) {
    if (!original.includes(from)) throw new Error(`anchor missing: ${name}`);
    writeFileSync(script, original.replace(from, to));
    rows.push({ mutant: name, unit: unit(), real: replay() });
  }
} finally {
  writeFileSync(script, original);
}
console.log(`MUTANTS_JSON ${JSON.stringify(rows)}`);
for (const r of rows) console.log(r.mutant.padEnd(38), 'unit', r.unit.padEnd(10), 'real', JSON.stringify(r.real));
execFileSync('git', ['diff', '--exit-code', '--stat', '--', 'scripts'], { cwd: WT, stdio: 'inherit' });
