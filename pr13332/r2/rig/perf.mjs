// Per-commit cost of the reader-facing commit fence (R1-16 et al.):
// production sink.write of user messages of growing size, timed per commit,
// over the real HTTP Session Store (Spring + MySQL 8.4) or the local store.
// On arms that have the fence, its own time is measured by wrapping the
// private assertReaderFacingBody on the prototype.
//
// usage: node perf.mjs <arm> <http|local> <resultsFile>
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

const [arm, storeKind, resultsFile] = process.argv.slice(2);
const CORE = `/Users/wenshao/git/pr13332-${arm}/packages/core/dist/src/managed-runtime`;
const { createHttpManagedSessionStores } = await import(`${CORE}/http-managed-session-store.js`);
const { openManagedSession } = await import(`${CORE}/managed-session-assembly.js`);
const { LocalManagedSessionResourceStore } = await import(`${CORE}/managed-session-resources.js`);
const { LocalManagedSessionAuthority } = await import(`${CORE}/managed-session-authority.js`);

let fenceMs = 0;
const proto = LocalManagedSessionAuthority.prototype;
const hasFence = typeof proto.assertReaderFacingBody === 'function';
if (hasFence) {
  const orig = proto.assertReaderFacingBody;
  proto.assertReaderFacingBody = async function (...a) {
    const t = performance.now();
    try { return await orig.apply(this, a); } finally { fenceMs += performance.now() - t; }
  };
}

const key = { tenantId: 'tenant-13332', workspaceId: 'ws-13332', sessionId: `perf-${arm}-${storeKind}-${randomUUID().slice(0, 8)}` };
const root = mkdtempSync('/private/tmp/claude-501/p13332-perf-');
const cwd = path.join(root, 'project');
const runtimeBaseDir = path.join(root, 'runtime');
mkdirSync(cwd, { recursive: true }); mkdirSync(runtimeBaseDir, { recursive: true });
let session;
if (storeKind === 'http') {
  const stores = createHttpManagedSessionStores({ baseUrl: process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:18332', sessionKey: key, writerId: `perf-${randomUUID().slice(0, 8)}`, leaseDurationMs: 60_000 });
  session = await openManagedSession({
    runtimeBaseDir, transcriptPath: '', sessionId: key.sessionId, sessionKey: key, cwd, version: 'hosted-harness/1', workerId: 'perf', activationLeaseDurationMs: 60_000,
    journalStore: stores.journalStore, resourceStore: stores.resourceStore, requireNew: true,
    create: {
      definitionRef: await stores.resourceStore.publish('managed-session-definition', Buffer.from('{"model":"perf"}')),
      rootSnapshotRef: await stores.resourceStore.publish('managed-session-root-snapshot', Buffer.from('{"version":1,"messages":[]}')),
      createdBy: 'hosted-harness',
    },
  });
} else {
  const transcriptPath = path.join(runtimeBaseDir, 'chats', `${key.sessionId}.jsonl`);
  mkdirSync(path.dirname(transcriptPath), { recursive: true });
  const store = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey: key });
  session = await openManagedSession({
    runtimeBaseDir, transcriptPath, sessionId: key.sessionId, sessionKey: key, cwd, version: 'probe', workerId: 'perf', activationLeaseDurationMs: 60_000, resourceStore: store,
    create: {
      definitionRef: await store.publish('managed-session-definition', Buffer.from('{"model":"perf"}')),
      rootSnapshotRef: await store.publish('managed-session-root-snapshot', Buffer.from('{"version":1,"messages":[]}')),
      createdBy: 'daemon',
    },
  });
}
const user = (text) => ({ uuid: randomUUID(), parentUuid: null, sessionId: key.sessionId, timestamp: new Date().toISOString(), type: 'user', cwd, version: 'hosted-harness/1', message: { role: 'user', parts: [{ text }] } });
const PLAN = [[1024, 30], [32 * 1024, 30], [63 * 1024, 30], [200 * 1024, 15], [1024 * 1024, 8], [4 * 1024 * 1024, 4]];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const [size, n] of PLAN) {
  const text = 'y'.repeat(size);
  for (let w = 0; w < 2; w++) await session.sink.write(user(text));
  const totals = [], fences = [];
  let error;
  for (let i = 0; i < n; i++) {
    const f0 = fenceMs, t0 = performance.now();
    try { await session.sink.write(user(text)); } catch (e) { error = e instanceof Error ? e.message : String(e); break; }
    totals.push(performance.now() - t0); fences.push(fenceMs - f0);
  }
  const row = { arm, store: storeKind, sizeKiB: size / 1024, n: totals.length, commitMedianMs: +median(totals)?.toFixed(2), fenceMedianMs: hasFence ? +median(fences)?.toFixed(3) : null, error: error ?? null };
  console.log(JSON.stringify(row));
  appendFileSync(resultsFile, JSON.stringify(row) + '\n');
  if (error) break;
}
await session.close().catch(() => undefined);
process.exit(0);
