// Scale and cost model at 100 MiB and 1 GiB (4 MiB segments from an
// incremental source, the same shape as the PR's own scale test):
//   publish throughput, prefix and seal latency, 64 KiB range reads through
//   body.pages and body.ref, and peak RSS / ArrayBuffers of this process.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  LocalManagedSessionResourceStore,
  LocalToolResultSegmentStore,
  MTR,
  closeWriter,
  mkRuntime,
  openWriter,
  sessionKey,
  sha,
  FIXTURES,
} from './lib.mjs';
import { createHash } from 'node:crypto';

const COUNT = Number(process.env.COUNT ?? 25);
const SIZE = 4 * 1024 * 1024;
const PREFIX_EVERY = Number(process.env.PREFIX_EVERY ?? 0); // poll prefix after every N publishes
const WITH_REF = process.env.WITH_REF === '1';
const fixtures = JSON.parse(await fs.readFile(FIXTURES, 'utf8'));
const base = MTR.parseToolResultManifest(fixtures.manifest);
const KINDS = MTR.MANAGED_TOOL_RESULT_KINDS;

let peakRss = 0;
let peakBuffers = 0;
const sample = () => {
  const u = process.memoryUsage();
  peakRss = Math.max(peakRss, u.rss);
  peakBuffers = Math.max(peakBuffers, u.arrayBuffers);
};
const timer = setInterval(sample, 20);
const ms = (t) => Math.round(performance.now() - t);

const rt = await mkRuntime(process.env.BASE_DIR, 'scale');
const w = await openWriter(rt);
const whole = createHash('sha256');
const chunkFor = (ordinal) => {
  const b = Buffer.alloc(SIZE, ordinal % 251);
  b.writeUInt32BE(ordinal, 0);
  return b;
};
const publishMs = [];
let pollMsTotal = 0;
let polls = 0;
const t0 = performance.now();
for (let ordinal = 0; ordinal < COUNT; ordinal++) {
  const chunk = chunkFor(ordinal);
  whole.update(chunk);
  const t = performance.now();
  const r = await w.store.publish({ captureId: 'large', streamId: 'stdout', ordinal, bytes: chunk });
  publishMs.push(performance.now() - t);
  if (r.status !== 'ok') throw new Error('publish');
  sample();
  if (PREFIX_EVERY && (ordinal + 1) % PREFIX_EVERY === 0) {
    const tp = performance.now();
    await w.store.prefix({ captureId: 'large', streamId: 'stdout' });
    pollMsTotal += performance.now() - tp;
    polls++;
  }
}
const publishTotalMs = ms(t0);
const digest = whole.digest('hex');
let t = performance.now();
const prefixBefore = await w.store.prefix({ captureId: 'large', streamId: 'stdout' });
const prefixWritableMs = ms(t);
t = performance.now();
const seal = await w.store.seal({ captureId: 'large', streamId: 'stdout', segmentCount: COUNT, byteLength: COUNT * SIZE, digest });
const sealMs = ms(t);
const reader = await LocalToolResultSegmentStore.openReadOnly({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
t = performance.now();
const prefixRo = await reader.prefix({ captureId: 'large', streamId: 'stdout' });
const prefixReadOnlyMs = ms(t);

// Manifest with body.pages (up to 64 segments per page is well within limits).
const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
const perPage = 32;
const pages = [];
for (let first = 0; first < COUNT; first += perPage) {
  const n = Math.min(perPage, COUNT - first);
  const segs = [];
  for (let i = 0; i < n; i++) segs.push({ byteLength: SIZE, digest: sha(chunkFor(first + i)) });
  const page = { toolResult: 'managed-tool-result/1', type: 'page', captureId: 'large', streamId: 'stdout', firstOrdinal: first, offset: first * SIZE, segments: segs };
  pages.push({ ref: await resources.publish(KINDS.page, Buffer.from(JSON.stringify(page))), segmentCount: n, byteLength: n * SIZE });
}
const identity = (m) => Object.fromEntries(['tenantId', 'sessionId', 'turnId', 'executionCallId', 'callId', 'invocationDigest', 'bindingGeneration', 'captureId', 'revision'].map((k) => [k, m[k]]));
const mPages = { ...base, captureId: 'large', contents: [{ ...base.contents[0], byteLength: COUNT * SIZE, digest, body: { pages } }, base.contents[1]] };
MTR.parseToolResultManifest(mPages);
const mPagesRef = await resources.publish(KINDS.manifest, Buffer.from(JSON.stringify(mPages)));
const read = async (handle, ref, m, offset) => {
  const tr = performance.now();
  const r = await handle.readRange({ manifestRef: ref, expectedIdentity: identity(m), streamId: 'stdout', offset, length: 64 * 1024 });
  const el = performance.now() - tr;
  const want = Buffer.concat([chunkFor(Math.floor(offset / SIZE))]).subarray(offset % SIZE, (offset % SIZE) + 64 * 1024);
  if (r.status !== 'ok' || Buffer.compare(r.result, want) !== 0) throw new Error(`bad read ${JSON.stringify(r).slice(0, 200)}`);
  return Math.round(el);
};
const readPagesStartMs = await read(reader, mPagesRef, mPages, 0);
const readPagesEndMs = await read(reader, mPagesRef, mPages, COUNT * SIZE - 64 * 1024);

let readRefStartMs;
let readRefEndMs;
if (WITH_REF) {
  // body.ref: whole content as one resource. Published via a file stream copy
  // into the resource store's layout would be the O1c job; here the existing
  // store's publish takes a Buffer, so build it by concatenation (test only).
  // Stream the content file into the resource store layout (kind/resourceId)
  // so the harness never holds the whole body in memory.
  const { randomUUID } = await import('node:crypto');
  const resourceId = randomUUID();
  const dir = path.join(resources.sessionRoot, KINDS.content);
  await fs.mkdir(dir, { recursive: true });
  const fh = await fs.open(path.join(dir, resourceId), 'wx', 0o600);
  const ch = createHash('sha256');
  for (let i = 0; i < COUNT; i++) { const c = chunkFor(i); ch.update(c); await fh.write(c); }
  await fh.sync();
  await fh.close();
  const contentRef = { resourceId, kind: KINDS.content, schemaVersion: 1, byteLength: COUNT * SIZE, digest: ch.digest('hex') };
  const mRef = { ...base, captureId: 'large', revision: 3, contents: [{ ...base.contents[0], byteLength: COUNT * SIZE, digest, body: { ref: contentRef } }, base.contents[1]] };
  const mRefRef = await resources.publish(KINDS.manifest, Buffer.from(JSON.stringify(mRef)));
  readRefStartMs = await read(reader, mRefRef, mRef, 0);
  readRefEndMs = await read(reader, mRefRef, mRef, COUNT * SIZE - 64 * 1024);
}
await reader.close();
await closeWriter(w);
clearInterval(timer);
sample();
await fs.rm(rt.root, { recursive: true, force: true });
publishMs.sort((a, b) => a - b);
const result = {
  mib: (COUNT * SIZE) / 1048576,
  segments: COUNT,
  publishTotalMs,
  publishMsP50: Math.round(publishMs[Math.floor(publishMs.length / 2)]),
  publishMsMax: Math.round(publishMs.at(-1)),
  throughputMiBs: Math.round(((COUNT * SIZE) / 1048576 / publishTotalMs) * 1000),
  prefixWritableMs,
  prefixReadOnlyMs,
  sealMs,
  pollEvery: PREFIX_EVERY,
  polls,
  pollMsTotal: Math.round(pollMsTotal),
  readPagesStartMs,
  readPagesEndMs,
  readRefStartMs,
  readRefEndMs,
  peakRssMiB: Math.round(peakRss / 1048576),
  peakArrayBuffersMiB: Math.round(peakBuffers / 1048576),
  ok: prefixBefore.status === 'ok' && seal.status === 'ok' && prefixRo.status === 'ok' && prefixRo.result.sealed,
};
console.log(JSON.stringify(result));
console.log(`PROBE_JSON ${JSON.stringify({ probe: 'scale', ...result })}`);
