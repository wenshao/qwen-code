// Output generator: node gen.mjs <root> <stdoutMiB> <stderrKiB> [sleepAfterSec] [inherit]
// Writes random bytes (NUL, invalid UTF-8, split multi-byte runs) to both pipes
// incrementally, records its own SHA-256 per stream, and appends one line to
// <root>/side-effects.log so the driver can count real executions.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const [root, outMiB, errKiB, sleepSec = '0', inherit = ''] = process.argv.slice(2);
appendFileSync(`${root}/side-effects.log`, `run pid=${process.pid} at=${Date.now()}\n`);
if (inherit === 'inherit') {
  // A grandchild that keeps stdout/stderr open well past the parent's exit.
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 6000)'], {
    detached: true, stdio: ['ignore', 'inherit', 'inherit'],
  }).unref();
}
const out = createHash('sha256');
const err = createHash('sha256');
let outBytes = 0;
let errBytes = 0;
let tail = Buffer.alloc(0);
const write = async (stream, bytes) => {
  if (!stream.write(bytes)) await once(stream, 'drain');
};
// First chunk: explicit NUL, invalid UTF-8 and a UTF-8 sequence split across writes.
const lead = Buffer.from([0x00, 0xff, 0xfe, 0xc3, 0x28, 0xe4, 0xb8]);
const lead2 = Buffer.from([0xad, 0x0a]);
for (const b of [lead, lead2]) { out.update(b); outBytes += b.length; await write(process.stdout, b); }
const errEvery = Math.max(1, Math.floor(Number(outMiB) / Math.max(1, Math.ceil(Number(errKiB) / 64))));
let errLeft = Number(errKiB) * 1024;
const totalOut = Math.round(Number(outMiB) * 1024 * 1024);
for (let i = 0; outBytes < totalOut; i++) {
  const chunk = randomBytes(Math.min(1024 * 1024, totalOut - outBytes));
  out.update(chunk); outBytes += chunk.length; tail = chunk.subarray(chunk.length - 5);
  await write(process.stdout, chunk);
  if (errLeft > 0 && i % errEvery === 0) {
    const e = randomBytes(Math.min(64 * 1024, errLeft));
    errLeft -= e.length; err.update(e); errBytes += e.length;
    await write(process.stderr, e);
  }
}
while (errLeft > 0) {
  const e = randomBytes(Math.min(64 * 1024, errLeft));
  errLeft -= e.length; err.update(e); errBytes += e.length;
  await write(process.stderr, e);
}
writeFileSync(`${root}/gen-digest.json`, JSON.stringify({
  stdout: { byteLength: outBytes, digest: out.digest('hex'), tailHex: tail.toString('hex') },
  stderr: { byteLength: errBytes, digest: err.digest('hex') },
}));
if (Number(sleepSec) > 0) await new Promise((r) => setTimeout(r, Number(sleepSec) * 1000));
