// Every call where the PR differs from the validator before the compile cache: what kind is it?
import fs from 'node:fs';
const t = (r) => (r === null ? 'null' : typeof r === 'string' && r.startsWith('THROW') ? 'throw' : 'error');
const kinds = {}; const samples = {};
for (const S of process.argv.slice(2)) {
  const ex = JSON.parse(fs.readFileSync(`examples-${S}.json`, 'utf8'));
  for (const e of ex['result+log/prEqMainNePre'] ?? []) {
    const rootId = /\$id: 'urn:(c\d+|fx\d):root'/.test(e.schema);
    const newObj = e.pattern === 'rebuilt' ? e.call > 0 : e.pattern === 'mixed' ? e.call === 1 || e.call === 3 : e.pattern === 'idHeld' ? e.call === 3 : false;
    const logPre = e.pre.logs.map((l) => l.replace(/urn:[^"]+/, 'ID').slice(0, 90)).join('|');
    const logPr = e.pr.logs.map((l) => l.replace(/urn:[^"]+/, 'ID').slice(0, 90)).join('|');
    const k = `newObject=${newObj} rootId=${rootId} pre=${t(e.pre.r)} pr=${t(e.pr.r)} preLog=[${logPre}] prLog=[${logPr}]`;
    kinds[k] = (kinds[k] || 0) + 1; (samples[k] ??= e);
  }
}
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
