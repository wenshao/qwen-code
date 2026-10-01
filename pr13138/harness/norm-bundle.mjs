// Normalized bundle comparison: chunk file names lose their content hashes, every .js file is split into statements,
// and the two multisets are compared. Prints the statements present on one side only.
import fs from 'node:fs'; import path from 'node:path';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const bag = (root) => { const m = new Map(); for (const f of walk(root).filter((x) => x.endsWith('.js'))) { const t = fs.readFileSync(f, 'utf8').replace(/([A-Za-z0-9_]+)-[A-Z0-9]{8}\.js/g, '$1-H.js'); for (const s of t.split(/;\n?|\n/)) m.set(s, (m.get(s) ?? 0) + 1); } return m; };
const [a, b] = [bag(process.argv[2]), bag(process.argv[3])];
const only = (x, y) => [...x].filter(([k, v]) => (y.get(k) ?? 0) !== v).map(([k, v]) => `${v - (y.get(k) ?? 0)}x ${k.slice(0, 160)}`);
const oa = only(a, b), ob = only(b, a);
console.log(`statements: ${[...a.values()].reduce((s, v) => s + v, 0)} vs ${[...b.values()].reduce((s, v) => s + v, 0)}; only in ${process.argv[2]}: ${oa.length}; only in ${process.argv[3]}: ${ob.length}`);
for (const l of oa.slice(0, 10)) console.log(`  - ${l}`); for (const l of ob.slice(0, 10)) console.log(`  + ${l}`);
