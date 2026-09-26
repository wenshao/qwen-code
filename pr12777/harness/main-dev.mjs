// How main deviates where the PR restores pre-cache behavior (result view), by kind.
import fs from 'node:fs';
const ex = JSON.parse(fs.readFileSync('examples.json', 'utf8'));
const t = (r) => (r === null ? 'null(skipped)' : typeof r === 'string' && r.startsWith('THROW') ? 'throw' : 'error');
const m = {}; const sample = {};
for (const e of ex['result/prEqPreNeMain']) {
  const k = `main=${t(e.main.r)} pre/pr=${t(e.pr.r)}`;
  m[k] = (m[k] || 0) + 1; (sample[k] ??= []).push(e);
}
console.log(m);
for (const [k, v] of Object.entries(sample)) {
  console.log('\n###', k);
  for (const e of v.slice(0, 2)) console.log(e.id, e.pattern, e.call, '\n  schema:', e.schema.slice(0, 400), '\n  main:', JSON.stringify(e.main.r)?.slice(0, 160), '\n  pr  :', JSON.stringify(e.pr.r)?.slice(0, 160));
}
// console differences
const c = ex['console/prEqPreNeMain'];
const cm = {};
for (const e of c) { const k = JSON.stringify([e.main.cons.map((x) => x.slice(0, 60)), e.pr.cons.map((x) => x.slice(0, 60))]); cm[k] = (cm[k] || 0) + 1; }
console.log('\n### console differences (main vs pr/pre)');
console.log(Object.entries(cm).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => v + ' ' + k).join('\n'));
