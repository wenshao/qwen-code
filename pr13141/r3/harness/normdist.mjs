// Normalized multiset comparison of two dist/ trees: chunk content-hash names,
// commit ids and build stamps are masked; the PR's two help strings are mapped
// back to the base text. Prints any file whose normalized content differs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [baseDir, prDir, baseSha, prSha] = process.argv.slice(2);
const OLD_URL = 'Reserved Broker URL for --profile hosted-harness; not implemented and rejects startup.';
const NEW_URL = 'Private Broker URL for --profile hosted-harness; required together with token for Workspace tool turns.';
const OLD_TOK = 'Reserved Broker credential for --profile hosted-harness; not implemented and rejects startup.';
const NEW_TOK = 'Private Broker credential for --profile hosted-harness; required together with URL for Workspace tool turns.';
function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
function norm(file, text, mapPr) {
  let t = text
    .replace(/-[A-Z0-9]{8}(\.js)/g, "-H$1")
    .replaceAll(baseSha, 'SHA').replaceAll(prSha, 'SHA')
    .replaceAll(baseSha.slice(0, 7), 'SHA7').replaceAll(prSha.slice(0, 7), 'SHA7')
    .replaceAll(baseSha.slice(0, 8), 'SHA8').replaceAll(prSha.slice(0, 8), 'SHA8')
    .replaceAll(baseSha.slice(0, 10), 'SHA10').replaceAll(prSha.slice(0, 10), 'SHA10');
  if (mapPr) t = t.replaceAll(NEW_URL, OLD_URL).replaceAll(NEW_TOK, OLD_TOK);
  return t;
}
function digest(dir, mapPr) {
  const m = new Map();
  let hits = 0;
  for (const f of walk(dir)) {
    if (!/\.(m?js|cjs|json|html|css|md|txt)$/.test(f)) continue;
    const raw = readFileSync(f, 'utf8');
    if (mapPr) hits += raw.split(NEW_URL).length - 1 + raw.split(NEW_TOK).length - 1;
    const rel = path.relative(dir, f).replace(/-[A-Z0-9]{8}(\.js)/g, "-H$1");
    const h = createHash('sha256').update(norm(f, raw, mapPr)).digest('hex');
    m.set(h, (m.get(h) ?? []).concat(rel));
  }
  return { m, hits };
}
const a = digest(baseDir, false), b = digest(prDir, true);
let onlyA = [], onlyB = [], files = 0;
for (const [h, v] of a.m) { files += v.length; if (!b.m.has(h)) onlyA.push(...v); }
for (const [h, v] of b.m) if (!a.m.has(h)) onlyB.push(...v);
console.log(JSON.stringify({ baseFiles: files, prStringHits: b.hits, onlyInBase: onlyA, onlyInPr: onlyB }, null, 1));
