// Scripted assertions over the CLI E2E log and the four mutant logs.
import * as fs from 'node:fs';
import * as path from 'node:path';
const logdir = process.argv[2];
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${String(detail).slice(0, 80)}]` : ''}`);
  ok ? pass++ : fail++;
};

// ---- CLI E2E (real bundle, real lock) ----
const cli = fs.readFileSync(path.join(logdir, 'cli-head.log'), 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
const wlog = fs.readFileSync(path.join(logdir, 'cli-head-winlock.log'), 'utf8');
check('CLI: install succeeds', /installed successfully and enabled/.test(cli));
check('CLI: update reports 1.0.0 -> 2.0.0, exit 0', /successfully updated: 1\.0\.0 → 2\.0\.0/.test(cli));
check('CLI: the lock really engaged (rename refused, holder pid named)', /rename\s+\S+e2e-lock-probe\s+pid=\d+ fd=\d+/.test(wlog), wlog.split('\n')[0]);
check('CLI: installed manifest reads 2.0.0 after update', /"version": "2\.0\.0"/.test(cli));
check('CLI: dropped file pruned, added file present', /added-by-v2\.md qwen-extension\.json skills/.test(cli) && !/dropped-by-v2\.md qwen-extension/.test(cli));
check('CLI: uninstall succeeds', /successfully uninstalled/.test(cli));
check('CLI: rollback and transactions areas left empty', /rollback:\s*\n\s*transactions:\s*$/.test(cli.trim() + '\n') || (/rollback:\s*$/.test(cli) && /transactions:\s*$/.test(cli.trim())));

// ---- mutation probes: each mutant must die by exactly the expected tests ----
const failingTests = (file) => {
  const raw = fs.readFileSync(path.join(logdir, file), 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  return [...raw.matchAll(/^\s*FAIL\s+src\/extension\/extension-store\.test\.ts > (.+)$/gm)].map((m) => m[1].trim()).sort();
};
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const FIX_TESTS = [
  'ExtensionStore > locked extension directory > keeps an owed journal whose restore fails for a non-lock reason and heals it once the fault clears',
  'ExtensionStore > locked extension directory > surfaces a rollback failure that is not a lock',
];
const MTIME_TEST = ['ExtensionStore > locked extension directory > falls back to mtime order when a stack claims one generation'];
check('mutant nofix (revert 58b49ad2e): killed by exactly the two extended tests', eq(failingTests('mutant-nofix.log'), FIX_TESTS), failingTests('mutant-nofix.log').join(' | '));
check('mutant M04 (live mtime order): killed by the utimes-pinned test', eq(failingTests('mutant-M04.log'), MTIME_TEST), failingTests('mutant-M04.log').join(' | '));
check('mutant M20 (orderMs never persisted): killed by the new persistence assertions', eq(failingTests('mutant-M20.log'), MTIME_TEST), failingTests('mutant-M20.log').join(' | '));
check('mutant M06 (windowRefusal ignores rollbackHeld): now pinned by the extended tests', eq(failingTests('mutant-M06.log'), FIX_TESTS), failingTests('mutant-M06.log').join(' | '));

console.log(`\nCLI+MUTANT TOTAL: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
