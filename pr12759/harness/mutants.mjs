// Independent mutation check for PR 12759. Each mutant is one exact-string replacement in
// schemaValidator.ts, asserted to apply exactly once; it runs against the PR's test file and
// against the pre-PR test file (9e60263fde, copied next to it), then the source is restored
// byte for byte from an in-memory copy (never through git).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const REPO = process.env.REPO ?? '/Users/wenshao/git/qwen-code-pr12759';
const SV = path.join(REPO, 'packages/core/src/utils/schemaValidator.ts');
const FILES = { pr: 'src/utils/schemaValidator.test.ts', pre: 'src/utils/schemaValidator.pre12759.test.ts' };
const BRANCH = '  if (key === undefined || compiled.failedTexts.has(key)) {\n    compiled.direct.add(schema);\n    return validator.compile(schema);\n  }';
const M = [
  // The six mutants from the PR description, as I read them.
  ['C3', 'compileOnce drops failedTexts.add(key)', '      compiled.failedTexts.add(key);\n', ''],
  ['B3c', 'a new object whose text failed gets an accept-all validator', BRANCH,
    '  if (key !== undefined && compiled.failedTexts.has(key)) {\n    return (() => true) as unknown as ValidateFunction;\n  }\n' + BRANCH],
  ['M7', 'a new object whose text failed is not added to direct', BRANCH,
    BRANCH.replace('    compiled.direct.add(schema);', '    if (key === undefined) compiled.direct.add(schema);')],
  ['F1', 'the catch drops direct.add(schema)', '      compiled.failedTexts.add(key);\n      compiled.direct.add(schema);\n', '      compiled.failedTexts.add(key);\n'],
  ['D1', 'compileOnce drops the early return for direct', '  if (compiled.direct.has(schema)) {\n    return validator.compile(schema);\n  }\n', ''],
  ['A1', 'isExactJsonValue accepts an array of any prototype', '? prototype === Array.prototype', '? true'],
  // Extra mutants, not in the PR's table.
  ['X1', 'an inexact schema is not added to direct', BRANCH,
    BRANCH.replace('    compiled.direct.add(schema);', '    if (key !== undefined) compiled.direct.add(schema);')],
  ['X2', 'failedTexts is never consulted', 'if (key === undefined || compiled.failedTexts.has(key)) {', 'if (key === undefined) {'],
  ['X3', 'the first failing object gets accept-all instead of being compiled', '      compiled.direct.add(schema);\n      return validator.compile(schema);\n    }\n    compiled.byText.set',
    '      compiled.direct.add(schema);\n      return (() => true) as unknown as ValidateFunction;\n    }\n    compiled.byText.set'],
  ['X4', 'bySchema is never filled (control: the pre-PR file already pins it)', '  compiled.bySchema.set(schema, validate);\n  return validate;', '  return validate;'],
  ['X5', 'a direct object is serialized again from its third use (audit round 3, item 2)', '  if (compiled.direct.has(schema)) {\n    return validator.compile(schema);',
    '  if (compiled.direct.has(schema)) {\n    const u = ((globalThis as any).__uses ??= new WeakMap());\n    u.set(schema, (u.get(schema) ?? 0) + 1);\n    if (u.get(schema) >= 2) exactJsonText(schema);\n    return validator.compile(schema);'],
];
const run = (file) => {
  const r = spawnSync('npx', ['vitest', 'run', '--coverage.enabled=false', file], { cwd: path.join(REPO, 'packages/core'), encoding: 'utf8', env: { ...process.env, CI: '1' } });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests = /Tests\s+(.*)/.exec(out)?.[1]?.trim() ?? '?';
  const failed = [...out.matchAll(/^\s+(?:×|FAIL)\s+.*?> (.+?)(?:\s+\d+ms)?$/gm)].map((m) => m[1]);
  return { code: r.status, tests, failed: [...new Set(failed)] };
};
const orig = fs.readFileSync(SV);
const origHash = createHash('sha256').update(orig).digest('hex').slice(0, 10);
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const lines = [`source ${origHash}; test files: pr=${FILES.pr} pre=${FILES.pre}`];
const seen = new Set();
for (const [id, name, from, to] of M) {
  if (only && !only.test(id)) continue;
  const text = orig.toString();
  const n = text.split(from).length - 1;
  if (n !== 1) { lines.push(`${id}: anchor found ${n} times, SKIPPED`); console.log(lines.at(-1)); continue; }
  const mutated = text.replace(from, to);
  const h = createHash('sha256').update(mutated).digest('hex').slice(0, 10);
  if (seen.has(h) || h === origHash) throw new Error(`${id} is not a distinct mutant`);
  seen.add(h);
  fs.writeFileSync(SV, mutated);
  let pr, pre;
  try { pr = run(FILES.pr); pre = run(FILES.pre); } finally { fs.writeFileSync(SV, orig); }
  const v = (r) => (r.code === 0 ? 'pass' : 'FAIL');
  lines.push(`${id.padEnd(4)} [${h}] PR tests: ${v(pr)} (${pr.tests})  pre-PR tests: ${v(pre)} (${pre.tests})  -- ${name}`);
  if (pr.code !== 0) lines.push(`       PR tests that fail: ${pr.failed.join(' | ')}`);
  if (pre.code !== 0) lines.push(`       pre-PR tests that fail: ${pre.failed.join(' | ')}`);
  console.log(lines.slice(-3).join('\n'));
}
const after = createHash('sha256').update(fs.readFileSync(SV)).digest('hex').slice(0, 10);
const clean = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
lines.push(`source after restore: ${after} (${after === origHash ? 'identical' : 'CHANGED'}); tracked files: ${clean.trim() ? 'DIRTY ' + clean : 'clean'}`);
console.log(lines.at(-1));
fs.writeFileSync(process.env.OUT ?? 'mutants.log', lines.join('\n') + '\n');
