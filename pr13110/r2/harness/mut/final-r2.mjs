// Consolidate round-2 mutation verdicts into out/mutation-r2-final.txt (first pass + targeted rechecks).
import fs from 'node:fs';
import { MUTANTS } from './mutants.mjs';
const O = '/rig/out/';
const lines = ['mut-r2a.log', 'mut-r2b.log', 'mut-r2c.log', 'mut-r2d.log'].flatMap((f) => (fs.existsSync(O + f) ? fs.readFileSync(O + f, 'utf8').split('\n') : [])).filter((l) => /^(M|N|C)\d+ /.test(l));
const by = Object.fromEntries(lines.map((l) => [l.split(' ')[0], l]));
const re = fs.existsSync(O + 'mut-r2-recheck.log') ? Object.fromEntries(fs.readFileSync(O + 'mut-r2-recheck.log', 'utf8').split('\n').filter((l) => /^(M|N)\d+ /.test(l)).map((l) => [l.split(' ')[0], l.split('=> ')[1]])) : {};
const r1 = Object.fromEntries(fs.readFileSync(O + 'mutation-final.txt', 'utf8').split('\n').filter((l) => /^(M|C)\d+ /.test(l)).map((l) => [l.split(' ')[0], l.split(/\s+/)[1]]));
const out = [];
let k = 0, s = 0;
for (const [id, file, , , note] of MUTANTS) {
  const l = by[id];
  if (!l) continue;
  let verdict = / KILLED /.test(l) ? 'KILLED' : 'SURVIVED';
  let how = '';
  const killer = (l.match(/KILLED by \d+ test\(s\): (.*?)(?: \d+ms| \||  \[)/) ?? [])[1] ?? '';
  if (re[id]) { verdict = re[id].startsWith('KILLED') ? 'KILLED' : 'SURVIVED'; how = ` (recheck: ${re[id]})`; }
  if (id === 'M36') how = ' (equivalent)';
  verdict === 'KILLED' ? k++ : s++;
  const was = r1[id] ? ` [round 1: ${r1[id]}]` : ' [new]';
  out.push(`${id} ${verdict.padEnd(8)} ${file.split('/').pop().padEnd(38)} ${note}${was}${verdict === 'KILLED' && killer ? '  <- ' + killer.slice(0, 70) : ''}${how}`);
}
out.push('', `TOTAL ${k + s}: killed ${k}, survived ${s}`);
fs.writeFileSync(O + 'mutation-r2-final.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
