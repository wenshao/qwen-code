// Case-level recheck for the flaky parametrized undo test: a mutant is killed only by a case that fails in both mutant runs
// and in none of four baseline runs.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MUTANTS } from './mutants.mjs';
const [tree, ...ids] = process.argv.slice(2);
const NODE_BIN = '/opt/node22/bin';
const P = process.env.PAT ?? 'settles undo or preserves its recovery boundary';
const out = process.env.OUT ?? '/rig/out/mut-r2-recheck.log';
const say = (l) => (console.log(l), fs.appendFileSync(out, l + '\n'));
const run = () => {
  const t = spawnSync('npx', ['vitest', 'run', '--testTimeout=60000', 'src/serve/hosted-harness-session.test.ts', '-t', P], { cwd: path.join(tree, 'packages/cli'), encoding: 'utf8', env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, NO_COLOR: '1' } }).stdout ?? '';
  return new Set([...t.matchAll(/^ *× (.*?)(?: \d+ms)?(?: \(retry x\d+\))?$/gm)].map((m) => m[1].replace(/^.*> /, '')));
};
const base = new Set();
for (let i = 0; i < 4; i++) for (const c of run()) base.add(c);
say(`BASELINE x4 "${P}": cases that failed at least once = ${JSON.stringify([...base])}`);
for (const id of ids) {
  const [, f, search, replace, note] = MUTANTS.find((m) => m[0] === id);
  const abs = path.join(tree, f);
  const original = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, original.replace(search, replace));
  try {
    const a = run(), b = run();
    const both = [...a].filter((c) => b.has(c) && !base.has(c));
    say(`${id} [${note}] cases failing in both runs and never in baseline: ${JSON.stringify(both)} (run1 ${JSON.stringify([...a])}, run2 ${JSON.stringify([...b])}) => ${both.length ? 'KILLED' : 'SURVIVED'}`);
  } finally {
    fs.writeFileSync(abs, original);
  }
}
