// Combined numbers of the two seeds, for the report and the evidence cards.
import fs from 'node:fs';
const seeds = ['12777', '424242'];
const t = (r) => (r === null ? 'null' : typeof r === 'string' && r.startsWith('THROW') ? 'throw' : 'error');
const sum = { cases: 0, views: {}, mainDev: {}, prVsPre: {} };
for (const S of seeds) {
  sum.cases += JSON.parse(fs.readFileSync(`cases-${S}.json`, 'utf8')).length;
  const ex = JSON.parse(fs.readFileSync(`examples-${S}.json`, 'utf8'));
  for (const e of ex['result/prEqPreNeMain'] ?? []) {
    const k = e.main.r === null ? 'main accepted, pre-cache and PR reject' : e.pr.r === null ? 'main rejected, pre-cache and PR skip (rebuilt exotic $id schema, first use)' : 'different rejection message';
    sum.mainDev[k] = (sum.mainDev[k] || 0) + 1;
  }
  for (const e of ex['result+log/prEqMainNePre'] ?? []) {
    const newObj = e.pattern === 'rebuilt' ? e.call > 0 : e.pattern === 'mixed' ? e.call === 1 || e.call === 3 : e.pattern === 'idHeld' ? e.call === 3 : false;
    const rootId = /\$id: 'urn:(c\d+|fx\d):(root|d4)'/.test(e.schema);
    const k = newObj && rootId && e.pre.r === null && /already exists/.test(e.pre.logs.join()) && e.pr.logs.length === 0 ? 'rebuilt object of a compiling $id schema: pre-cache skipped it as a duplicate $id, PR (and main) validate it' : 'OTHER';
    sum.prVsPre[k] = (sum.prVsPre[k] || 0) + 1;
  }
}
// re-run compare for the views
import { execFileSync } from 'node:child_process';
for (const S of seeds) {
  for (const n of ['precache', 'main', 'pr']) fs.copyFileSync(`seed-${S}/out-${n}.jsonl`, `out-${n}.jsonl`);
  const out = execFileSync(process.execPath, ['compare.mjs', `cases-${S}.json`, `/dev/null`], { encoding: 'utf8' });
  const j = JSON.parse(out.slice(0, out.lastIndexOf('}') + 1));
  for (const [v, k] of Object.entries(j)) { sum.views[v] ??= {}; for (const [a, b] of Object.entries(k)) sum.views[v][a] = (sum.views[v][a] || 0) + b; }
}
console.log(JSON.stringify(sum, null, 1));
fs.writeFileSync('summary.json', JSON.stringify(sum, null, 1));
