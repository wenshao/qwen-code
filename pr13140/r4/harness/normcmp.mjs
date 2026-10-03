// Compare two unpacked npm packages after normalizing esbuild content-hash names and embedded commit SHAs.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const [a, b] = process.argv.slice(2);
const SHAS = ['468cb46644c297c584f75c4118455bb83a696021', '6c02a8f3c2a9cfca6fa01f3991137cf5c91098d8'];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const norm = (buf, rel) => {
  if (!/\.(js|mjs|cjs|json|map|txt|md)$/.test(rel)) return buf;
  let s = buf.toString('utf8');
  for (const sha of SHAS) { s = s.split(sha).join('<SHA>'); for (const n of [7, 8, 9, 10, 11, 12]) s = s.split(sha.slice(0, n)).join('<SHA>'); }
  return Buffer.from(s.replace(/([A-Za-z0-9_]+)-[A-Z0-9]{8}(\.js)/g, '$1-<H>$2'));
};
const index = (root) => { const m = new Map(); for (const f of walk(root)) { const rel = path.relative(root, f).replace(/([A-Za-z0-9_]+)-[A-Z0-9]{8}(\.js)/g, '$1-<H>$2'); const h = crypto.createHash('sha256').update(norm(fs.readFileSync(f), rel)).digest('hex'); m.set(rel, [...(m.get(rel) ?? []), h].sort()); } return m; };
const A = index(a), B = index(b); let diff = 0; const rows = [];
for (const k of new Set([...A.keys(), ...B.keys()])) { const x = JSON.stringify(A.get(k)), y = JSON.stringify(B.get(k)); if (x !== y) { diff++; if (rows.length < 12) rows.push(k + (A.has(k) ? '' : ' (only r4)') + (B.has(k) ? '' : ' (only r3)')); } }
console.log(JSON.stringify({ filesR3: [...A.values()].flat().length, filesR4: [...B.values()].flat().length, differingPaths: diff, sample: rows }));
