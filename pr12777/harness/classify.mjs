import fs from 'node:fs';
const ex = JSON.parse(fs.readFileSync(process.argv[2] ?? 'examples.json', 'utf8'));
const t = (r) => (r === null ? 'null' : typeof r === 'string' && r.startsWith('THROW') ? 'throw' : 'err');
const cls = (e) => [e.pattern, 'call' + e.call, 'rootId=' + /\$id: 'urn:(c\d+|fx\d):(root|d4)'/.test(e.schema), 'pre=' + t(e.pre.r), 'pr=' + t(e.pr.r)].join(' ');
for (const k of Object.keys(ex)) {
  const m = {};
  for (const e of ex[k]) m[cls(e)] = (m[cls(e)] || 0) + 1;
  console.log('==', k, ex[k].length);
  console.log(Object.entries(m).sort((a, b) => b[1] - a[1]).map(([a, b]) => `${String(b).padStart(5)}  ${a}`).join('\n'));
}
