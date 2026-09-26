// Writer process for the crash fuzz. Publishes a deterministic stream out of
// order is not needed here: it publishes 0..N-1 then seals, reporting each
// receipt over IPC only after the store has returned it. The parent kills it
// with SIGKILL at a random moment.
import { openWriter, segmentBytes, sha } from './lib.mjs';

const [runtimeBaseDir, transcriptPath, seed, sizesJson] = process.argv.slice(2);
const sizes = JSON.parse(sizesJson);
const send = (m) => new Promise((resolve) => process.send(m, resolve));

const w = await openWriter({ runtimeBaseDir, transcriptPath });
await send({ type: 'opened' });
const all = [];
for (let ordinal = 0; ordinal < sizes.length; ordinal++) {
  const bytes = segmentBytes(seed, 'crash', ordinal, sizes[ordinal]);
  all.push(bytes);
  const res = await w.store.publish({ captureId: 'crash', streamId: 'stdout', ordinal, bytes });
  await send({ type: 'publish', ordinal, res });
}
const total = Buffer.concat(all);
const res = await w.store.seal({
  captureId: 'crash',
  streamId: 'stdout',
  segmentCount: sizes.length,
  byteLength: total.byteLength,
  digest: sha(total),
});
await send({ type: 'seal', res });
setInterval(() => {}, 1000);
