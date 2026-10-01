// Plain normalized comparison of two dist/ trees (no string mapping): masks
// content-hash file names and the 10-char commit stamp, then diffs file multisets.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [a, b] = process.argv.slice(2);
const walk = (d, o = []) => { for (const n of readdirSync(d)) { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p, o) : o.push(p); } return o; };
const norm = (t) => t.replace(/-[A-Z0-9]{8}(\.js)/g, '-H$1').replace(/GIT_COMMIT_INFO="[0-9a-f]{10}"/g, 'GIT_COMMIT_INFO="X"');
const dig = (d) => { const m = new Map(); for (const f of walk(d)) { if (!/\.(m?js|cjs|json|html|css|md|txt)$/.test(f)) continue; const h = createHash('sha256').update(norm(readFileSync(f, 'utf8'))).digest('hex'); m.set(h, (m.get(h) ?? []).concat(path.relative(d, f))); } return m; };
const A = dig(a), B = dig(b);
let n = 0; for (const v of A.values()) n += v.length;
const onlyA = [...A].filter(([h]) => !B.has(h)).flatMap(([, v]) => v), onlyB = [...B].filter(([h]) => !A.has(h)).flatMap(([, v]) => v);
console.log(JSON.stringify({ files: n, onlyInFirst: onlyA, onlyInSecond: onlyB }));
