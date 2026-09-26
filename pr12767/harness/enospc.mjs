// Real ENOSPC: the runtime base lives on a small APFS disk image. Publish
// 4 MiB segments until the disk is full, then check that the failure is not
// acknowledged, nothing half-written is visible, the store keeps working
// after space is freed, and an identical retry of the failed ordinal succeeds.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LocalToolResultSegmentStore, closeWriter, mkRuntime, openWriter, sessionKey, sha } from './lib.mjs';

const BASE = process.argv[2];
const rt = await mkRuntime(BASE, 'enospc');
const w = await openWriter(rt);
const SIZE = 4 * 1024 * 1024;
const chunk = (i) => Buffer.alloc(SIZE, i % 251);
const log = [];
let failedAt;
let failure;
for (let ordinal = 0; ordinal < 64; ordinal++) {
  try {
    const r = await w.store.publish({ captureId: 'full', streamId: 'stdout', ordinal, bytes: chunk(ordinal) });
    if (r.status !== 'ok') { log.push(['refused', ordinal, r]); break; }
  } catch (e) {
    failedAt = ordinal;
    failure = `${e.code ?? ''} ${e.message}`.slice(0, 160);
    break;
  }
}
log.push(['first failure', failedAt, failure]);
const pre = await w.store.prefix({ captureId: 'full', streamId: 'stdout' });
log.push(['prefix while full', pre.status === 'ok' ? { segmentCount: pre.result.segmentCount, sealed: pre.result.sealed } : pre]);
const stream = path.join(w.store.root, 'capture-full', 'stream-stdout');
const names = await fs.readdir(stream);
log.push(['failed ordinal visible as segment dir', names.includes(`segment-${String(failedAt).padStart(5, '0')}`)]);
log.push(['.pending entries left in stream dir', names.filter((n) => n.startsWith('.pending-')).length]);
const rootNames = await fs.readdir(w.store.root);
log.push(['.pending entries left in namespace', rootNames.filter((n) => n.startsWith('.pending-')).length]);
// A conflicting candidate while full: quarantine needs space too.
try {
  const r = await w.store.publish({ captureId: 'full', streamId: 'stdout', ordinal: 0, bytes: Buffer.alloc(SIZE, 7) });
  log.push(['conflicting publish while full', r]);
} catch (e) {
  log.push(['conflicting publish while full threw', `${e.code ?? ''} ${e.message}`.slice(0, 120)]);
}
// Free space: remove the filler file the caller created next to the runtime.
await fs.rm(path.join(BASE, 'filler.bin'), { force: true });
const retry = await w.store.publish({ captureId: 'full', streamId: 'stdout', ordinal: failedAt, bytes: chunk(failedAt) });
log.push(['identical retry of failed ordinal after freeing space', retry.status, retry.result?.ordinal]);
const count = failedAt + 1;
const all = Buffer.concat(Array.from({ length: count }, (_, i) => chunk(i)));
const seal = await w.store.seal({ captureId: 'full', streamId: 'stdout', segmentCount: count, byteLength: all.byteLength, digest: sha(all) });
log.push(['seal after recovery', seal.status]);
const reader = await LocalToolResultSegmentStore.openReadOnly({ runtimeBaseDir: rt.runtimeBaseDir, sessionKey });
const ro = await reader.prefix({ captureId: 'full', streamId: 'stdout' });
await reader.close();
log.push(['read-only prefix after recovery', ro.status, ro.result?.segmentCount, ro.result?.sealed, ro.result?.digest === sha(all)]);
await closeWriter(w);
console.log(JSON.stringify(log, null, 1));
console.log(`PROBE_JSON ${JSON.stringify({ probe: 'enospc', failedAt, failure, recovered: retry.status === 'ok' && seal.status === 'ok' && ro.result?.sealed === true })}`);
