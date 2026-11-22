import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mutations } from './mutations.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname);
const pkg = path.join(dir, 'pkg');
const cssPath = path.join(pkg, 'WebShellSidebar.module.css');
const orig = readFileSync(path.join(pkg, 'css.orig'), 'utf8');
const vitest = '/root/git/qwen-code-verify/node_modules/.bin/vitest';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function runTest(file) {
  const out = path.join(pkg, `result-${file}.json`);
  if (existsSync(out)) unlinkSync(out);
  try {
    execFileSync(vitest, ['run', '--config', 'vitest.config.mts', '--reporter=json', `--outputFile=${out}`, file], {
      cwd: pkg,
      stdio: 'pipe',
    });
  } catch {
    /* non-zero exit is expected for killed mutants; JSON is still written */
  }
  const r = JSON.parse(readFileSync(out, 'utf8'));
  return {
    total: r.numTotalTests,
    failed: r.numFailedTests,
    passed: r.numPassedTests,
    failedNames: r.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.title)),
    messages: r.testResults.flatMap((f) =>
      f.assertionResults.filter((a) => a.status === 'failed').map((a) => (a.failureMessages || []).join(' ')),
    ),
  };
}

const rows = [];
for (const [name, fn] of Object.entries(mutations)) {
  const mutated = fn(orig);
  writeFileSync(cssPath, mutated);
  const base = runTest('base.css.test.ts');
  const head = runTest('head.css.test.ts');
  writeFileSync(cssPath, orig);
  if (sha(readFileSync(cssPath, 'utf8')) !== sha(orig)) throw new Error(`restore failed after ${name}`);
  rows.push({
    mutation: name,
    cssSha: sha(mutated),
    base: { pass: base.failed === 0, failed: base.failed, total: base.total, names: base.failedNames },
    head: { pass: head.failed === 0, failed: head.failed, total: head.total, names: head.failedNames },
    headMessage: head.messages[0]?.slice(0, 400) ?? '',
  });
  console.log(
    `${name.padEnd(40)} base ${base.failed === 0 ? 'PASS' : `FAIL(${base.failed}/${base.total})`}  head ${head.failed === 0 ? 'PASS' : `FAIL(${head.failed}/${head.total})`}`,
  );
}
writeFileSync(path.join(dir, 'matrix.json'), JSON.stringify(rows, null, 2));
console.log(`\ncss restored, sha256=${sha(readFileSync(cssPath, 'utf8'))}`);
