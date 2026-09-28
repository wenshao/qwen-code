// Round 4: focused re-measurement of round 3's surviving mutant M17 (history id
// random again) with a clean baseline for the turn suite (coverage disabled —
// the enabled run dies on a missing coverage/.tmp/coverage-0.json, which is a
// harness artifact, not a test result).
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const W = '/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head';
const F = `${W}/packages/cli/src/serve/hosted-workspace-tool-turn.ts`;
const CMD = `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts --reporter=basic --coverage.enabled=false 2>&1`;

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
    failed: (out.match(/^\s+× [^\n]*/gm) ?? []).slice(0, 5).map((s) => s.trim()),
  };
}

const b = run();
console.log(`baseline turn: ${b.ok ? 'PASS' : 'FAIL'} ${b.line}`);
for (const f of b.failed) console.log(`    ${f}`);

const src = fs.readFileSync(F, 'utf8');
const from = 'messageId = shellHistoryId(executionCallId);';
if (!src.includes(from)) {
  console.log('M17: ANCHOR NOT FOUND');
  process.exit(9);
}
fs.writeFileSync(F, src.replace(from, 'messageId = randomUUID();'));
const mutated = fs.readFileSync(F, 'utf8') !== src;
const r = run();
fs.writeFileSync(F, src);
const restored = fs.readFileSync(F, 'utf8') === src;
console.log(`M17 history id random again: ${r.ok ? 'SURVIVED' : 'KILLED'} (turn: ${r.line}) mutated=${mutated} restored=${restored}`);
for (const f of r.failed) console.log(`    ${f}`);
console.log(`clean: ${execSync(`cd ${W} && git status --porcelain`, { encoding: 'utf8' }).trim().length === 0}`);
console.log('M17_DONE');
