// node mutate.cjs <root-for-ts> <root-for-java> <id|check|restore>
const fs = require('fs'), path = require('path');
const [tsRoot, javaRoot, id] = process.argv.slice(2);
const mutants = require(process.env.MUTANTS ?? './mutants.cjs');
const where = (m) => m.group === 'ts' ? path.join(tsRoot, m.file) : path.join(javaRoot, m.file.replace('packages/sdk-java/', ''));
if (id === 'check') {
  for (const m of mutants) { const t = fs.readFileSync(where(m), 'utf8'); const n = t.split(m.find).length - 1; console.log(m.id, n === 1 ? 'ok' : `COUNT=${n}`); }
  process.exit(0);
}
const m = mutants.find((x) => x.id === id);
const file = where(m);
if (process.argv[5] === 'restore') { fs.copyFileSync(file + '.orig', file); fs.unlinkSync(file + '.orig'); process.exit(0); }
const t = fs.readFileSync(file, 'utf8');
if (t.split(m.find).length - 1 !== 1) { console.error('find not unique'); process.exit(2); }
fs.copyFileSync(file, file + '.orig');
fs.writeFileSync(file, t.replace(m.find, m.replace));
console.log(`${m.group} ${file}`);
