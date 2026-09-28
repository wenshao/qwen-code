// Round 4: focused, serialized re-measurement of round 3's surviving mutant M18
// (receipt commit not retried) plus its same-file positive control, run after a
// concurrent-process contamination was found and the tree restored to clean.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const W = '/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head';
const F = `${W}/packages/core/src/managed-runtime/http-managed-session-store.ts`;
const CMD = `cd ${W}/packages/core && npx vitest run src/managed-runtime/http-managed-session-store.test.ts --reporter=basic --coverage.enabled=false 2>&1`;

function run() {
  let out = '';
  let ok = true;
  try {
    out = execSync(CMD, { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash' });
  } catch (e) {
    ok = false;
    out = (e.stdout ?? '') + (e.stderr ?? '');
  }
  return {
    ok,
    line: ((out.match(/Tests\s+\d+[^\n]*/g) ?? ['?']).at(-1) ?? '?').trim(),
    failed: (out.match(/^\s+× [^\n]*/gm) ?? []).slice(0, 4).map((s) => s.trim()),
  };
}

const clean = () => execSync(`cd ${W} && git status --porcelain`, { encoding: 'utf8' }).trim();
console.log(`pre-run tree clean: ${clean().length === 0}`);
const b = run();
console.log(`baseline store: ${b.ok ? 'PASS' : 'FAIL'} ${b.line}`);

const mutants = [
  ['M18 receipt commit not retried (r3: SURVIVED)', 'if (!uncertain || attempt === 2) throw error;', 'throw error;'],
  ['C-store control: writer token header renamed', "writerTokenHeader: 'X-Qwen-Managed-Writer-Token',", "writerTokenHeader: 'X-Qwen-Managed-Writer-Token2',"],
];
for (const [label, from, to] of mutants) {
  const src = fs.readFileSync(F, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: ANCHOR NOT FOUND`); continue; }
  fs.writeFileSync(F, src.replace(from, to));
  const mutated = fs.readFileSync(F, 'utf8') !== src;
  const r = run();
  fs.writeFileSync(F, src);
  const restored = fs.readFileSync(F, 'utf8') === src;
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (store: ${r.line}) mutated=${mutated} restored=${restored}`);
  for (const f of r.failed) console.log(`    ${f}`);
}
console.log(`post-run tree clean: ${clean().length === 0}`);
console.log('M18_DONE');
