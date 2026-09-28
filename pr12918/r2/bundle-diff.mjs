import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const [a, b] = process.argv.slice(2);
const norm = (s) => s.replace(/(chunk|[A-Za-z]+)-[A-Z0-9]{8}\.js/g, '$1-X.js').replace(/"GIT_COMMIT_INFO":\s*"[^"]*"|GIT_COMMIT_INFO\s*=\s*"[^"]*"/g, 'GCI');
function scan(root) {
  const m = new Map();
  for (const f of fs.readdirSync(path.join(root, 'dist/chunks')).filter((x) => x.endsWith('.js'))) {
    const t = norm(fs.readFileSync(path.join(root, 'dist/chunks', f), 'utf8'));
    const h = crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
    m.set(h, [...(m.get(h) ?? []), f]);
  }
  return m;
}
const A = scan(a), B = scan(b);
const onlyA = [...A.keys()].filter((k) => !B.has(k)).flatMap((k) => A.get(k));
const onlyB = [...B.keys()].filter((k) => !A.has(k)).flatMap((k) => B.get(k));
console.log(JSON.stringify({ chunksA: [...A.values()].flat().length, chunksB: [...B.values()].flat().length, onlyA, onlyB }));
