// Range reads through real manifests and pages published with the existing
// LocalManagedSessionResourceStore. Random segment sizes (some crossing the
// store's 64 KiB hash chunk), random page splits, both body forms, an older
// open revision next to the final one, writable and read-only handles.
import * as fs from 'node:fs/promises';
import {
  LocalManagedSessionResourceStore,
  LocalToolResultSegmentStore,
  MTR,
  closeWriter,
  mkRuntime,
  openWriter,
  rng,
  segmentBytes,
  sessionKey,
  sha,
  FIXTURES,
} from './lib.mjs';

const fixtures = JSON.parse(
  await fs.readFile(
    FIXTURES,
    'utf8',
  ),
);
const base = MTR.parseToolResultManifest(fixtures.manifest);
const KINDS = MTR.MANAGED_TOOL_RESULT_KINDS;
const ITER = Number(process.env.ITER ?? 60);
const READS = Number(process.env.READS ?? 40);

const stats = { iterations: 0, reads: 0, ok: 0, refusedAsExpected: 0, wrong: [] };

function identityOf(m) {
  const keys = ['tenantId', 'sessionId', 'turnId', 'executionCallId', 'callId', 'invocationDigest', 'bindingGeneration', 'captureId', 'revision'];
  return Object.fromEntries(keys.map((k) => [k, m[k]]));
}

for (let it = 0; it < ITER; it++) {
  const seed = 5000 + it;
  const r = rng(seed);
  const rt = await mkRuntime(undefined, 'range');
  const w = await openWriter(rt);
  const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
  const captureId = `capture-${it}`;
  const count = 1 + Math.floor(r() * 9);
  const segs = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const x = r();
    const length = x < 0.5 ? 1 + Math.floor(r() * 16) : x < 0.85 ? 100 + Math.floor(r() * 5000) : 65_000 + Math.floor(r() * 140_000);
    const bytes = segmentBytes(seed, captureId, ordinal, length);
    segs.push(bytes);
  }
  // Publish out of order.
  const order = segs.map((_, i) => i).sort(() => r() - 0.5);
  for (const ordinal of order) {
    const res = await w.store.publish({ captureId, streamId: 'stdout', ordinal, bytes: segs[ordinal] });
    if (res.status !== 'ok') throw new Error(`publish ${ordinal}: ${JSON.stringify(res)}`);
  }
  const all = Buffer.concat(segs);
  const sealed = await w.store.seal({ captureId, streamId: 'stdout', segmentCount: count, byteLength: all.byteLength, digest: sha(all) });
  if (sealed.status !== 'ok') throw new Error('seal');
  await w.store.seal({ captureId, streamId: 'stderr', segmentCount: 0, byteLength: 0, digest: sha() });

  // Split into pages.
  const pageRefs = [];
  let firstOrdinal = 0;
  let offset = 0;
  while (firstOrdinal < count) {
    const n = Math.min(count - firstOrdinal, 1 + Math.floor(r() * 3));
    const page = {
      toolResult: 'managed-tool-result/1',
      type: 'page',
      captureId,
      streamId: 'stdout',
      firstOrdinal,
      offset,
      segments: segs.slice(firstOrdinal, firstOrdinal + n).map((b) => ({ byteLength: b.byteLength, digest: sha(b) })),
    };
    const bytes = Buffer.from(JSON.stringify(page));
    const byteLength = page.segments.reduce((s, x) => s + x.byteLength, 0);
    pageRefs.push({ ref: await resources.publish(KINDS.page, bytes), segmentCount: n, byteLength });
    firstOrdinal += n;
    offset += byteLength;
  }
  const stdoutEntry = base.contents[0];
  const stderrEntry = base.contents[1];
  const finalPages = {
    ...base,
    captureId,
    contents: [{ ...stdoutEntry, byteLength: all.byteLength, digest: sha(all), body: { pages: pageRefs } }, stderrEntry],
  };
  const k = 1 + Math.floor(r() * pageRefs.length);
  const prefixLen = pageRefs.slice(0, k).reduce((s, p) => s + p.byteLength, 0);
  const initial = {
    ...base,
    captureId,
    revision: 1,
    captureStatus: 'pending',
    contents: [{ ...stdoutEntry, state: 'open', byteLength: prefixLen, digest: sha(all.subarray(0, prefixLen)), body: { pages: pageRefs.slice(0, k) } }, stderrEntry],
  };
  const contentRef = await resources.publish(KINDS.content, all);
  const finalRef = {
    ...base,
    captureId,
    revision: 3,
    contents: [{ ...stdoutEntry, byteLength: all.byteLength, digest: sha(all), body: { ref: contentRef } }, stderrEntry],
  };
  const manifests = [];
  for (const [label, m, visible] of [
    ['initial', initial, prefixLen],
    ['pages', finalPages, all.byteLength],
    ['ref', finalRef, all.byteLength],
  ]) {
    MTR.parseToolResultManifest(m);
    const ref = await resources.publish(KINDS.manifest, Buffer.from(JSON.stringify(m)));
    manifests.push({ label, m, ref, visible });
  }
  const reader = await LocalToolResultSegmentStore.openReadOnly({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
  for (let i = 0; i < READS; i++) {
    const { label, m, ref, visible } = manifests[Math.floor(r() * manifests.length)];
    const handle = r() < 0.5 ? w.store : reader;
    let offset;
    let length;
    const x = r();
    if (x < 0.1) { offset = visible; length = 0; }
    else if (x < 0.2) { offset = visible; length = 1; }
    else if (x < 0.3) { offset = Math.floor(r() * (visible + 1)); length = visible - offset + 1; }
    else { offset = Math.floor(r() * (visible + 1)); length = Math.floor(r() * (visible - offset + 1)); }
    const expectOk = offset <= visible && length <= visible - offset;
    const res = await handle.readRange({ manifestRef: ref, expectedIdentity: identityOf(m), streamId: 'stdout', offset, length });
    stats.reads++;
    if (expectOk) {
      if (res.status === 'ok' && Buffer.compare(res.result, all.subarray(offset, offset + length)) === 0) stats.ok++;
      else stats.wrong.push({ seed, label, offset, length, visible, res: res.status === 'ok' ? `ok len ${res.result.byteLength}` : res });
    } else if (res.status === 'refused' && res.code === 'managed_tool_result_invalid') stats.refusedAsExpected++;
    else stats.wrong.push({ seed, label, offset, length, visible, res });
  }
  await reader.close();
  await closeWriter(w);
  await fs.rm(rt.root, { recursive: true, force: true });
  stats.iterations++;
}
console.log(JSON.stringify({ ...stats, wrong: stats.wrong.slice(0, 10), wrongCount: stats.wrong.length }, null, 1));
console.log(`PROBE_JSON ${JSON.stringify({ probe: 'range-fuzz', iterations: stats.iterations, reads: stats.reads, ok: stats.ok, refused: stats.refusedAsExpected, wrong: stats.wrong.length })}`);
