// apply one round-2 mutant (by id) to src-mut in place
import fs from 'node:fs';
const src = fs.readFileSync('/Users/wenshao/pr13973-rig/mut/mutate-r2.mjs', 'utf8');
const id = process.argv[2];
const M0 = eval(src.slice(src.indexOf('const M0 = [') + 'const M0 = '.length, src.indexOf('];', src.indexOf('const M0 = [')) + 1));
const m = M0.find(([n]) => n.split(' ')[0] === id);
if (!m) { console.error('no mutant', id); process.exit(1); }
const p = `/Users/wenshao/pr13973-rig/src-mut/packages/web-shell/client/${m[1]}`;
const orig = fs.readFileSync(p, 'utf8');
if (orig.split(m[2]).length !== 2) { console.error('pattern count', orig.split(m[2]).length - 1); process.exit(1); }
fs.writeFileSync(p, orig.replace(m[2], m[3]));
console.log('applied', m[0]);
