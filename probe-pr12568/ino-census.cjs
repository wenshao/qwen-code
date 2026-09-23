// Census of real file ids on a volume: how many exceed 2^53, and how many
// DISTINCT files collide once the id is read as a number-backed Stats.ino.
const fs = require('node:fs');
const path = require('node:path');
const [dir, label] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const LIM = 2n ** 53n;
const seen = [];
for (let i = 0; i < 300; i++) {
  const f = path.join(dir, `f${i}`);
  fs.writeFileSync(f, String(i));
  seen.push(f);
}
for (let i = 0; i < 100; i++) {
  const d = path.join(dir, `d${i}`);
  fs.mkdirSync(d, { recursive: true });
  seen.push(d);
}
const sys = process.platform === 'win32' ? 'C:/Windows/System32' : '/usr/lib';
let sysFiles = [];
try { sysFiles = fs.readdirSync(sys).slice(0, 300).map((n) => path.join(sys, n)); } catch {}
function census(paths) {
  let over = 0, max = 0n, min = null, safeFalse = 0;
  const buckets = new Map();
  for (const p of paths) {
    let b, n;
    try { b = fs.statSync(p, { bigint: true }); n = fs.statSync(p); } catch { continue; }
    if (b.ino > LIM) over++;
    if (!Number.isSafeInteger(n.ino)) safeFalse++;
    if (b.ino > max) max = b.ino;
    if (min === null || b.ino < min) min = b.ino;
    const k = `${n.dev}:${n.ino}`;
    const arr = buckets.get(k) ?? new Set();
    arr.add(`${b.dev}:${b.ino}`);
    buckets.set(k, arr);
  }
  let collidingDistinct = 0;
  for (const s of buckets.values()) if (s.size > 1) collidingDistinct += s.size;
  return { n: paths.length, over2pow53: over, numberUnsafe: safeFalse, collidingDistinct,
    min: String(min), max: String(max), maxSeqHigh16: String(max >> 48n), sampleHex: min === null ? '' : '0x' + min.toString(16) };
}
const out = { label, dir, created: census(seen), system: census(sysFiles) };
console.log('PROBE_JSON ' + JSON.stringify(out));
