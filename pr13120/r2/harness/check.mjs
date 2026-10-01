import { execFileSync } from 'node:child_process';
import { MUTANTS } from './mutants.mjs';
const WT = process.argv[2];
let bad = 0;
for (const m of MUTANTS) {
  const src = execFileSync('git', ['-C', WT, 'show', `HEAD:${m.file}`], { encoding: 'utf8' });
  const n = src.split(m.find).length - 1;
  if (n !== 1) { bad++; console.log(`${m.id} occurs ${n}`); }
}
console.log(`${MUTANTS.length} mutants, ${bad} bad`);
