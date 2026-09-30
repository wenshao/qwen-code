// Consolidate mutation verdicts (first pass + isolated rechecks) into out/mutation-final.txt.
import fs from 'node:fs';
import { MUTANTS } from './mutants.mjs';
const O = '/rig/out/';
const lines = ['mut-a.log', 'mut-b.log', 'mut-c-first.log', 'mut-d.log'].flatMap((f) => fs.readFileSync(O + f, 'utf8').split('\n')).filter((l) => /^(M|C)\d+ /.test(l));
const by = {};
for (const l of lines) (by[l.split(' ')[0]] ??= []).push(l);
const re1 = Object.fromEntries(fs.readFileSync(O + 'mut-recheck.log', 'utf8').split('\n').filter((l) => /^M\d+ /.test(l)).map((l) => [l.split(' ')[0], /=> KILLED/.test(l) ? 'KILLED' : 'SURVIVED']));
const re2 = Object.fromEntries(fs.readFileSync(O + 'mut-recheck2.log', 'utf8').split('\n').filter((l) => /^M\d+ /.test(l)).map((l) => [l.split(' ')[0], l.split('=> ')[1]]));
const out = [];
let k = 0, s = 0;
for (const [id, file, , , note] of MUTANTS) {
  const first = by[id]?.[0] ?? '';
  let verdict = / KILLED /.test(first) ? 'KILLED' : / SURVIVED /.test(first) ? 'SURVIVED' : 'MISSING';
  let how = '';
  const killer = (first.match(/KILLED by \d+ test\(s\): (.*?)(?: \d+ms| \||  \[)/) ?? [])[1] ?? '';
  if (re1[id]) { verdict = re1[id]; how = ' (first pass: "killed" by an unrelated load-sensitive test; alone, no test failed in both of two runs)'; }
  if (re2[id]) { verdict = re2[id]; how = ' (confirmed: the killing test fails alone, twice)'; }
  if (id === 'M36') how = ' (equivalent: lstat never reports a symlink as a file or a directory, so the type check refuses it anyway)';
  verdict === 'KILLED' ? k++ : s++;
  out.push(`${id} ${verdict.padEnd(8)} ${file.split('/').pop().padEnd(40)} ${note}${verdict === 'KILLED' && killer ? '  <- ' + killer.slice(0, 80) : ''}${how}`);
}
out.push('', `TOTAL ${MUTANTS.length}: killed ${k}, survived ${s}`);
fs.writeFileSync(O + 'mutation-final.txt', out.join('\n') + '\n');
console.log(out.at(-1));
console.log(out.filter((l) => /SURVIVED|MISSING/.test(l)).map((l) => l.slice(0, 140)).join('\n'));
