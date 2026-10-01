// VERIFICATION RIG ONLY (PR #13107): pairs of mutants from mutate4.mjs applied together, to tell a test gap from two
// overlapping mechanisms (each mutant survives alone, the pair is killed).
// usage: node mutpairs.mjs <worktree> A+B ...
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const W = process.argv[2];
const pairs = process.argv.slice(3);
const M = `${W}/packages/web-shell/client/components/managed`;
const src = fs.readFileSync(new URL('./mutate4.mjs', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('const mutants = ['), src.indexOf('];\n\nfunction run') + 2);
const mutants = new Function(`${block}; return mutants;`)();
const byId = Object.fromEntries(mutants.map((m) => [m[0], m]));
function run() {
  const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.config.ts', 'client/components/managed', 'client/components/messages/ToolApproval'], { cwd: `${W}/packages/web-shell`, encoding: 'utf8', env: { ...process.env, CI: '1' }, timeout: 600_000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return { status: r.status, tests: out.match(/Tests\s+(.*)/)?.[1]?.replace(/\x1b\[[0-9;]*m/g, '') ?? '', failed: [...new Set([...out.matchAll(/×\s+(.*?)(?:\s\d+ms)?$/gm)].map((m) => m[1].replace(/\x1b\[[0-9;]*m/g, '').trim()))].slice(0, 3) };
}
for (const pair of pairs) {
  const ids = pair.split('+');
  const files = new Map();
  let ok = true;
  for (const id of ids) {
    const [, file, , find, replace] = byId[id];
    const p = `${M}/${file}`;
    if (!files.has(p)) files.set(p, fs.readFileSync(p, 'utf8'));
    const cur = fs.readFileSync(p, 'utf8');
    if (!cur.includes(find)) { console.log(`${pair}: anchor of ${id} not found`); ok = false; break; }
    fs.writeFileSync(p, cur.replace(find, replace));
  }
  let r;
  try { if (ok) r = run(); } finally { for (const [p, s] of files) fs.writeFileSync(p, s); }
  if (ok) console.log(`${pair.padEnd(10)} ${r.status !== 0 ? 'killed  ' : 'SURVIVED'} ${r.tests}  ${r.failed.join(' | ')}`);
}
console.log(`worktree after: ${spawnSync('git', ['status', '--short', 'packages/web-shell/client/components'], { cwd: W, encoding: 'utf8' }).stdout.trim() || 'clean'}`);
