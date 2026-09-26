// For each surviving mutant, one real-filesystem scenario that the guard
// exists for. Run once per arm (STORE_FILE selects the dist file).
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  LocalManagedSessionResourceStore,
  LocalToolResultSegmentStore,
  MTR,
  SessionWriterLease,
  closeWriter,
  mkRuntime,
  openWriter,
  sessionKey,
  sha,
  FIXTURES,
} from './lib.mjs';

const scenario = process.argv[2];
const fmt = async (p) => {
  try {
    return JSON.stringify(await p);
  } catch (e) {
    return `threw ${e.constructor.name}: ${e.message}`.slice(0, 110);
  }
};
const rt = await mkRuntime(undefined, 'surv');
let result;

if (scenario === 'M12-page-digest') {
  // A pinned page records another segment digest of the same length.
  const w = await openWriter(rt);
  await w.store.publish({ captureId: 'capture-01', streamId: 'stdout', ordinal: 0, bytes: Buffer.from('alpha') });
  await w.store.seal({ captureId: 'capture-01', streamId: 'stdout', segmentCount: 1, byteLength: 5, digest: sha(Buffer.from('alpha')) });
  await w.store.seal({ captureId: 'capture-01', streamId: 'stderr', segmentCount: 0, byteLength: 0, digest: sha() });
  const fixtures = JSON.parse(await fs.readFile(FIXTURES, 'utf8'));
  const base = MTR.parseToolResultManifest(fixtures.manifest);
  const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
  const other = Buffer.from('omega');
  const page = { toolResult: 'managed-tool-result/1', type: 'page', captureId: 'capture-01', streamId: 'stdout', firstOrdinal: 0, offset: 0, segments: [{ byteLength: 5, digest: sha(other) }] };
  const pageRef = await resources.publish(MTR.MANAGED_TOOL_RESULT_KINDS.page, Buffer.from(JSON.stringify(page)));
  const m = { ...base, contents: [{ ...base.contents[0], byteLength: 5, digest: sha(other), body: { pages: [{ ref: pageRef, segmentCount: 1, byteLength: 5 }] } }, base.contents[1]] };
  const ref = await resources.publish(MTR.MANAGED_TOOL_RESULT_KINDS.manifest, Buffer.from(JSON.stringify(m)));
  const identity = Object.fromEntries(['tenantId', 'sessionId', 'turnId', 'executionCallId', 'callId', 'invocationDigest', 'bindingGeneration', 'captureId', 'revision'].map((k) => [k, m[k]]));
  const r = await w.store.readRange({ manifestRef: ref, expectedIdentity: identity, streamId: 'stdout', offset: 0, length: 5 });
  result = r.status === 'ok' ? `ok, returned "${r.result.toString()}" for a page that pins sha256("omega")` : JSON.stringify(r);
  await closeWriter(w);
} else if (scenario === 'M17-capture-removed') {
  const w = await openWriter(rt);
  await w.store.publish({ captureId: 'cap', streamId: 'stdout', ordinal: 0, bytes: Buffer.from('acknowledged') });
  await fs.rm(path.join(w.store.root, 'capture-cap'), { recursive: true });
  const different = await w.store.publish({ captureId: 'cap', streamId: 'stdout', ordinal: 0, bytes: Buffer.from('substitute') });
  const prefix = await w.store.prefix({ captureId: 'cap', streamId: 'stdout' });
  result = `publish(other bytes) → ${JSON.stringify(different.status === 'ok' ? 'ok' : different)}; prefix → ${prefix.status === 'ok' ? `ok ${prefix.result.segmentCount} segment(s)` : JSON.stringify(prefix)}`;
  await closeWriter(w);
} else if (scenario === 'M20-lease-lost') {
  // The transcript changes behind the writer's back: the lease is no longer
  // provably owned and unchanged, so no new bytes may be acknowledged.
  const w = await openWriter(rt);
  await w.store.publish({ captureId: 'cap', streamId: 'stdout', ordinal: 0, bytes: Buffer.from('first') });
  await fs.appendFile(rt.transcriptPath, '{"foreign":"writer"}\n');
  result = `publish after the transcript changed → ${await fmt(w.store.publish({ captureId: 'cap', streamId: 'stdout', ordinal: 1, bytes: Buffer.from('second') }))}`;
  await w.store.close();
} else if (scenario === 'M21-foreign-lease') {
  // A lease held for session-b is used to open session-a's writable store.
  const transcriptB = path.join(rt.runtimeBaseDir, 'chats', 'session-b.jsonl');
  const leaseB = await SessionWriterLease.acquire({ runtimeBaseDir: rt.runtimeBaseDir, sessionId: 'session-b', transcriptPath: transcriptB });
  result = `openWritable(session-a, lease of session-b) → ${await fmt(LocalToolResultSegmentStore.openWritable({ lease: leaseB, sessionKey }).then(async (s) => { const r = await s.publish({ captureId: 'cap', streamId: 'stdout', ordinal: 0, bytes: Buffer.from('x') }); await s.close(); return `opened; publish ${r.status}`; }))}`;
  await leaseB.release();
}
await fs.rm(rt.root, { recursive: true, force: true });
console.log(`PROBE_JSON ${JSON.stringify({ probe: 'survivor', scenario, store: process.env.STORE_FILE ?? 'pr', result })}`);
