// Round 4: re-measure round 3's two surviving TS mutants (M17, M18) at the new
// head, each with a positive control IN THE SAME FILE so a survivor cannot be
// explained by "the chosen command never collected that file".
//
// usage: node mut4-ts.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const W = '/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head';
const P = {
  turn: 'packages/cli/src/serve/hosted-workspace-tool-turn.ts',
  store: 'packages/core/src/managed-runtime/http-managed-session-store.ts',
};
const T = {
  turn: `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts --reporter=basic 2>&1`,
  store: `cd ${W}/packages/core && npx vitest run src/managed-runtime/http-managed-session-store.test.ts --reporter=basic 2>&1`,
};

function run(kind) {
  let out = '';
  let ok = true;
  try {
    out = execSync(T[kind], { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash' });
  } catch (e) {
    ok = false;
    out = (e.stdout ?? '') + (e.stderr ?? '');
  }
  const line = (out.match(/Tests\s+\d+[^\n]*/g) ?? ['? ' + out.slice(-200)]).at(-1);
  const failed = (out.match(/^\s+× [^\n]*/gm) ?? []).slice(0, 4);
  return { ok, line: line.trim(), failed };
}

const mutants = [
  ['M17 history id random again (r3: SURVIVED)', 'turn', P.turn,
    'messageId = shellHistoryId(executionCallId);', 'messageId = randomUUID();'],
  ['C-turn control: spill path kept in Hosted preview (r3: M15 KILLED)', 'turn', P.turn,
    'if (!text.startsWith(TOOL_OUTPUT_TRUNCATED_PREFIX)) return text;', 'return text;'],
  ['M18 receipt commit not retried (r3: SURVIVED)', 'store', P.store,
    'if (!uncertain || attempt === 2) throw error;', 'throw error;'],
  ['C-store control: writer token header renamed', 'store', P.store,
    "writerTokenHeader: 'X-Qwen-Managed-Writer-Token',", "writerTokenHeader: 'X-Qwen-Managed-Writer-Token2',"],
];

for (const kind of ['turn', 'store']) {
  const r = run(kind);
  console.log(`baseline ${kind}: ${r.ok ? 'PASS' : 'FAIL'} ${r.line}`);
}
for (const [label, kind, file, from, to] of mutants) {
  const p = path.join(W, file);
  const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: ANCHOR NOT FOUND`); continue; }
  fs.writeFileSync(p, src.replace(from, to));
  const mutated = fs.readFileSync(p, 'utf8') !== src;
  const r = run(kind);
  fs.writeFileSync(p, src);
  const restored = fs.readFileSync(p, 'utf8') === src;
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${kind}: ${r.line}) mutated=${mutated} restored=${restored}`);
  for (const f of r.failed) console.log(`    ${f.trim()}`);
}
const st = execSync(`cd ${W} && git status --porcelain`, { encoding: 'utf8' });
console.log(`worktree clean after mutants: ${st.trim().length === 0 ? 'YES' : 'NO -> ' + st.trim()}`);
console.log('TS_MUT_DONE');
