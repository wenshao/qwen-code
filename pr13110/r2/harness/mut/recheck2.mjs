// Targeted recheck: run only the test that killed the mutant, twice, alone. The kill stands if it fails both times.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MUTANTS } from './mutants.mjs';
const tree = process.argv[2];
const NODE_BIN = '/opt/node22/bin';
const HS = 'src/serve/hosted-harness-session.test.ts', TT = 'src/serve/hosted-workspace-tool-turn.test.ts';
const UNDO = 'persists undo across reload and retains pending state on release failure';
const PLAN = { M09: [HS, UNDO], M10: [HS, UNDO], M13: [HS, UNDO], M20: [HS, UNDO], M54: [HS, UNDO], M28: [HS, UNDO], M18: [HS, 'refuses file history APIs on the MCP profile'], M19: [HS, 'refuses file history APIs on the MCP profile'], M55: [HS, 'retains the turn recovery error on cold load of a pending file edit'], M26: [TT, 'persists the prepared history before effects and settled history before continuation'], M27: [TT, 'persists the prepared history before effects and settled history before continuation'], M23: [TT, 'persists the prepared history before effects and settled history before continuation'], M25: [TT, 'keeps native file tools in the MCP profile'] };
const out = '/rig/out/mut-recheck2.log';
fs.writeFileSync(out, '');
const say = (l) => (console.log(l), fs.appendFileSync(out, l + '\n'));
const run = (file, pattern) => {
  const r = spawnSync('npx', ['vitest', 'run', '--testTimeout=30000', '--hookTimeout=30000', file, '-t', pattern], { cwd: path.join(tree, 'packages/cli'), encoding: 'utf8', env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, NO_COLOR: '1' }, maxBuffer: 64 * 1024 * 1024 });
  return ((r.stdout + r.stderr).match(/^ *Tests .*$/m) ?? ['<no summary>'])[0].trim().replace(/\s+/g, ' ');
};
const base = Object.fromEntries([...new Set(Object.values(PLAN).map((p) => p.join('|')))].map((k) => [k, run(...k.split('|'))]));
say('BASELINE ' + JSON.stringify(base));
for (const [id, [file, pattern]] of Object.entries(PLAN)) {
  const [, f, search, replace, note] = MUTANTS.find((m) => m[0] === id);
  const abs = path.join(tree, f);
  const original = fs.readFileSync(abs, 'utf8');
  if (original.split(search).length !== 2) throw new Error(`anchor ${id}`);
  fs.writeFileSync(abs, original.replace(search, replace));
  try {
    const a = run(file, pattern), b = run(file, pattern);
    say(`${id} [${note}] "${pattern.slice(0, 60)}": run1 ${a} | run2 ${b} => ${/failed/.test(a) && /failed/.test(b) ? 'KILLED' : /failed/.test(a) || /failed/.test(b) ? 'UNSTABLE' : 'SURVIVED'}`);
  } finally {
    fs.writeFileSync(abs, original);
  }
}
say('RECHECK2 DONE');
