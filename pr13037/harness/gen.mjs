// Deterministic stdout/stderr generator for the Shell under test.
// usage: node gen.mjs <tag> <stdoutBytes> <stderrBytes> <exitCode> [sideEffectFile]
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const [tag, so, se, code, side] = process.argv.slice(2);
if (side) fs.appendFileSync(side, `${tag} ${process.pid} ${Date.now()}\n`);
function block(stream, b) {
  const out = Buffer.alloc(65536);
  for (let i = 0; i < 2048; i++) createHash('sha256').update(`${tag}|${stream}|${b}|${i}`).digest().copy(out, i * 32);
  return out;
}
async function write(fd, stream, total) {
  const s = fd === 1 ? process.stdout : process.stderr;
  let left = total, b = 0;
  while (left > 0) {
    const chunk = block(stream, b++);
    const piece = chunk.subarray(0, Math.min(left, chunk.length));
    left -= piece.length;
    if (!s.write(piece)) await new Promise((r) => s.once('drain', r));
  }
}
await Promise.all([write(1, 'stdout', Number(so)), write(2, 'stderr', Number(se))]);
await new Promise((r) => process.stdout.write('', r));
await new Promise((r) => process.stderr.write('', r));
process.exitCode = Number(code);
