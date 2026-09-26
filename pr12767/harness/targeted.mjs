// Targeted probes on the removed-directory rules.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  LocalToolResultSegmentStore,
  MTR,
  closeWriter,
  mkRuntime,
  openWriter,
  sessionKey,
  sha,
} from './lib.mjs';

const out = {};
const seg = (s) => Buffer.from(s);
const bytes = [seg('alpha-'), seg('beta-'), seg('gamma')];

async function scenario(name, removeOrdinal, alsoMarker) {
  const rt = await mkRuntime(undefined, 't');
  let w = await openWriter(rt);
  const ledger = new MTR.ToolResultSegmentLedger();
  const log = [];
  for (let ordinal = 0; ordinal < 3; ordinal++) {
    const req = { captureId: 'cap', streamId: 'stdout', ordinal, bytes: bytes[ordinal] };
    const res = await w.store.publish(req);
    ledger.publish(req);
    log.push(['publish', ordinal, res.status]);
  }
  await closeWriter(w);
  const stream = path.join(w.store.root, 'capture-cap', 'stream-stdout');
  const id = String(removeOrdinal).padStart(5, '0');
  await fs.rm(path.join(stream, `segment-${id}`), { recursive: true });
  if (alsoMarker) await fs.rm(path.join(stream, `published-${id}`));
  w = await openWriter(rt);
  const reader = await LocalToolResultSegmentStore.openReadOnly({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
  log.push(['prefix(read-only) before seal', await reader.prefix({ captureId: 'cap', streamId: 'stdout' })]);
  await reader.close();
  const two = Buffer.concat(bytes.slice(0, 2));
  const sealReq = { captureId: 'cap', streamId: 'stdout', segmentCount: 2, byteLength: two.byteLength, digest: sha(two) };
  log.push(['ledger seal(count=2) with the same history', ledger.seal(sealReq)]);
  log.push(['disk seal(count=2)', await w.store.seal(sealReq)]);
  log.push(['disk prefix after seal', await w.store.prefix({ captureId: 'cap', streamId: 'stdout' })]);
  log.push(['disk publish(2) identical retry', await w.store.publish({ captureId: 'cap', streamId: 'stdout', ordinal: 2, bytes: bytes[2] })]);
  const entries = (await fs.readdir(stream)).sort();
  const rootEntries = (await fs.readdir(w.store.root)).filter((n) => n.startsWith('sealed-stream-'));
  log.push(['stream dir entries', entries]);
  log.push(['seal anchors in namespace', rootEntries.length]);
  await closeWriter(w);
  await fs.rm(rt.root, { recursive: true, force: true });
  out[name] = log;
}

await scenario('remove tail segment dir (ordinal 2), marker kept', 2, false);
await scenario('remove middle segment dir (ordinal 1), marker kept', 1, false);
await scenario('remove tail segment dir AND its published marker', 2, true);

// Reader on a Session whose namespace was never created by a writer.
{
  const rt = await mkRuntime(undefined, 't');
  let error;
  try {
    await LocalToolResultSegmentStore.openReadOnly({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
  } catch (e) {
    error = `${e.constructor.name}: ${e.code ?? ''} ${e.message}`;
  }
  out['openReadOnly before any writer'] = error ?? 'opened';
  await fs.rm(rt.root, { recursive: true, force: true });
}

// Permissions of what the store creates.
{
  const rt = await mkRuntime(undefined, 't');
  const w = await openWriter(rt);
  await w.store.publish({ captureId: 'cap', streamId: 'stdout', ordinal: 0, bytes: seg('x') });
  const stream = path.join(w.store.root, 'capture-cap', 'stream-stdout');
  const mode = async (p) => ((await fs.stat(p)).mode & 0o777).toString(8);
  out.modes = {
    namespace: await mode(w.store.root),
    stream: await mode(stream),
    segmentDir: await mode(path.join(stream, 'segment-00000')),
    bytes: await mode(path.join(stream, 'segment-00000', 'bytes')),
    marker: await mode(path.join(stream, 'published-00000')),
  };
  await closeWriter(w);
  await fs.rm(rt.root, { recursive: true, force: true });
}
// Longest legal tokens: 128-character capture and stream IDs.
{
  const rt = await mkRuntime(undefined, 't');
  const w = await openWriter(rt);
  const captureId = 'c'.repeat(128);
  const streamId = 's'.repeat(128);
  const b = Buffer.from('long-path');
  const p = await w.store.publish({ captureId, streamId, ordinal: 65535, bytes: b });
  const q = await w.store.publish({ captureId, streamId, ordinal: 0, bytes: b });
  const pre = await w.store.prefix({ captureId, streamId });
  const longest = path.join(w.store.root, `capture-${captureId}`, `stream-${streamId}`, 'segment-65535', 'receipt.json');
  out.maxTokens = { publishMaxOrdinal: p.status, publishZero: q.status, prefix: pre.status === 'ok' ? pre.result.segmentCount : pre, longestPathChars: longest.length };
  await closeWriter(w);
  await fs.rm(rt.root, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 1));
