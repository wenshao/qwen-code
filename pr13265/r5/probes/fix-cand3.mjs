// Replaces the empty-string name check with the NUL escape at every site.
import fs from 'node:fs';
const f = process.argv[2];
const BS = String.fromCharCode(92);
let s = fs.readFileSync(f, 'utf8');
const wrong = `unitName.includes('')`;
const n = s.split(wrong).length - 1;
if (n !== 2) throw new Error(`expected 2 sites, found ${n}`);
s = s.split(wrong).join(`unitName.includes('${BS}0')`);
fs.writeFileSync(f, s);
console.log('patched', n, 'sites');
