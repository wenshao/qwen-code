// Crash fuzz: a real child process holds the Session writer lease and
// publishes, the parent SIGKILLs it at a random moment, then takes over with
// a new lease and checks recovery invariants:
//  - every receipt the child reported is still in the verified prefix
//  - the prefix digest is exactly the expected bytes (no staging visible)
//  - the stream reports sealed only if a seal was installed, and then fully
//  - identical retries replay the original receipts; the stream completes
import { fork } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LocalToolResultSegmentStore,
  closeWriter,
  mkRuntime,
  openWriter,
  rng,
  segmentBytes,
  sessionKey,
  sha,
} from './lib.mjs';

const ITER = Number(process.env.ITER ?? 100);
const child = path.join(path.dirname(fileURLToPath(import.meta.url)), 'crash-child.mjs');
const stats = {
  iterations: 0,
  killedBeforeFirstAck: 0,
  killedMidStream: 0,
  killedAfterSealAck: 0,
  durableButUnacked: 0,
  sealDurableButUnacked: 0,
  leftoverPendingEntries: 0,
  takeoverMs: [],
  violations: [],
};

async function listPending(dir) {
  let n = 0;
  async function walk(d) {
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.pending-')) n++;
      if (e.isDirectory()) await walk(path.join(d, e.name));
    }
  }
  await walk(dir);
  return n;
}

for (let it = 0; it < ITER; it++) {
  const seed = 9000 + it;
  const r = rng(seed);
  const rt = await mkRuntime(undefined, 'crash');
  const count = 4 + Math.floor(r() * 8);
  const sizes = Array.from({ length: count }, () => (r() < 0.3 ? 1 + Math.floor(r() * 100) : 64 * 1024 + Math.floor(r() * 2 * 1024 * 1024)));
  const expected = sizes.map((len, ordinal) => segmentBytes(seed, 'crash', ordinal, len));
  const proc = fork(child, [rt.runtimeBaseDir, rt.transcriptPath, String(seed), JSON.stringify(sizes)], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const acks = [];
  let sealAck;
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  await new Promise((resolve, reject) => {
    proc.on('message', (m) => {
      if (m.type === 'opened') resolve();
      else if (m.type === 'publish') acks.push(m);
      else if (m.type === 'seal') sealAck = m;
    });
    proc.once('exit', () => reject(new Error('child exited before open')));
  });
  const delay = Math.floor(r() * Number(process.env.MAXDELAY ?? 450));
  await new Promise((resolve) => setTimeout(resolve, delay));
  proc.kill('SIGKILL');
  await exited;

  const pending = await listPending(rt.runtimeBaseDir);
  stats.leftoverPendingEntries += pending;
  const t0 = performance.now();
  const w = await openWriter(rt);
  stats.takeoverMs.push(performance.now() - t0);
  const fail = (msg, extra = {}) => stats.violations.push({ seed, msg, acks: acks.length, sealAck: !!sealAck, ...extra });

  for (const a of acks) {
    if (a.res.status !== 'ok') fail('child publish not ok', { res: a.res });
  }
  const pre = await w.store.prefix({ captureId: 'crash', streamId: 'stdout' });
  if (pre.status !== 'ok') fail('prefix refused after crash', { pre });
  else {
    const p = pre.result;
    if (p.segmentCount < acks.length) fail('acknowledged segment lost', { p });
    const want = Buffer.concat(expected.slice(0, p.segmentCount));
    if (p.byteLength !== want.byteLength || p.digest !== sha(want)) fail('prefix bytes differ', { p });
    if (p.segmentCount > acks.length) stats.durableButUnacked++;
    if (sealAck && !p.sealed) fail('acknowledged seal lost');
    if (p.sealed && p.segmentCount !== count) fail('partial stream sealed', { p });
    if (p.sealed && !sealAck) stats.sealDurableButUnacked++;
    const reader = await LocalToolResultSegmentStore.openReadOnly({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
    const ro = await reader.prefix({ captureId: 'crash', streamId: 'stdout' });
    await reader.close();
    if (JSON.stringify(ro) !== JSON.stringify(pre)) fail('read-only prefix differs', { ro });
  }
  if (acks.length === 0) stats.killedBeforeFirstAck++;
  else if (sealAck) stats.killedAfterSealAck++;
  else stats.killedMidStream++;

  // Producer resumes: identical retries of everything, then seal.
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const res = await w.store.publish({ captureId: 'crash', streamId: 'stdout', ordinal, bytes: expected[ordinal] });
    const receipt = { ordinal, byteLength: expected[ordinal].byteLength, digest: sha(expected[ordinal]) };
    if (res.status !== 'ok' || JSON.stringify(res.result) !== JSON.stringify(receipt)) fail('retry did not replay receipt', { ordinal, res });
    const acked = acks.find((a) => a.ordinal === ordinal);
    if (acked && JSON.stringify(acked.res) !== JSON.stringify(res)) fail('retry receipt differs from original', { ordinal });
  }
  const all = Buffer.concat(expected);
  const seal = await w.store.seal({ captureId: 'crash', streamId: 'stdout', segmentCount: count, byteLength: all.byteLength, digest: sha(all) });
  if (seal.status !== 'ok') fail('seal after resume refused', { seal });
  if (sealAck && JSON.stringify(sealAck.res) !== JSON.stringify(seal)) fail('seal receipt differs');
  const fin = await w.store.prefix({ captureId: 'crash', streamId: 'stdout' });
  if (fin.status !== 'ok' || !fin.result.sealed || fin.result.digest !== sha(all)) fail('final prefix wrong', { fin });
  await closeWriter(w);
  await fs.rm(rt.root, { recursive: true, force: true });
  stats.iterations++;
}
const t = stats.takeoverMs.sort((a, b) => a - b);
const summary = {
  ...stats,
  takeoverMs: { min: t[0]?.toFixed(1), p50: t[Math.floor(t.length / 2)]?.toFixed(1), max: t.at(-1)?.toFixed(1) },
  violations: stats.violations.slice(0, 10),
  violationCount: stats.violations.length,
};
console.log(JSON.stringify(summary, null, 1));
console.log(`PROBE_JSON ${JSON.stringify({ probe: 'crash-fuzz', iterations: stats.iterations, violations: stats.violations.length, killedMidStream: stats.killedMidStream, durableButUnacked: stats.durableButUnacked, sealDurableButUnacked: stats.sealDurableButUnacked, killedAfterSealAck: stats.killedAfterSealAck, killedBeforeFirstAck: stats.killedBeforeFirstAck, leftoverPending: stats.leftoverPendingEntries })}`);
