// Applies the surviving Java mutants together in wt-jmut and reports what changed.
import fs from 'node:fs';
import path from 'node:path';
import { mutants } from './mutants.mjs';
const SP = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const WT = path.join(SP, 'wt-jmut');
for (const id of process.argv[2].split(',')) {
  const m = mutants.find((x) => x.id === id);
  const file = path.join(WT, m.file);
  const source = fs.readFileSync(file, 'utf8');
  if (source.split(m.find).length !== 2) throw new Error(`${id}: anchor not unique`);
  fs.writeFileSync(file, source.replace(m.find, m.replace));
  console.log(`applied ${id}: ${m.what}`);
}
