// Compares the final-head .75 results (head10/rest10, out75-r9b) with the
// 4b339c9140 ones (head9/rest9, out75-r9), ignoring timing, memory and
// arm-name fields; prints every remaining differing path.
import fs from 'node:fs';
const R5 = '/Users/wenshao/pr13265-rig/r5';
const VOLATILE = /(^ms$|Ms$|^ms[A-Z]|Rss|MiB|^arm$)/;
const load = (f) => { const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('[RESULT]')); return line ? JSON.parse(line.slice(9)) : null; };
const diffs = (a, b, path = '') => {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].filter((k) => !VOLATILE.test(k)).flatMap((k) => diffs(a[k], b[k], `${path}.${k}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: final=${JSON.stringify(a)} r9=${JSON.stringify(b)}`];
};
for (const t of ['l1', 'l13', 'l14', 'l19', 'l20']) for (const [a9, a10] of [['head9', 'head10'], ['rest9', 'rest10']]) {
  const now = load(`${R5}/out75-r9b/${t}-${a10}.log`), before = load(`${R5}/out75-r9/${t}-${a9}.log`);
  if (!now || !before) { console.log(`${t}-${a10}: missing ${!now ? 'final' : 'r9'} result`); continue; }
  const d = diffs(now, before);
  console.log(`${t}-${a10} vs ${a9}: ${d.length === 0 ? 'identical (non-timing)' : d.length + ' diffs'}`);
  for (const x of d.slice(0, 14)) console.log('   ' + x.slice(0, 230));
}
