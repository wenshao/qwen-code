// Cross-process race: a writer process publishes 3 small segments then seals
// each stream as fast as it can; a separate reader process polls prefix on a
// read-only handle for the stream being written. A healthy store must never
// refuse the reader.
//   node race.mjs parent            -> spawns both, prints summary
import { fork } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  LocalToolResultSegmentStore,
  closeWriter,
  mkRuntime,
  openWriter,
  sessionKey,
  sha,
} from './lib.mjs';

const role = process.argv[2];
const SECONDS = Number(process.env.RACE_SECONDS ?? 20);
const self = fileURLToPath(import.meta.url);

if (role === 'writer') {
  const [runtimeBaseDir, transcriptPath] = process.argv.slice(3);
  const w = await openWriter({ runtimeBaseDir, transcriptPath });
  process.send({ type: 'ready' });
  const deadline = Date.now() + SECONDS * 1000;
  let n = 0;
  while (Date.now() < deadline) {
    const captureId = `c${n}`;
    const SEGS = Number(process.env.RACE_SEGMENTS ?? 3);
    const parts = Array.from({ length: SEGS }, (_, i) => Buffer.from(`${'x'.repeat(i + 1)}${n}`));
    for (let i = 0; i < SEGS; i++) await w.store.publish({ captureId, streamId: 'stdout', ordinal: i, bytes: parts[i] });
    const all = Buffer.concat(parts);
    await w.store.seal({ captureId, streamId: 'stdout', segmentCount: SEGS, byteLength: all.byteLength, digest: sha(all) });
    n++;
    process.send({ type: 'progress', n });
  }
  await closeWriter(w);
  await new Promise((resolve) => process.send({ type: 'done', n }, resolve));
  process.exit(0);
} else if (role === 'reader') {
  const [runtimeBaseDir] = process.argv.slice(3);
  const reader = await LocalToolResultSegmentStore.openReadOnly({ runtimeBaseDir, sessionKey });
  // Untargeted event-loop contention: block the loop BUSY ms out of every BUSY+5 ms.
  const busy = Number(process.env.READER_BUSY_MS ?? 0);
  const hog = busy ? setInterval(() => { const t = Date.now(); while (Date.now() - t < busy); }, busy + 5) : undefined;
  let latest = 0;
  let stop = false;
  process.on('message', (m) => {
    if (m.type === 'progress') latest = m.n;
    if (m.type === 'stop') stop = true;
  });
  const out = { polls: 0, ok: 0, refused: 0, threw: 0, sealedSeen: 0, codes: {} };
  while (!stop) {
    const captureId = `c${latest}`;
    let res;
    try {
      res = await reader.prefix({ captureId, streamId: 'stdout' });
    } catch (e) {
      out.threw++;
      continue;
    } finally {
      out.polls++;
    }
    if (res.status === 'ok') {
      out.ok++;
      if (res.result.sealed) out.sealedSeen++;
    } else {
      out.refused++;
      out.codes[res.code] = (out.codes[res.code] ?? 0) + 1;
    }
  }
  if (hog) clearInterval(hog);
  await reader.close();
  out.injectedDelays = globalThis.__injected ?? 0;
  await new Promise((resolve) => process.send({ type: 'result', out }, resolve));
  process.exit(0);
} else {
  const rt = await mkRuntime(undefined, 'race');
  const writer = fork(self, ['writer', rt.runtimeBaseDir, rt.transcriptPath], { env: process.env });
  await new Promise((resolve) => writer.on('message', (m) => m.type === 'ready' && resolve()));
  const reader = fork(self, ['reader', rt.runtimeBaseDir], { env: process.env, execArgv: process.env.READER_DELAY_MS ? ['--import', new URL('./inject-delay.mjs', import.meta.url).href] : [] });
  let streams = 0;
  const done = new Promise((resolve) =>
    writer.on('message', (m) => {
      if (m.type === 'progress') reader.send(m);
      if (m.type === 'done') {
        streams = m.n;
        resolve();
      }
    }),
  );
  await done;
  reader.send({ type: 'stop' });
  const result = await new Promise((resolve) => reader.on('message', (m) => m.type === 'result' && resolve(m.out)));
  await fs.rm(rt.root, { recursive: true, force: true });
  const summary = { readerBusyMs: Number(process.env.READER_BUSY_MS ?? 0), segmentsPerStream: Number(process.env.RACE_SEGMENTS ?? 3), readerDelayMs: Number(process.env.READER_DELAY_MS ?? 0), store: process.env.STORE_FILE ?? 'local-managed-tool-result-store.js', seconds: SECONDS, streamsWritten: streams, ...result };
  console.log(JSON.stringify(summary));
  console.log(`PROBE_JSON ${JSON.stringify({ probe: 'race', ...summary })}`);
}
