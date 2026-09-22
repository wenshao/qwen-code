// Observation only: how long does this worker's event loop go without turning?
import { afterAll, expect } from 'vitest';
import fs from 'node:fs';
let last = Date.now();
let maxGap = 0;
let maxAt = 0;
const t0 = Date.now();
const iv = setInterval(() => {
  const now = Date.now();
  const gap = now - last;
  if (gap > maxGap) { maxGap = gap; maxAt = now - t0; }
  last = now;
}, 100);
iv.unref?.();
afterAll(() => {
  const now = Date.now();
  const tail = now - last;
  fs.appendFileSync(process.env.LOOP_PROBE_OUT!, JSON.stringify({ file: expect.getState().testPath, maxLoopGapMs: Math.max(maxGap, tail), tailGapMs: tail, fileWallMs: now - t0, maxAtMs: maxAt }) + '\n');
});
