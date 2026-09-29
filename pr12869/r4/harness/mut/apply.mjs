// usage: node apply.mjs <tree> <id|--check>
import fs from 'node:fs';
import { MUTANTS } from './mutants.mjs';
const [tree, which] = process.argv.slice(2);
let bad = 0;
for (const m of MUTANTS) {
  if (which !== '--check' && m.id !== which) continue;
  const p = `${tree}/${m.file}`; const s = fs.readFileSync(p, 'utf8');
  const n = s.split(m.find).length - 1;
  if (n !== 1) { console.log(`${m.id}: anchor matched ${n} times in ${m.file}`); bad++; continue; }
  if (which === '--check') { console.log(`${m.id}: ok  ${m.what}`); continue; }
  fs.writeFileSync(p, s.replace(m.find, m.replace));
  console.log(`${m.id} applied: ${m.what}`);
}
process.exit(bad ? 1 : 0);
