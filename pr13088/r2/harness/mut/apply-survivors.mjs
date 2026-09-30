// Applies every surviving TypeScript mutant at once to a tree (for a real-stack check of what the unit suite does not pin).
import fs from 'node:fs';
import path from 'node:path';
const W = process.argv[2]; const ids = process.argv.slice(3);
const src = fs.readFileSync(new URL('./ts-mutants.mjs', import.meta.url), 'utf8');
// Re-use the mutant table without running the runner.
const table = src.slice(src.indexOf('const M = ['), src.indexOf('const want = process.argv'));
const H = 'packages/cli/src/serve/hosted-harness-session.ts';
const P = 'packages/core/src/managed-runtime/managed-session-message-projection.ts';
const K = 'packages/core/src/managed-runtime/managed-session-record-sink.ts';
const CLI = {}; const CORE = {};
const M = new Function('H', 'P', 'K', 'CLI', 'CORE', `${table}; return M;`)(H, P, K, CLI, CORE);
for (const id of ids) {
  const m = M.find((x) => x.id === id); const f = path.join(W, m.file); const orig = fs.readFileSync(f, 'utf8');
  const hits = orig.split(m.find).length - 1; if (hits !== 1) throw new Error(`${id} anchor hits=${hits}`);
  fs.writeFileSync(f, orig.replace(m.find, m.to)); console.log(`applied ${id}: ${m.what}`);
}
