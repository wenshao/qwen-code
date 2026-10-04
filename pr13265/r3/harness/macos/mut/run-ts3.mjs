// Applies each round-2 TS mutant in wt-mut2 (one file at a time), runs the
// PR's focused suites with a JSON reporter, restores and checks that file.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { MUTANTS } from './ts-mutants3.mjs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-mut3`;
const OUT = `${SP}/rig3/mut/ts`;
fs.mkdirSync(OUT, { recursive: true });
const TESTS = [
  'src/managed-runtime/managed-child-run-record.test.ts',
  'src/managed-runtime/managed-session-authority.child-run.test.ts',
  'src/managed-runtime/managed-extension-projection.test.ts',
  'src/managed-runtime/managed-session-authority.extension.test.ts',
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const originals = new Map();
const read = (file) => {
  if (!originals.has(file)) originals.set(file, fs.readFileSync(`${WT}/${file}`, 'utf8'));
  return originals.get(file);
};
const restore = (file) => {
  fs.writeFileSync(`${WT}/${file}`, read(file));
  const st = execFileSync('git', ['-C', WT, 'status', '--porcelain', '--', file], { encoding: 'utf8' }).trim();
  if (st !== '') throw new Error(`not clean after restore: ${st}`);
};
const results = [];
try {
  for (const [id, file, find, replace] of MUTANTS) {
    if (only && !only.some((o) => id.startsWith(o))) continue;
    const original = read(file);
    const count = original.split(find).length - 1;
    if (count !== 1) {
      results.push({ id, status: `BAD_ANCHOR(${count})` });
      console.log(`${id}: BAD_ANCHOR(${count})`);
      continue;
    }
    fs.writeFileSync(`${WT}/${file}`, original.replace(find, () => replace));
    const json = `${OUT}/${id.split(' ')[0]}.json`;
    fs.rmSync(json, { force: true });
    const r = spawnSync('npx', ['vitest', 'run', ...TESTS, '--reporter=json', `--outputFile=${json}`], { cwd: `${WT}/packages/core`, encoding: 'utf8', timeout: 900000 });
    restore(file);
    const failed = [];
    let total = 0;
    try {
      const rep = JSON.parse(fs.readFileSync(json, 'utf8'));
      total = rep.numTotalTests;
      for (const f of rep.testResults) for (const a of f.assertionResults) if (a.status === 'failed') failed.push(`${f.name.split('/').pop()}::${a.title}`);
      if (rep.numFailedTestSuites > 0 && failed.length === 0) failed.push(`SUITE_ERROR(${rep.numFailedTestSuites})`);
    } catch {
      failed.push(`NO_REPORT exit=${r.status}`);
    }
    const status = failed.length > 0 ? 'KILLED' : 'SURVIVED';
    results.push({ id, status, total, nFailed: failed.length, failed: failed.slice(0, 6) });
    console.log(`${id}: ${status} (${failed.length} failing of ${total}) ${failed.slice(0, 2).join(' | ')}`);
  }
} finally {
  for (const file of originals.keys()) restore(file);
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 1));
const killed = results.filter((r) => r.status === 'KILLED').length;
console.log(`RESULT killed ${killed}/${results.length}; survivors: ${results.filter((r) => r.status === 'SURVIVED').map((r) => r.id.split(' ')[0]).join(' ')}`);
