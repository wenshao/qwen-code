import fs from 'node:fs';
function load(f) {
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  const m = s.snapshot.meta, nf = m.node_fields, nt = m.node_types[0], stride = nf.length;
  const iType = nf.indexOf('type'), iName = nf.indexOf('name'), iSize = nf.indexOf('self_size');
  const counts = new Map();
  for (let i = 0; i < s.nodes.length; i += stride) {
    const type = nt[s.nodes[i + iType]];
    let name = s.strings[s.nodes[i + iName]];
    if (type === 'string' || type === 'concatenated string' || type === 'sliced string') name = '(string)';
    if (type === 'code') name = '(code)';
    const k = `${type}:${name.slice(0, 70)}`;
    const c = counts.get(k) ?? [0, 0];
    c[0]++; c[1] += s.nodes[i + iSize];
    counts.set(k, c);
  }
  return counts;
}
const [a, b] = process.argv.slice(2, 4).map(load);
const rows = [];
for (const [k, [n, sz]] of b) {
  const [n0, sz0] = a.get(k) ?? [0, 0];
  rows.push([k, n - n0, sz - sz0]);
}
rows.sort((x, y) => y[2] - x[2]);
for (const r of rows.slice(0, Number(process.argv[4] ?? 35))) console.log(String(r[1]).padStart(8), String(r[2]).padStart(10), r[0]);
