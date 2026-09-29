// Generate the three PNG fixtures for the PR #12923 rig.
import fs from 'node:fs';
import path from 'node:path';
import { makePng, sha256 } from './png.mjs';

const RUNS = path.join(process.argv[2], 'runs');
fs.mkdirSync(RUNS, { recursive: true });

function sized(width, height, targetMin, targetMax, seed) {
  // Binary-search noise rows until the encoded size lands in range.
  let lo = 0;
  let hi = height;
  let best;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const buf = makePng({ width, height, noiseRows: mid, seed });
    if (buf.length < targetMin) {
      lo = mid + 1;
    } else if (buf.length > targetMax) {
      hi = mid - 1;
      best = buf.length <= targetMax ? best : best;
    } else {
      return { buf, noiseRows: mid };
    }
    if (!best || (buf.length >= targetMin && buf.length < best.length)) best = buf.length >= targetMin ? buf : best;
  }
  throw new Error(`no fit in [${targetMin}, ${targetMax}]`);
}

const large = sized(2855, 1625, 1_740_000, 1_820_000, 7);
fs.writeFileSync(path.join(RUNS, 'large.png'), large.buf);
const small = makePng({ width: 800, height: 500, noiseRows: 140, seed: 3 });
fs.writeFileSync(path.join(RUNS, 'small.png'), small);
const xl = sized(2400, 1400, 1_200_000, 1_350_000, 11);
fs.writeFileSync(path.join(RUNS, 'xl.png'), xl.buf);
for (const [n, b] of [['large', large.buf], ['small', small], ['xl', xl.buf]]) {
  console.log(n, b.length, sha256(b).slice(0, 16), b.length > 512 * 1024 ? `chunks=${Math.ceil(b.length / (512 * 1024))}` : 'legacy');
}
