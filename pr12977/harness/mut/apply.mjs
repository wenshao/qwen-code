// usage: node apply.mjs <treeDir> <id|BASE>
import fs from 'node:fs'; import { mutants } from './mutants.mjs';
const [tree, id] = process.argv.slice(2);
if (id === 'BASE') process.exit(0);
const m = mutants.find((x) => x.id === id); const f = `${tree}/${m.file}`;
const s = fs.readFileSync(f, 'utf8'); const n = s.split(m.from).length - 1;
if (n !== 1) { console.error(`${id}: anchor found ${n} times`); process.exit(2); }
fs.writeFileSync(f, s.replace(m.from, m.to)); console.log(`${id} applied: ${m.what}`);
