// Consolidate round-3 mutation verdicts (P = new code of fee8f8763d; M = round-1 mutants whose code moved).
import fs from 'node:fs';
import { MUTANTS } from './mutants.mjs';
const OUT = '/rig/out';
const verdict = {};
for (const f of ['mut-r3a.log', 'mut-r3b.log', 'mut-r3c.log'])
  for (const l of fs.readFileSync(`${OUT}/${f}`, 'utf8').split('\n')) {
    const m = l.match(/^([PM]\d+) (KILLED|SURVIVED)(.*)$/);
    if (m) verdict[m[1]] = { v: m[2], rest: m[3] };
  }
const recheck = {};
for (const l of fs.readFileSync(`${OUT}/mut-r3-recheck.log`, 'utf8').split('\n')) {
  const m = l.match(/^([PM]\d+) .*=> (KILLED|SURVIVED)/);
  if (m) recheck[m[1]] = m[2];
}
const rows = [];
for (const [id, file, , , note] of MUTANTS.filter(([id]) => verdict[id])) {
  const { v, rest } = verdict[id];
  const by = v === 'KILLED' ? '  <- ' + rest.replace(/^ by \d+ test\(s\): /, '').split(' | ')[0].replace(/ \d+ms.*$/, '').slice(0, 90) : '';
  rows.push(`${id.padEnd(4)} ${v.padEnd(8)} ${file.split('/').pop().padEnd(36)} ${note}${recheck[id] ? ` (case-level recheck: ${recheck[id]})` : ''}${by}`);
}
const k = rows.filter((r) => / KILLED /.test(r.slice(0, 14))).length;
const out = [...rows, '', `TOTAL ${rows.length}: killed ${k}, survived ${rows.length - k}`].join('\n');
fs.writeFileSync(`${OUT}/mutation-r3-final.txt`, out + '\n');
console.log(out);
