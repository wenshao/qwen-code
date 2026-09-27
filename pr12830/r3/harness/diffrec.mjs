import { readFileSync } from 'node:fs';
const [a, b, ...labels] = process.argv.slice(2);
const A = JSON.parse(readFileSync(a, 'utf8')).log, B = JSON.parse(readFileSync(b, 'utf8')).log;
const idre = /^[0-9a-f-]{36}$|^(turn|evt)_[0-9a-f]{32}$|^tenant-/;
function walk(x, y, p, out) {
  if (typeof x !== typeof y || Array.isArray(x) !== Array.isArray(y)) { out.push(`${p}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`); return; }
  if (x && typeof x === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '/' + k, out); return; }
  if (x === y) return;
  if (typeof x === 'string' && idre.test(x) && idre.test(y)) return;
  if (/(_at|At)$/.test(p)) return;
  out.push(`${p}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
}
for (const l of labels) { const x = A.find((r) => r.label === l), y = B.find((r) => r.label === l); const out = []; walk(x.json, y.json, '', out); console.log(`[${l}]`, out.slice(0, 6).join(' | ') || 'same'); }
