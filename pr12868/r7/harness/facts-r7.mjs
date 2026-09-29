// Writes out/suites.log and the hand-checked facts of round 6 from the suite logs.
// usage: node facts-r6.mjs
import fs from 'node:fs';
import path from 'node:path';
const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const read = (arm, suite) => {
  const f = path.join(SP, 'logs', `suites-${arm}`, `${suite}.log`);
  return fs.existsSync(f) ? clean(fs.readFileSync(f, 'utf8')) : undefined;
};
const totals = (text) => [...text.matchAll(/^\[(?:INFO|WARNING|ERROR)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].map((m) => `${m[1]} tests, ${Number(m[2]) + Number(m[3])} failed${m[4] === '0' ? '' : `, ${m[4]} skipped`}`);
const vitest = (text) => [...text.matchAll(/^\s+(Test Files|Tests)\s+(.*)$/gm)].map((m) => `${m[1]} ${m[2].trim()}`).join(' · ');
const SUITES = [
  ['broker-unit', 'runtime-broker unit'],
  ['broker-checkstyle', 'runtime-broker Checkstyle'],
  ['fault-gates', 'process fault gates (real worker and proxy)'],
  ['broker-mysql', 'runtime-broker unit and MySQL ITs'],
  ['server-mysql', 'managed-agent-server unit, MySQL ITs and Checkstyle'],
  ['hosted-mysql', 'Hosted harness on MySQL (packaged Harness, real worker)'],
  ['ts-core', 'core managed-tool'],
];
const lines = [];
for (const [arm, label] of [['h13', 'this head  '], ['tm13', 'trial merge']]) {
  for (const [suite, title] of SUITES) {
    const text = read(arm, suite);
    if (text === undefined) continue;
    let result;
    if (suite === 'ts-core') result = vitest(text);
    else if (suite === 'broker-checkstyle') result = (text.match(/You have (\d+) Checkstyle violations/) ?? [])[0]?.replace('You have ', '') ?? 'no result';
    else {
      const t = totals(text);
      const style = text.match(/You have (\d+) Checkstyle violations/);
      result = `${t.length > 1 ? `unit ${t[0]} · ITs ${t[t.length - 1]}` : t[0] ?? 'no result'}${style && suite === 'server-mysql' ? ` · ${style[1]} Checkstyle violations` : ''}`;
    }
    const drivers = suite === 'hosted-mysql' ? [...new Set([...text.matchAll(/(HOSTED_[A-Z_]+_OK)/g)].map((m) => m[1]))] : [];
    lines.push(`[${label}] ${title.padEnd(56)} ${result}${drivers.length ? ` · drivers ${drivers.length}: ${drivers.map((d) => d.replace('HOSTED_', '').replace('_OK', '')).join(', ')}` : ''}`);
  }
}
fs.writeFileSync(path.join(RIG, 'out', 'suites.log'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
