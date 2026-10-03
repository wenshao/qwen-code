// Prints, per distinguishable TS survivor, the smallest candidate (by patch
// size against the fixture template) on which head and mutant disagree.
const fs = require('fs');
const SP = process.env.SP;
const F = JSON.parse(fs.readFileSync(SP + '/wt-pr/packages/core/src/managed-runtime/contracts/managed-child-run-record-v1.fixtures.json', 'utf8'));
const T = F.templates.child_run;
const cls = JSON.parse(fs.readFileSync('ts/classification.json', 'utf8'));
const cands = fs.readFileSync(SP + '/rig/diff/head/cands.jsonl', 'utf8').trim().split('\n');
const base = fs.readFileSync(SP + '/rig/diff/head/ts.tsv', 'utf8').trim().split('\n');
const short = (v) => (v && typeof v === 'object' && v.resourceId ? `${v.resourceId}/${v.kind}${v.schemaVersion !== 1 ? '/v' + v.schemaVersion : ''}` : v);
const patch = (b) => {
  const p = {};
  for (const k of Object.keys(b)) {
    if (k === 'run') {
      const r = {};
      for (const rk of Object.keys(b.run)) if (JSON.stringify(b.run[rk]) !== JSON.stringify(T.run[rk])) r[rk] = b.run[rk];
      if (Object.keys(r).length) p.run = r;
    } else if (JSON.stringify(b[k]) !== JSON.stringify(T[k])) p[k] = short(b[k]);
  }
  return p;
};
const lines = [];
for (const c of cls) {
  if (!c.distinguishing) continue;
  const id = c.id.split(' ')[0];
  const got = fs.readFileSync(`ts/${id}.verdicts.tsv`, 'utf8').trim().split('\n');
  let best = null;
  for (let i = 0; i < got.length; i++) {
    if (got[i] === base[i]) continue;
    const o = JSON.parse(cands[i]);
    const desc = o.type === 'record' ? { record: patch(o.body) } : { before: patch(o.before), after: patch(o.after) };
    const sz = JSON.stringify(desc).length;
    if (!best || sz < best.sz) best = { sz, desc, was: base[i].split('\t').slice(1).join('|'), now: got[i].split('\t').slice(1).join('|') };
  }
  lines.push(`${c.id}  [head ${best.was} -> mutant ${best.now}]\n    ${JSON.stringify(best.desc)}`);
}
console.log(lines.join('\n'));
fs.writeFileSync('ts/minimal-examples.txt', lines.join('\n') + '\n');
