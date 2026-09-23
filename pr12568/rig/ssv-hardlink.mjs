import fs from 'node:fs';
import path from 'node:path';
const groups = new Map();
for (const dir of ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/libexec']) {
  let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
  for (const n of names) {
    const p = path.join(dir, n);
    try { const s = fs.lstatSync(p, { bigint: true }); if (!s.isFile() || s.nlink < 2n || s.ino <= 2n ** 53n) continue; const k = `${s.dev}:${s.ino}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(p); } catch {}
  }
}
const pairs = [...groups.values()].filter((a) => a.length > 1);
console.log('hard-link groups with ino > 2^53 found:', pairs.length);
const [a, b] = pairs[0];
const ba = fs.statSync(a, { bigint: true }), bb = fs.statSync(b, { bigint: true });
console.log(JSON.stringify({ a, b, bigIno: String(ba.ino), sameIno: ba.ino === bb.ino, nlink: String(ba.nlink), numberIno: fs.statSync(a).ino, safe: Number.isSafeInteger(fs.statSync(a).ino), realpathA: fs.realpathSync.native(a), realpathB: fs.realpathSync.native(b) }));
for (const arm of ['base', 'head']) {
  const { isSameFile } = await import(`${process.env.HOME}/git/qwen-12568-${arm}/packages/cli/dist/src/commands/review/lib/same-file.js`);
  let hits = 0; for (const [x, y] of pairs.map((g) => [g[0], g[1]])) if (isSameFile(x, y)) hits++;
  console.log(`${arm}: isSameFile(${path.basename(a)}, ${path.basename(b)}) = ${isSameFile(a, b)}; across all ${pairs.length} real hard-link pairs: ${hits} recognised`);
}
