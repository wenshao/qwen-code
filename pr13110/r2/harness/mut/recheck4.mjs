// Targeted recheck: the named killing test alone, twice, with the mutant applied.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MUTANTS } from './mutants.mjs';
const tree = process.argv[2];
const NODE_BIN = '/opt/node22/bin';
const PLAN = Object.fromEntries((process.env.IDS ?? 'M24,M03').split(',').map((id) => [id, id === 'M24' ? 'asks again in the Turn after one whose calls were all refused' : 'settles undo or preserves its recovery boundary']));
const out = '/rig/out/mut-r2-recheck.log';
const say = (l) => (console.log(l), fs.appendFileSync(out, l + '\n'));
const run = (p) => ((spawnSync('npx', ['vitest', 'run', '--testTimeout=60000', 'src/serve/hosted-harness-session.test.ts', '-t', p], { cwd: path.join(tree, 'packages/cli'), encoding: 'utf8', env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, NO_COLOR: '1' } }).stdout ?? '').match(/^ *Tests .*$/m) ?? ['<none>'])[0].trim().replace(/\s+/g, ' ');
for (const [id, p] of Object.entries(PLAN)) {
  say(`BASELINE "${p}": ${run(p)} | ${run(p)}`);
  const [, f, search, replace, note] = MUTANTS.find((m) => m[0] === id);
  const abs = path.join(tree, f);
  const original = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, original.replace(search, replace));
  try {
    const a = run(p), b = run(p);
    say(`${id} [${note}] "${p}" alone: ${a} | ${b} => ${/failed/.test(a) && /failed/.test(b) ? 'KILLED' : 'SURVIVED'}`);
  } finally {
    fs.writeFileSync(abs, original);
  }
}
