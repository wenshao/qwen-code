// Re-runs hosted-harness-session.test.ts alone with a mutant applied, to tell
// a real kill from a timing failure of the full 20-file run under load.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mutants } from './mutants.mjs';
const SP = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const WT = path.join(SP, 'wt-mut');
const env = { ...process.env, PATH: `/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:${process.env.PATH}`, NO_COLOR: '1', CI: '1' };
const git = (...a) => execFileSync('git', a, { cwd: WT, encoding: 'utf8' }).trim();
if (git('status', '--short') !== '') throw new Error('wt-mut is not clean');
for (const id of process.argv[2].split(',')) {
  const m = mutants.find((x) => x.id === id);
  const file = path.join(WT, m.file);
  const source = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, source.replace(m.find, m.replace));
  try {
    const out = path.join(SP, 'rig', 'out', 'mutation', `${id}-flake-check.json`);
    spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`, 'src/serve/hosted-harness-session.test.ts'], { cwd: path.join(WT, 'packages/cli'), env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const json = JSON.parse(fs.readFileSync(out, 'utf8'));
    const line = `${id} applied, hosted-harness-session.test.ts alone: ${json.numPassedTests}/${json.numTotalTests} passed, ${json.numFailedTests} failed`;
    console.log(line);
    fs.appendFileSync(path.join(SP, 'rig', 'out', 'mutation', 'matrix.log'), `# flake-check ${line}\n`);
  } finally {
    git('checkout', '--', m.file);
  }
}
