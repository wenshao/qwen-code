import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const SHAS = ['468cb46644c297c584f75c4118455bb83a696021', '6c02a8f3c2a9cfca6fa01f3991137cf5c91098d8'];
const norm = (s) => { for (const sha of SHAS) { s = s.split(sha).join('<SHA>'); for (const n of [7,8,9,10,11,12]) s = s.split(sha.slice(0, n)).join('<SHA>'); } return s.replace(/([A-Za-z0-9_]+)-[A-Z0-9]{8}(\.js)/g, '$1-<H>$2'); };
const load = (d) => new Map(fs.readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => { const n = norm(fs.readFileSync(path.join(d, f), 'utf8')); return [crypto.createHash('sha256').update(n).digest('hex'), { f, n }]; }));
const [a, b] = process.argv.slice(2).map(load);
const onlyA = [...a.keys()].filter((h) => !b.has(h)), onlyB = [...b.keys()].filter((h) => !a.has(h));
for (const h of onlyA) console.log('only r3:', a.get(h).f, a.get(h).n.length);
for (const h of onlyB) console.log('only r4:', b.get(h).f, b.get(h).n.length);
if (onlyA.length === 1 && onlyB.length === 1) { const x = a.get(onlyA[0]).n, y = b.get(onlyB[0]).n; let i = 0; while (x[i] === y[i]) i++; let j = 0; while (x[x.length-1-j] === y[y.length-1-j]) j++; console.log('r3 segment:', JSON.stringify(x.slice(Math.max(0,i-80), x.length-j+40))); console.log('r4 segment:', JSON.stringify(y.slice(Math.max(0,i-80), y.length-j+40))); }
