// Compares the .75 RESULT JSON of round 9 with round 8, ignoring timing,
// memory and arm-name fields; prints every remaining differing path.
import fs from 'node:fs';
const R5 = '/Users/wenshao/pr13265-rig/r5';
const VOLATILE = /(^ms$|Ms$|^ms[A-Z]|Rss|MiB|^arm$)/;
const load = (f) => { const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.includes('RESULT')); return JSON.parse(line.slice(line.indexOf('{'))); };
const diffs = (a, b, path = '') => {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].filter((k) => !VOLATILE.test(k)).flatMap((k) => diffs(a[k], b[k], `${path}.${k}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: r9=${JSON.stringify(a)} r8=${JSON.stringify(b)}`];
};
for (const t of ['l1', 'l13', 'l14', 'l19', 'l20']) for (const a of ['head', 'rest']) {
  const d = diffs(load(`${R5}/out75-r9/${t}-${a}9.log`), load(`${R5}/out75-r8/${t}-${a}.log`));
  console.log(`${t}-${a}: ${d.length === 0 ? 'identical (non-timing)' : d.length + ' diffs'}`);
  for (const x of d.slice(0, 8)) console.log('   ' + x.slice(0, 220));
}
