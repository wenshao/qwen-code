// Multiset comparison of normalised bundle files: esbuild content-hash chunk
// names and the embedded commit SHA are replaced before hashing each file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [A, B] = process.argv.slice(2);
const SHAS = /1c62df93c9cf528e9db92ff6f408103f75de76a7|3f282a9fc10d49403f42d809bfbb083ef69b79af|\b1c62df93c9?\b|\b3f282a9fc1?\b|\b1c62df9\b|\b3f282a9\b/g;
const norm = (s) => s.replace(/([A-Za-z0-9_$.]+)-[A-Z0-9]{8}(\.(?:js|css|map|mjs))/g, '$1-HASH$2').replace(SHAS, 'SHA');
const collect = (root) => {
  const m = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = norm(path.relative(root, p));
      const h = crypto.createHash('sha256').update(norm(fs.readFileSync(p).toString('latin1'))).digest('hex');
      const k = `${rel} ${h}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  };
  walk(root);
  return m;
};
const a = collect(A), b = collect(B);
const onlyA = [...a.keys()].filter((k) => a.get(k) !== b.get(k));
const onlyB = [...b.keys()].filter((k) => a.get(k) !== b.get(k));
console.log(JSON.stringify({ normalisedEntries: [...a.values()].reduce((x, y) => x + y, 0), mismatchedOld: onlyA.map((k) => k.split(' ')[0]).slice(0, 10), mismatchedNew: onlyB.map((k) => k.split(' ')[0]).slice(0, 10), identical: onlyA.length === 0 && onlyB.length === 0 }, null, 1));
