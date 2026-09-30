// host: build one bundle arm per mutant and run the PR's unit suites against each.
// usage: node build.mjs [ids...]
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mutants } from './mutants.mjs';
const RIG = '/rig';
const W = `${RIG}/src-new-mutants`;
const P = `${RIG}/src-new`;
const only = process.argv.slice(2);
const skipArm = process.env.SKIP_ARM === '1';
const tests = [
  'src/serve/hosted-harness-session.test.ts',
  'src/serve/hosted-runtime-recovery.test.ts',
  'src/serve/hosted-text-deltas.test.ts',
  'src/serve/hosted-harness-model.test.ts',
  'src/serve/hosted-workspace-broker.test.ts',
];
const rows = [];
for (const m of [{ id: 'T00', what: 'no mutation (control)', file: mutants[0].file, from: '', to: '' }, ...mutants]) {
  if (only.length && !only.includes(m.id)) continue;
  for (const x of mutants) copyFileSync(`${P}/${x.file}`, `${W}/${x.file}`);
  const source = readFileSync(`${W}/${m.file}`, 'utf8');
  if (m.from) {
    if (source.split(m.from).length !== 2) throw new Error(`${m.id}: anchor not unique/present`);
    writeFileSync(`${W}/${m.file}`, source.replace(m.from, m.to));
  }
  const bundle = spawnSync('node', ['esbuild.config.js'], { cwd: W, encoding: 'utf8' });
  if (bundle.status !== 0) throw new Error(`${m.id}: bundle failed\n${bundle.stderr.slice(-800)}`);
  const arm = `${RIG}/mut/arm-${m.id}`;
  if (!skipArm) rmSync(arm, { recursive: true, force: true });
  if (!skipArm) {
  mkdirSync(`${arm}/scripts`, { recursive: true });
  mkdirSync(`${arm}/integration-tests`, { recursive: true });
  mkdirSync(`${arm}/packages/sdk-java/managed-agent-server/target`, { recursive: true });
  execFileSync('cp', ['-Rc', `${W}/dist`, `${arm}/dist`]);
  copyFileSync(`${P}/package.json`, `${arm}/package.json`);
  copyFileSync(`${P}/scripts/run-managed-agent-server-e2e.ts`, `${arm}/scripts/run-managed-agent-server-e2e.ts`);
  copyFileSync(`${P}/integration-tests/fake-openai-server.ts`, `${arm}/integration-tests/fake-openai-server.ts`);
  copyFileSync(`${RIG}/server/new-server.jar`, `${arm}/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar`);
  }
  if (process.env.SKIP_UNIT === '1') { console.log(JSON.stringify({ id: m.id, what: m.what, arm: 'built' })); continue; }
  const unit = spawnSync('npx', ['vitest', 'run', ...tests, '--testTimeout=120000', '--hookTimeout=120000', '--reporter=json', `--outputFile=${RIG}/out/mut/unit-${m.id}.json`], {
    cwd: `${W}/packages/cli`,
    encoding: 'utf8',
  });
  let failed = [];
  let total = 0;
  try {
    const report = JSON.parse(readFileSync(`${RIG}/out/mut/unit-${m.id}.json`, 'utf8'));
    total = report.numTotalTests;
    failed = report.testResults.flatMap((file) =>
      file.assertionResults.filter((t) => t.status === 'failed').map((t) => `${path.basename(file.name)} > ${t.title}`),
    );
  } catch (error) {
    failed = [`(no vitest report: exit ${unit.status})`];
  }
  const row = { id: m.id, what: m.what, unitTotal: total, unitFailed: failed.length, unitKilledBy: failed.slice(0, 6) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
for (const x of mutants) copyFileSync(`${P}/${x.file}`, `${W}/${x.file}`);
writeFileSync(`${RIG}/out/mut/unit-summary${only.length ? '-' + only.join('_') : ''}.json`, JSON.stringify(rows, null, 2));
