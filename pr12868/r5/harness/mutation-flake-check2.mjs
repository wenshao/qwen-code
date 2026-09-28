// Tells a real kill from a load failure: runs hosted-harness-session.test.ts
// alone, several times, without a mutant and with each named mutant, and lists
// the failing test names of every run.
// usage: MUT_WT=wt-mut node mutation-flake-check2.mjs <ids comma separated> [runs]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mutants as round1, round2, round3, round4, round5 } from './mutants.mjs';
const mutants = [...round1, ...round2, ...round3, ...round4, ...round5];
const SP = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const WT = path.join(SP, process.env.MUT_WT ?? 'wt-mut');
const OUT = path.join(SP, 'rig', 'out', 'mutation');
const env = { ...process.env, PATH: `/opt/node-22.23.2/bin:${process.env.PATH}`, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };
const git = (...a) => execFileSync('git', a, { cwd: WT, encoding: 'utf8' }).trim();
if (git('status', '--short') !== '') throw new Error('worktree is not clean');
const runs = Number(process.argv[3] ?? 3);
const say = (line) => { console.log(line); fs.appendFileSync(path.join(OUT, 'flake-check.log'), line + '\n'); };
function once(label, n) {
  const out = path.join(OUT, `flake-${label}-${n}.json`);
  spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`, 'src/serve/hosted-harness-session.test.ts'], { cwd: path.join(WT, 'packages/cli'), env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const json = JSON.parse(fs.readFileSync(out, 'utf8'));
  const failed = json.testResults.flatMap((f) => f.assertionResults.filter((t) => t.status === 'failed').map((t) => t.title));
  say(`${label.padEnd(10)} run ${n}: ${json.numPassedTests}/${json.numTotalTests} passed; failed: ${JSON.stringify(failed)} load=${os.loadavg()[0].toFixed(2)}`);
}
say(`# head=${git('rev-parse', 'HEAD')} ${new Date().toISOString()}`);
for (let n = 1; n <= runs; n++) once('no mutant', n);
for (const id of process.argv[2].split(',')) {
  const m = mutants.find((x) => x.id === id);
  const file = path.join(WT, m.file);
  const source = fs.readFileSync(file, 'utf8');
  if (source.split(m.find).length - 1 !== 1) throw new Error(`anchor of ${id}`);
  fs.writeFileSync(file, source.replace(m.find, m.replace));
  try {
    for (let n = 1; n <= runs; n++) once(id, n);
  } finally {
    git('checkout', '--', m.file);
  }
}
