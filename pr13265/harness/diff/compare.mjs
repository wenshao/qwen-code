// Compares TS and Java verdicts line by line and groups disagreements.
import fs from 'node:fs';
const dir = process.argv[2];
const ts = fs.readFileSync(`${dir}/ts.tsv`, 'utf8').trim().split('\n');
const java = fs.readFileSync(`${dir}/java.tsv`, 'utf8').trim().split('\n');
const cands = fs.readFileSync(`${dir}/cands.jsonl`, 'utf8').trim().split('\n');
if (ts.length !== java.length || ts.length !== cands.length) { console.log('LENGTH MISMATCH', ts.length, java.length, cands.length); process.exit(2); }
const stats = { record: 0, succ: 0, recOkBoth: 0, recInvalidBoth: 0, startTrue: 0, succTrue: 0, crashTs: 0, crashJava: 0 };
const groups = new Map();
for (let i = 0; i < ts.length; i++) {
  const c = JSON.parse(cands[i]);
  const a = ts[i].split('\t'); const b = java[i].split('\t');
  if (a[0] !== String(c.id) || b[0] !== String(c.id)) { console.log('ID MISMATCH', i); process.exit(2); }
  stats[c.type]++;
  if (a.slice(1).some((x) => x.startsWith('crash'))) stats.crashTs++;
  if (b.slice(1).some((x) => x.startsWith('crash'))) stats.crashJava++;
  if (c.type === 'record') { if (a[1] === 'ok' && b[1] === 'ok') stats.recOkBoth++; if (a[1] === 'invalid' && b[1] === 'invalid') stats.recInvalidBoth++; if (a[2] === 'true') stats.startTrue++; }
  else if (a[1] === 'true') stats.succTrue++;
  if (a.slice(1).join('|') !== b.slice(1).join('|')) {
    const key = `${c.type} ts=${a.slice(1).join('|')} java=${b.slice(1).join('|')}`;
    const g = groups.get(key) ?? { n: 0, ex: [] };
    g.n++; if (g.ex.length < 3) g.ex.push(c); groups.set(key, g);
  }
}
console.log(JSON.stringify(stats));
let total = 0;
for (const [k, g] of groups) { total += g.n; console.log(`DISAGREE ${g.n}  ${k}`); for (const e of g.ex) console.log('   ex', JSON.stringify(e).slice(0, 900)); }
console.log(`TOTAL_DISAGREE ${total}`);
