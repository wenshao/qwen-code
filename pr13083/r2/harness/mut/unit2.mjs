// host: decide unit-level kills on a noisy machine. For each mutant: run the five changed vitest
// files; every test that failed is re-run alone twice; it counts as a kill only if it fails alone too.
// usage: node unit2.mjs <id>...
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const { mutants } = await import(process.env.MUTANTS ?? './mutants.mjs');
const RIG = '/rig';
const W = process.env.MUT_TREE ?? `${RIG}/src-new-mutants`;
const P = process.env.PRISTINE ?? `${RIG}/src-new`;
const tests = [
  'src/serve/hosted-harness-session.test.ts',
  'src/serve/hosted-runtime-recovery.test.ts',
  'src/serve/hosted-text-deltas.test.ts',
  'src/serve/hosted-harness-model.test.ts',
  'src/serve/hosted-workspace-broker.test.ts',
];
const run = (args, out) => {
  spawnSync('npx', ['vitest', 'run', ...args, '--testTimeout=120000', '--hookTimeout=120000', '--reporter=json', `--outputFile=${out}`], {
    cwd: `${W}/packages/cli`,
    encoding: 'utf8',
  });
  try {
    const report = JSON.parse(readFileSync(out, 'utf8'));
    return {
      total: report.numTotalTests,
      failed: report.testResults.flatMap((file) =>
        file.assertionResults
          .filter((t) => t.status === 'failed')
          .map((t) => ({ file: path.relative(`${W}/packages/cli`, file.name), title: t.title })),
      ),
    };
  } catch {
    return { total: 0, failed: [{ file: '?', title: '(no vitest report)' }] };
  }
};
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rows = [];
for (const id of process.argv.slice(2)) {
  const m = id === 'T00' ? { id, what: 'no mutation (control)' } : mutants.find((x) => x.id === id);
  for (const x of mutants) copyFileSync(`${P}/${x.file}`, `${W}/${x.file}`);
  if (m.from !== undefined) {
    const source = readFileSync(`${W}/${m.file}`, 'utf8');
    if (source.split(m.from).length !== 2) throw new Error(`${id}: anchor`);
    writeFileSync(`${W}/${m.file}`, source.replace(m.from, m.to));
  }
  const first = run(tests, `${RIG}/out/mut/unit2-${process.env.TAG ?? ''}${id}.json`);
  const confirmed = [];
  const noise = [];
  for (const t of first.failed) {
    let fails = 0;
    for (let i = 0; i < 2; i++) {
      const alone = run([t.file, '-t', escape(t.title)], `${RIG}/out/mut/unit2-${process.env.TAG ?? ''}${id}-alone.json`);
      if (alone.failed.some((f) => f.title === t.title)) fails += 1;
    }
    (fails === 2 ? confirmed : noise).push(`${path.basename(t.file)} > ${t.title}`);
  }
  const row = { id, what: m.what, total: first.total, failedInFullRun: first.failed.length, killedBy: confirmed, failedOnlyInFullRun: noise };
  rows.push(row);
  console.log(JSON.stringify(row));
}
for (const x of mutants) copyFileSync(`${P}/${x.file}`, `${W}/${x.file}`);
writeFileSync(`${RIG}/out/mut/${process.env.SUMMARY ?? 'unit2-summary.json'}`, JSON.stringify(rows, null, 2));
