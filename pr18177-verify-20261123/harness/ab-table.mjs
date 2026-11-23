// Render the two arms' ROW lines side by side for the evidence capture.
import { readFileSync } from 'node:fs';

const [basePath, headPath] = process.argv.slice(2);
const parse = (path) => {
  const rows = new Map();
  for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
    const m = /^ROW (\S+) arm=\S+\s*(.*)$/u.exec(line.trim());
    if (m) rows.set(m[1], m[2]);
  }
  return rows;
};
const base = parse(basePath);
const head = parse(headPath);
const names = [...new Set([...base.keys(), ...head.keys()])];
const width = Math.max(28, ...names.map((n) => n.length));
console.log('VERIFY-18177  admission retry A/B  (same driver, two arms)');
console.log('');
console.log(
  'row'.padEnd(width) + ' | ' + 'base'.padEnd(46) + ' | head',
);
console.log('-'.repeat(width) + '-+-' + '-'.repeat(46) + '-+-' + '-'.repeat(52));
for (const name of names) {
  console.log(
    name.padEnd(width) +
      ' | ' +
      (base.get(name) ?? '<missing>').padEnd(46) +
      ' | ' +
      (head.get(name) ?? '<missing>'),
  );
}
console.log('');
console.log(
  'gaps are fake-timer timestamps: base has one attempt, head retries at +400/+1200 ms',
);
console.log(
  'serverTurns is the daemon-ring model measured live by wire-dedup-probe.mjs',
);