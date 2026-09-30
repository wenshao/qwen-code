// For survivors whose only failures were load-sensitive tests: run those tests alone, twice, with the mutant applied.
// usage: node recheck3.mjs <tree> <id> ... (reads the failing test names from the round-2 logs)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MUTANTS } from './mutants.mjs';
const [tree, ...ids] = process.argv.slice(2);
const NODE_BIN = '/opt/node22/bin';
const O = '/rig/out/';
const out = O + 'mut-r2-recheck.log';
const say = (l) => (console.log(l), fs.appendFileSync(out, l + '\n'));
const run = (pattern) => {
  const r = spawnSync('npx', ['vitest', 'run', '--testTimeout=30000', 'src/serve/hosted-harness-session.test.ts', 'src/serve/hosted-workspace-tool-turn.test.ts', '-t', pattern], { cwd: path.join(tree, 'packages/cli'), encoding: 'utf8', env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, NO_COLOR: '1' }, maxBuffer: 64 << 20 });
  return ((r.stdout + r.stderr).match(/^ *Tests .*$/m) ?? ['<no summary>'])[0].trim().replace(/\s+/g, ' ');
};
const PATS = { default: 'refuses a cold load when a settled file tool outcome is missing', N03: 'preserves the original Shell receipt and continuation across' };
for (const p of new Set(Object.values(PATS))) say(`BASELINE alone "${p}": ${run(p)} | ${run(p)}`);
for (const id of ids) {
  const PAT = PATS[id] ?? PATS.default;
  const [, f, search, replace, note] = MUTANTS.find((m) => m[0] === id);
  const abs = path.join(tree, f);
  const original = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, original.replace(search, replace));
  try {
    const a = run(PAT), b = run(PAT);
    say(`${id} [${note}] "${PAT}" alone: ${a} | ${b} => ${/failed/.test(a) && /failed/.test(b) ? 'KILLED (the load-sensitive test fails alone too)' : 'SURVIVED'}`);
  } finally {
    fs.writeFileSync(abs, original);
  }
}
say('RECHECK3 DONE');
