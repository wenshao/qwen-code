// Round 10: compares head12/rest12 (edcbe0e537) with the round-9 builds,
// ignoring timing, memory and arm-name fields.
import fs from 'node:fs';
const R5 = '/Users/wenshao/pr13265-rig/r5';
const VOLATILE = /(^ms$|Ms$|^ms[A-Z]|Rss|MiB|^arm$|^completionMs$|^launcherExitMs$|^settledAfterMs$|^settledMsAfterMemberEnd$|^atMs$)/;
const load = (f) => { try { const l = fs.readFileSync(`${R5}/${f}`, 'utf8').split('\n').find((x) => x.startsWith('[RESULT]')); return l ? JSON.parse(l.slice(9)) : null; } catch { return null; } };
const diffs = (a, b, p = '') => {
  if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !VOLATILE.test(k)).flatMap((k) => diffs(a[k], b[k], `${p}.${k}`));
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${p}: now=${JSON.stringify(a)} before=${JSON.stringify(b)}`];
};
const pairs = [
  ['l1-head12', 'out75-r9b/l1-head10'], ['l13-head12', 'out75-r9b/l13-head10'], ['l14-head12', 'out75-r9b/l14-head10'],
  ['l15b-head12', 'out75-r9b/l15b-head10'], ['l19-head12', 'out75-r9b/l19-head11'], ['l20-head12', 'out75-r9b/l20-head11'],
  ['l1-rest12', 'out75-r9b/l1-fixr10'], ['l13-rest12', 'out75-r9b/l13-rest10'], ['l14-rest12', 'out75-r9b/l14-fixr10'],
  ['l15b-rest12', 'out75-r9b/l15b-fixr10'], ['l20-rest12', 'out75-r9b/l20-rest10'],
];
for (const [now, before] of pairs) {
  const a = load(`out75-r10/${now}.log`), b = load(`${before}.log`);
  if (!a || !b) { console.log(`${now}: missing`); continue; }
  const d = diffs(a, b);
  console.log(`${now} vs ${before.split('/')[1]}: ${d.length ? d.length + ' diffs' : 'identical (non-timing)'}`);
  d.slice(0, 10).forEach((x) => console.log('   ' + x.slice(0, 220)));
}
const h = load('out75-r10/l19-head12.log'), r = load('out75-r10/l19-rest12.log');
for (const [n, x] of [['head12', h], ['rest12', r]]) {
  console.log(`${n} routeTerminate`, JSON.stringify(Object.fromEntries(Object.entries(x.routeTerminate).map(([k, v]) => [k, v.answers]))));
  console.log(`${n} setsid/child terminate`, JSON.stringify([x.setsidDaemon.terminate, x.childHoldsPipes.terminate].map((t) => t.error ? 'ERROR ' + t.error.slice(0, 40) : `${t.state} ${JSON.stringify(t.evidence)}`)), 'keepCleanup', x.drain.keepCleanup, 'G5b', x.bpAfterLauncherExit.manifest.captureStatus, x.bpAfterLauncherExit.digestOk);
}
