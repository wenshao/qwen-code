import fs from 'node:fs';
import path from 'node:path';
const dir = '/usr/lib';
const byNum = new Map();
for (const n of fs.readdirSync(dir)) {
  const p = path.join(dir, n);
  try { const s = fs.statSync(p); if (!s.isFile()) continue; const k = `${s.dev}:${s.ino}`; (byNum.get(k) ?? byNum.set(k, []).get(k)).push(p); } catch {}
}
const pair = [...byNum.values()].find((a) => a.length > 1);
const [a, b] = pair;
const bigA = fs.statSync(a, { bigint: true }), bigB = fs.statSync(b, { bigint: true });
console.log(JSON.stringify({ a, b, numberInoA: fs.statSync(a).ino, numberInoB: fs.statSync(b).ino, bigA: String(bigA.ino), bigB: String(bigB.ino), sameBytes: fs.readFileSync(a).equals(fs.readFileSync(b)) }));
for (const arm of ['base', 'head']) {
  const { isSameFile } = await import(`${process.env.HOME}/git/qwen-12568-${arm}/packages/cli/dist/src/commands/review/lib/same-file.js`);
  console.log(arm, 'isSameFile(distinct, colliding)=', isSameFile(a, b), ' isSameFile(a, a-via-..)=', isSameFile(a, path.join(dir, 'x', '..', path.basename(a))));
}
