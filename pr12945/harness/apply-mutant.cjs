// usage: node apply-mutant.cjs <wt> <ID|none>   -- writes pristine chunk (+ mutant edits) into <wt>/dist/chunks
const fs = require('fs'); const path = require('path');
const [wt, id] = process.argv.slice(2);
const name = process.env.CHUNK || 'server-AFMNU4MZ.js';
let s = fs.readFileSync(path.join(__dirname, 'orig', (process.env.ORIG_PREFIX || '') + name), 'utf8');
if (id !== 'none') {
  const m = require(process.env.MUTANTS || './mutants.cjs')[id];
  for (const [from, to] of m.edits) {
    const i = s.indexOf(from);
    if (i < 0 || s.indexOf(from, i + from.length) >= 0) { console.error(`${id}: anchor ${i < 0 ? 'missing' : 'ambiguous'}: ${from.slice(0, 80)}`); process.exit(3); }
    s = s.slice(0, i) + to + s.slice(i + from.length);
  }
  s = s + `\n;globalThis.__pr12945_mutant=${JSON.stringify(id)};\n`;
}
fs.writeFileSync(path.join(wt, 'dist', 'chunks', name), s);
console.log(`${id} applied`);
