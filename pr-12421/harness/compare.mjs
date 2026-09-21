import { execFileSync } from 'node:child_process';
const get = (t) => JSON.parse(execFileSync('node', ['extract.mjs', t, '--json'], { cwd: '/root/verify/pr12421-harness' }).toString());
let diffs = 0, total = 0;
const summary = {};
for (const arm of ['base', 'pr']) for (const scn of ['notebook', 'text', 'text-omitted-first', 'pdf']) {
  const [c, r, a] = ['chat', 'responses', 'anthropic'].map((p) => get(`${arm}-${p}-${scn}`));
  for (let i = 0; i < c.rows.length; i++) {
    total++;
    const key = (x) => JSON.stringify([x.args, x.is_error, x.output.replace(/call_\w+/g, '')]);
    if (key(c.rows[i]) !== key(r.rows[i]) || key(c.rows[i]) !== key(a.rows[i])) { diffs++; console.log('DIFF', arm, scn, c.rows[i].step); }
    summary[`${arm}:${c.rows[i].step}`] = c.rows[i].is_error ? 'ERR' : 'OK';
  }
  if (c.rows.length !== r.rows.length || c.rows.length !== a.rows.length) console.log('ROWCOUNT DIFF', arm, scn);
}
console.log(`cross-protocol identical rows: ${total - diffs}/${total}`);
const steps = [...new Set(Object.keys(summary).map((k) => k.split(':')[1]))];
let changed = 0;
for (const s of steps) { const b = summary[`base:${s}`], p = summary[`pr:${s}`]; if (b !== p) changed++; console.log(`${s.padEnd(34)} base=${b} pr=${p}${b !== p ? '  <-- changed' : ''}`); }
console.log(`steps: ${steps.length}, verdict changed: ${changed}`);
