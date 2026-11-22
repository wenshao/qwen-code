// Encode every expected outcome and derive assertions.json from the raw runs.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const matrix = JSON.parse(readFileSync(path.join(dir, 'matrix.json'), 'utf8'));
const docsHead = JSON.parse(readFileSync(path.join(dir, 'docs-head.json'), 'utf8'));
const docsBase = JSON.parse(readFileSync(path.join(dir, 'docs-base.json'), 'utf8'));
const browser = JSON.parse(readFileSync(path.join(dir, 'browser-oracle.json'), 'utf8'));

const rows = [];
const add = (name, expected, actual, detail) => {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  rows.push({ name, expected, actual, ok, detail });
};

// The new test must kill the three issue-named mutations (M1-M3), the base
// token pin (M4) and a near-miss token (M5); the old test must survive all of
// them (that is the control that says the coverage is new). M6 is the
// formatting-tolerance positive control. M7/M8 are the selector-shape boundary.
const expectMatrix = {
  'C0-unmutated': { base: 'PASS', head: 'PASS' },
  'M1-running-token-to-blue': { base: 'PASS', head: 'FAIL' },
  'M2-running-color-deleted': { base: 'PASS', head: 'FAIL' },
  'M3-running-rule-moved-before-base': { base: 'PASS', head: 'FAIL' },
  'M4-base-token-to-success': { base: 'PASS', head: 'FAIL' },
  'M5-running-token-near-miss': { base: 'PASS', head: 'FAIL' },
  'M6-running-decl-multiline': { base: 'PASS', head: 'PASS' },
  'M7-higher-specificity-blue-override': { base: 'PASS', head: 'PASS' },
  'M8-media-blue-override': { base: 'PASS', head: 'PASS' },
  'M9-important-blue-override': { base: 'PASS', head: 'FAIL' },
};
for (const r of matrix) {
  const want = expectMatrix[r.mutation];
  add(`matrix:${r.mutation}:base`, want.base, r.base.pass ? 'PASS' : 'FAIL');
  add(`matrix:${r.mutation}:head`, want.head, r.head.pass ? 'PASS' : 'FAIL');
}

for (const r of browser) add(`browser:${r.mutation}:${r.kind}`, r.expected, r.actual, r.expected === r.actual ? '' : 'computed color mismatch');

// Head docs: every claim must hold. Base docs: the 12 changed-claim checks
// must fail (planted falsehood) while the 10 structural/code checks pass.
const controlNames = docsBase.filter((c) => !c.ok).map((c) => c.name);
if (controlNames.length !== 12) throw new Error(`base control expected 12 red rows, got ${controlNames.length}`);
for (const c of docsHead) add(`docs-head:${c.name}`, true, c.ok);
for (const c of docsBase) add(`docs-base:${c.name}`, controlNames.includes(c.name) ? false : true, c.ok);

let prettierOk = true;
try {
  execFileSync('/root/git/qwen-code-verify/node_modules/.bin/prettier', ['--check', path.join(dir, 'head-en.md'), path.join(dir, 'head-zh.md'), path.join(dir, 'pkg', 'head.css.test.ts')], { stdio: 'pipe' });
} catch {
  prettierOk = false;
}
add('prettier:three-changed-files', true, prettierOk);

const failed = rows.filter((r) => !r.ok);
const summary = { pass: rows.length - failed.length, fail: failed.length, total: rows.length };
writeFileSync(path.join(dir, 'assertions.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(path.join(dir, 'assertions-detail.json'), JSON.stringify(rows, null, 2));
for (const r of failed) console.log(`FAIL  ${r.name}  expected=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}`);
console.log(`assertions: ${summary.pass} pass, ${summary.fail} fail, ${summary.total} total`);
process.exit(failed.length ? 1 : 0);
