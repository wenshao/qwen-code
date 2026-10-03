// Summarize round-3 logs into scripted pass/fail assertions.
// Every harness prints PASS/FAIL lines and a RESULT (X/Y) line. For arms with
// expected failures (the control cells), the expected failing check names are
// encoded here; a check whose actual status differs from its expectation is an
// unexpected outcome. Usage: node summarize.mjs <logdir>
import * as fs from 'node:fs';
import * as path from 'node:path';

const logdir = process.argv[2];
// arm -> { expect: 'all-pass' } or { expectFails: [check name substrings] }
const ARMS = {
  'B-store-win32-locked': { expect: 'all-pass' },
  'D-store-win32-unlocked': { expect: 'all-pass' },
  'C-store-darwin-locked': {
    expectFails: [
      'update completes',
      'installed tree is 2.0.0',
      'file dropped by v2 is pruned',
      'file added by v2 is present',
      'nested file carries v2 content',
      'uninstall completes',
      'installed directory is gone',
      'store entry removed',
    ],
  },
  'E-store-win32-strict': {
    expectFails: [
      'uninstall completes',
      'installed directory is gone',
      'store entry removed',
    ],
  },
  'crash-recovery': { expect: 'all-pass' },
  'shapes': { expect: 'all-pass' },
  'blocked-rollback': { expect: 'all-pass' },
};

let pass = 0, fail = 0;
const fails = [];
const record = (arm, name, ok) => {
  if (ok) pass += 1;
  else { fail += 1; fails.push(`${arm}: ${name}`); }
};

for (const [arm, spec] of Object.entries(ARMS)) {
  const file = path.join(logdir, `${arm}.log`);
  if (!fs.existsSync(file)) { console.log(`MISSING ${arm}`); continue; }
  const lines = fs.readFileSync(file, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const checks = [];
  for (const line of lines) {
    const m = line.match(/^(PASS|FAIL)  (.+?)(?:\s+\[.*\])?\s*$/);
    if (m) checks.push({ ok: m[1] === 'PASS', name: m[2] });
  }
  if (checks.length === 0) { record(arm, 'harness produced no checks', false); continue; }
  const expectedFails = spec.expect === 'all-pass' ? [] : spec.expectFails;
  for (const chk of checks) {
    const expectedToFail = expectedFails.some((f) => chk.name.startsWith(f));
    const ok = expectedToFail ? !chk.ok : chk.ok;
    record(arm, `${chk.ok ? 'pass' : 'fail'} ${chk.name}${expectedToFail ? ' (expected)' : ''}`, ok);
  }
  const unexpected = checks.filter((chk) => {
    const expectedToFail = expectedFails.some((f) => chk.name.startsWith(f));
    return expectedToFail ? chk.ok : !chk.ok;
  });
  console.log(`${unexpected.length === 0 ? 'ARM-PASS' : 'ARM-FAIL'}  ${arm}  (${checks.length - checks.filter((c) => !c.ok).length}/${checks.length} raw, ${unexpected.length} unexpected)`);
}
console.log(`\nTOTAL scripted assertions: pass=${pass} fail=${fail}`);
for (const f of fails) console.log(`  UNEXPECTED: ${f}`);
