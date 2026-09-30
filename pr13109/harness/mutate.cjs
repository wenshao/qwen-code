// mutate.cjs <tree> <orig-tree> <id|restore>  -- restore the four files, then apply one mutant
const fs = require('fs');
const path = require('path');
const [tree, orig, id] = process.argv.slice(2);
const mutants = require('./mutants.cjs');
for (const file of new Set(mutants.map((m) => m.file)))
  fs.copyFileSync(path.join(orig, file), path.join(tree, file));
if (id === 'restore') process.exit(0);
const m = mutants.find((x) => x.id === id);
if (!m) throw new Error('no mutant ' + id);
const p = path.join(tree, m.file);
const text = fs.readFileSync(p, 'utf8');
const count = text.split(m.find).length - 1;
if (count !== 1) throw new Error(`${id}: find occurs ${count} times`);
fs.writeFileSync(p, text.replace(m.find, m.replace));
console.log(`${id} applied: ${m.what}`);
