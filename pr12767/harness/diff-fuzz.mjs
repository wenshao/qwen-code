// Differential fuzz: the disk store against the O1a in-memory ledger.
// Random publish / seal / prefix sequences, with the writer closed and a new
// Session lease acquired between operations, plus fresh read-only handles.
// Every outcome must be JSON-identical to the ledger's.
import * as fs from 'node:fs/promises';
import {
  LocalToolResultSegmentStore,
  MTR,
  closeWriter,
  json,
  mkRuntime,
  openWriter,
  rng,
  segmentBytes,
  sessionKey,
  sha,
} from './lib.mjs';

const ITER = Number(process.env.ITER ?? 200);
const OPS = Number(process.env.OPS ?? 60);
const SEED0 = Number(process.env.SEED ?? 1);
const captures = ['cap-a', 'cap-b'];
const streams = ['stdout', 'stderr'];

const stats = {
  iterations: 0,
  ops: 0,
  byOp: {},
  byOutcome: {},
  reopen: 0,
  readOnlyPrefix: 0,
  disagreements: [],
};

function pick(r, list) {
  return list[Math.floor(r() * list.length)];
}

function lengthFor(r) {
  const x = r();
  if (x < 0.6) return 1 + Math.floor(r() * 64);
  if (x < 0.9) return 64 + Math.floor(r() * 4096);
  return 60_000 + Math.floor(r() * 140_000); // crosses the 64 KiB chunk
}

for (let it = 0; it < ITER; it++) {
  const seed = SEED0 + it;
  const r = rng(seed);
  const rt = await mkRuntime(undefined, 'diff');
  const ledger = new MTR.ToolResultSegmentLedger();
  let w = await openWriter(rt);
  const lengths = new Map();
  const len = (key, variant) => {
    const k = `${key}/${variant}`;
    if (!lengths.has(k)) lengths.set(k, lengthFor(r));
    return lengths.get(k);
  };
  for (let op = 0; op < OPS; op++) {
    const captureId = pick(r, captures);
    const streamId = pick(r, streams);
    const key = `${captureId}/${streamId}`;
    const roll = r();
    let name;
    let request;
    let run;
    if (roll < 0.5) {
      name = 'publish';
      const ordinal = Math.floor(r() * 5);
      const v = r();
      const variant = v < 0.8 ? 0 : v < 0.9 ? 1 : 2;
      const length = variant === 2 ? len(`${key}/${ordinal}`, 2) : len(`${key}/${ordinal}`, 0);
      const bytes = segmentBytes(seed, key, ordinal, length, variant);
      request = { captureId, streamId, ordinal, bytes };
      const d = r();
      if (d < 0.25) request.digest = sha(bytes);
      else if (d < 0.32) request.digest = sha(Buffer.from('wrong'));
      run = (s) => s.publish({ ...request, bytes: Buffer.from(bytes) });
    } else if (roll < 0.7) {
      name = 'seal';
      const p = ledger.prefix({ captureId, streamId }).result;
      const s = r();
      request = {
        captureId,
        streamId,
        segmentCount: p.segmentCount,
        byteLength: p.byteLength,
        digest: p.digest,
      };
      if (s < 0.1) request.segmentCount += 1;
      else if (s < 0.2 && request.segmentCount > 0) request.segmentCount -= 1;
      else if (s < 0.28) request.byteLength += 1;
      else if (s < 0.36) request.digest = sha(Buffer.from('other'));
      else if (s < 0.42) {
        request.segmentCount = 0;
        request.byteLength = 0;
        request.digest = sha();
      }
      run = (st) => st.seal(request);
    } else if (roll < 0.82) {
      name = 'prefix';
      request = { captureId, streamId };
      run = (s) => s.prefix(request);
    } else if (roll < 0.9) {
      name = 'prefix-readonly';
      request = { captureId, streamId };
      run = async () => {
        const reader = await LocalToolResultSegmentStore.openReadOnly({
          runtimeBaseDir: rt.runtimeBaseDir,
          sessionKey,
        });
        try {
          stats.readOnlyPrefix++;
          return await reader.prefix(request);
        } finally {
          await reader.close();
        }
      };
    } else if (roll < 0.95) {
      name = 'reopen';
      await closeWriter(w);
      w = await openWriter(rt);
      stats.reopen++;
      stats.byOp[name] = (stats.byOp[name] ?? 0) + 1;
      continue;
    } else {
      name = 'invalid';
      const kind = Math.floor(r() * 5);
      request = [
        { captureId: 'Cap-A', streamId, ordinal: 0, bytes: Buffer.from('x') },
        { captureId, streamId, ordinal: 65536, bytes: Buffer.from('x') },
        { captureId, streamId, ordinal: 0, bytes: Buffer.alloc(0) },
        { captureId, streamId, ordinal: 0, bytes: Buffer.from('x'), extra: 1 },
        { captureId, streamId: '../x', ordinal: 0, bytes: Buffer.from('x') },
      ][kind];
      run = (s) => s.publish(request);
    }
    const ledgerOp = name === 'invalid' ? 'publish' : name.replace('-readonly', '');
    const expected = ledger[ledgerOp](request);
    let actual;
    try {
      actual = await run(w.store);
    } catch (error) {
      actual = { threw: String(error?.message ?? error) };
    }
    stats.ops++;
    stats.byOp[name] = (stats.byOp[name] ?? 0) + 1;
    const tag = `${name}:${actual.status ?? 'threw'}:${actual.code ?? ''}`;
    stats.byOutcome[tag] = (stats.byOutcome[tag] ?? 0) + 1;
    if (json(actual) !== json(expected)) {
      stats.disagreements.push({ seed, op, name, request: json(request).slice(0, 300), expected, actual });
    }
  }
  await closeWriter(w);
  await fs.rm(rt.root, { recursive: true, force: true });
  stats.iterations++;
}

console.log(JSON.stringify({ ...stats, disagreements: stats.disagreements.slice(0, 10), disagreementCount: stats.disagreements.length }, null, 1));
console.log(`PROBE_JSON ${JSON.stringify({ probe: 'diff-fuzz', iterations: stats.iterations, ops: stats.ops, disagreements: stats.disagreements.length })}`);
