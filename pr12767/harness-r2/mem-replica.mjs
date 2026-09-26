// Replica of the PR's "publishes a 100 MiB or 1 GiB stream" loop (bc81319a),
// outside vitest: same chunk shape, same sampling points, same assertion
// quantity (peak arrayBuffers minus the level at the start).
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { closeWriter, mkRuntime, openWriter } from './lib.mjs';

const RUNS = Number(process.env.RUNS ?? 10);
const COUNT = Number(process.env.COUNT ?? 25);
const LIMIT = 80 * 1024 * 1024;
const results = [];
for (let run = 0; run < RUNS; run++) {
  const rt = await mkRuntime(undefined, 'mem');
  const w = await openWriter(rt);
  const size = 4 * 1024 * 1024;
  const expected = createHash('sha256');
  const initialBuffers = process.memoryUsage().arrayBuffers;
  let peakBuffers = initialBuffers;
  for (let ordinal = 0; ordinal < COUNT; ordinal++) {
    const chunk = Buffer.alloc(size, ordinal % 251);
    expected.update(chunk);
    const r = await w.store.publish({ captureId: 'large', streamId: 'stdout', ordinal, bytes: chunk });
    if (r.status !== 'ok') throw new Error('publish');
    peakBuffers = Math.max(peakBuffers, process.memoryUsage().arrayBuffers);
  }
  const sealed = await w.store.seal({ captureId: 'large', streamId: 'stdout', segmentCount: COUNT, byteLength: COUNT * size, digest: expected.digest('hex') });
  if (sealed.status !== 'ok') throw new Error('seal');
  await w.store.prefix({ captureId: 'large', streamId: 'stdout' });
  const deltaMiB = (peakBuffers - initialBuffers) / 1048576;
  results.push(Math.round(deltaMiB * 10) / 10);
  await closeWriter(w);
  await fs.rm(rt.root, { recursive: true, force: true });
}
const sorted = [...results].sort((a, b) => a - b);
const summary = {
  node: process.version,
  store: process.env.STORE_FILE ?? 'local-managed-tool-result-store.js',
  runs: RUNS,
  count: COUNT,
  deltaMiB: { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) },
  overLimit: results.filter((d) => d * 1048576 >= LIMIT).length,
  all: results,
};
console.log(`PROBE_JSON ${JSON.stringify({ probe: 'mem-replica', ...summary })}`);
