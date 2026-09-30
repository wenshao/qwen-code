// Re-run chosen mutants in isolation: a kill stands only if the same test fails in both of two independent runs.
// usage: node recheck.mjs <tree> <id:files,...> ...   files: H = harness-session + tool-turn, W = the three worker-side files
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MUTANTS } from './mutants.mjs';
const [tree, ...specs] = process.argv.slice(2);
const NODE_BIN = '/opt/node22/bin';
const SETS = { H: ['src/serve/hosted-harness-session.test.ts', 'src/serve/hosted-workspace-tool-turn.test.ts'], W: ['src/serve/managed-runtime-file-history.test.ts', 'src/serve/managed-runtime-provider-protocol.test.ts', 'src/serve/managed-runtime-provider-worker.test.ts'] };
const out = '/rig/out/mut-recheck.log';
const say = (l) => (console.log(l), fs.appendFileSync(out, l + '\n'));
function run(files) {
  const r = spawnSync('npx', ['vitest', 'run', '--retry=2', '--testTimeout=30000', '--hookTimeout=30000', ...files], { cwd: path.join(tree, 'packages/cli'), encoding: 'utf8', env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, NO_COLOR: '1' }, maxBuffer: 256 * 1024 * 1024 });
  const text = r.stdout + r.stderr;
  const failed = [...new Set([...text.matchAll(/^ *× +(.*?)(?: \d+ms.*)?$/gm)].map((m) => m[1].trim()))];
  return { rc: r.status, failed, summary: (text.match(/^ *Tests .*$/m) ?? ['<no summary>'])[0].trim().replace(/\s+/g, ' ') };
}
for (const spec of specs) {
  const [id, set] = spec.split(':');
  const [, file, search, replace, note] = MUTANTS.find((m) => m[0] === id);
  const abs = path.join(tree, file);
  const original = fs.readFileSync(abs, 'utf8');
  if (original.split(search).length !== 2) throw new Error(`anchor ${id}`);
  fs.writeFileSync(abs, original.replace(search, replace));
  try {
    const a = run(SETS[set]);
    const b = run(SETS[set]);
    const both = a.failed.filter((t) => b.failed.includes(t));
    say(`${id} [${note}] run1: ${a.summary} ${JSON.stringify(a.failed.map((t) => t.slice(0, 90)))} | run2: ${b.summary} ${JSON.stringify(b.failed.map((t) => t.slice(0, 90)))} => ${both.length ? 'KILLED by ' + JSON.stringify(both.map((t) => t.slice(0, 110))) : 'SURVIVED (no test failed in both runs)'}`);
  } finally {
    fs.writeFileSync(abs, original);
  }
}
say('RECHECK DONE');
