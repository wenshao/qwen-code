// Applies each TS mutant in wt-mut, runs the PR's focused suites, restores.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { FILE, MUTANTS } from './ts-mutants.mjs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-mut`;
const OUT = `${SP}/rig/mut/ts`;
fs.mkdirSync(OUT, { recursive: true });
const TESTS = [
  'src/managed-runtime/managed-child-run-record.test.ts',
  'src/managed-runtime/managed-session-authority.child-run.test.ts',
  'src/managed-runtime/managed-extension-projection.test.ts',
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const path = `${WT}/${FILE}`;
const original = fs.readFileSync(path, 'utf8');
const restore = () => {
  fs.writeFileSync(path, original);
  const st = execFileSync('git', ['-C', WT, 'status', '--porcelain', '--', FILE], { encoding: 'utf8' }).trim();
  if (st !== '') throw new Error(`tree not clean after restore: ${st}`);
};
const results = [];
try {
  for (const [id, find, replace] of MUTANTS) {
    if (only && !only.some((o) => id.startsWith(o))) continue;
    const count = original.split(find).length - 1;
    if (count !== 1) {
      results.push({ id, status: `BAD_ANCHOR(${count})` });
      console.log(`${id}: BAD_ANCHOR(${count})`);
      continue;
    }
    fs.writeFileSync(path, original.replace(find, replace));
    const json = `${OUT}/${id.split(' ')[0]}.json`;
    const r = spawnSync('npx', ['vitest', 'run', ...TESTS, '--reporter=json', `--outputFile=${json}`], { cwd: `${WT}/packages/core`, encoding: 'utf8', timeout: 600000 });
    restore();
    let failed = [];
    let total = 0;
    try {
      const rep = JSON.parse(fs.readFileSync(json, 'utf8'));
      total = rep.numTotalTests;
      for (const f of rep.testResults) for (const a of f.assertionResults) if (a.status === 'failed') failed.push(`${f.name.split('/').pop()}::${a.title}`);
      if (rep.numFailedTestSuites > 0 && failed.length === 0) failed.push(`SUITE_ERROR(${rep.numFailedTestSuites})`);
    } catch (e) {
      failed.push(`NO_REPORT exit=${r.status}`);
    }
    const status = failed.length > 0 ? 'KILLED' : 'SURVIVED';
    results.push({ id, status, total, failed: failed.slice(0, 8), nFailed: failed.length });
    console.log(`${id}: ${status} (${failed.length} failing of ${total}) ${failed.slice(0, 3).join(' | ')}`);
  }
} finally {
  restore();
}
fs.writeFileSync(`${OUT}/summary${only ? '-' + only.join('_') : ''}.json`, JSON.stringify(results, null, 1));
const killed = results.filter((r) => r.status === 'KILLED').length;
console.log(`RESULT killed ${killed}/${results.length}; survivors: ${results.filter((r) => r.status === 'SURVIVED').map((r) => r.id).join('; ')}`);
