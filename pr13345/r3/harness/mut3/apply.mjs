// usage: node apply.mjs <tree> <mutantId>   -> prints the touched files, one per line
// Fails closed: every anchor must occur exactly once, every JSON edit must
// find the shape it expects, and the file must change.
import fs from 'node:fs';
import path from 'node:path';
const { MUTANTS, JSON_FNS } = await import(process.env.MUTANTS_FILE ?? './mutants.mjs');

const [tree, id] = process.argv.slice(2);
const mutant = MUTANTS.find((m) => m.id === id);
if (!tree || !mutant) {
  console.error(`unknown mutant ${id}`);
  process.exit(2);
}
const touched = [];
for (const edit of mutant.edits ?? []) {
  const file = path.join(tree, edit.file);
  const text = fs.readFileSync(file, 'utf8');
  const count = text.split(edit.find).length - 1;
  if (count !== 1) {
    console.error(`${id}: anchor occurs ${count} times in ${edit.file}`);
    process.exit(3);
  }
  const next = text.replace(edit.find, () => edit.replace);
  if (next === text) {
    console.error(`${id}: no change in ${edit.file}`);
    process.exit(3);
  }
  fs.writeFileSync(file, next);
  touched.push(edit.file);
}
for (const edit of mutant.json ?? []) {
  const file = path.join(tree, edit.file);
  const text = fs.readFileSync(file, 'utf8');
  const value = JSON.parse(text);
  JSON_FNS[edit.fn](value);
  const next = JSON.stringify(value, null, 2) + '\n';
  if (next === text) {
    console.error(`${id}: no change in ${edit.file}`);
    process.exit(3);
  }
  fs.writeFileSync(file, next);
  touched.push(edit.file);
}
console.log([...new Set(touched)].join('\n'));
