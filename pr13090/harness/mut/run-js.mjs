// Checker-script mutants, judged by scripts/tests/check-failsafe-reports.test.js. Restores the file afterwards.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = process.argv[2];
const F = `${W}/scripts/check-failsafe-reports.js`;
const orig = fs.readFileSync(F, 'utf8');
const M = [
  ['C1', 'drop the exactly-one gate source check', "  if (optIn && expected.length !== 1) {", "  if (false && optIn && expected.length !== 1) {"],
  ['C2', 'drop the skipped/failed gate case check', "      optIn &&\n      ['skipped', 'failure', 'error']", "      false &&\n      ['skipped', 'failure', 'error']"],
  ['C3', 'only reject skipped (not failure/error)', "['skipped', 'failure', 'error'].some", "['skipped'].some"],
  ['C4', 'revert source filter to *IT.java', ".filter((file) => file.endsWith('.java'))", ".filter((file) => file.endsWith('IT.java'))"],
  ['C5', 'o4-mysql family matches any O4* class', "['o4-mysql', (className) => className === 'O4MySqlGate']", "['o4-mysql', (className) => className.startsWith('O4')]"],
  ['C6', 'o4-oss treated as not opt-in', "const optIn = family === 'o4-mysql' || family === 'o4-oss';", "const optIn = family === 'o4-mysql';"],
];
try {
  for (const [id, desc, a, b] of M) {
    const n = orig.split(a).length - 1;
    if (n !== 1) { console.log(id, 'anchor', n); continue; }
    fs.writeFileSync(F, orig.replace(a, b));
    const r = spawnSync('npx', ['vitest', 'run', '--config', './scripts/tests/vitest.config.ts', 'scripts/tests/check-failsafe-reports.test.js'], { cwd: W, encoding: 'utf8' });
    const t = r.stdout + r.stderr;
    const m = t.match(/Tests\s+(.*)/);
    console.log(JSON.stringify({ id, desc, result: r.status === 0 ? 'SURVIVED' : 'killed', tests: m?.[1]?.trim() }));
  }
} finally { fs.writeFileSync(F, orig); }
