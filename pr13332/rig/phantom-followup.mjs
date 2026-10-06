// Base-arm follow-up to cancel-phantom-ref-target: what the refused
// transaction leaves behind for the writer and for the next opener.
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const arm = process.argv[2];
const CORE = `/Users/wenshao/git/pr13332-${arm}/packages/core/dist/src`;
const { createHttpManagedSessionStores } = await import(`${CORE}/managed-runtime/http-managed-session-store.js`);
const { openManagedSession } = await import(`${CORE}/managed-runtime/managed-session-assembly.js`);
const key = { tenantId: 'tenant-13332', workspaceId: 'ws-13332', sessionId: `p13332-phfu-${randomUUID().slice(0, 8)}` };
const msg = (e) => (e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e));
async function open(create) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'p13332-'));
  const stores = createHttpManagedSessionStores({ baseUrl: 'http://127.0.0.1:18332', sessionKey: key, writerId: `harness-${randomUUID().slice(0, 8)}`, leaseDurationMs: 60_000 });
  const refs = create ? {
    definitionRef: await stores.resourceStore.publish('managed-session-definition', Buffer.from('{"model":"probe"}')),
    rootSnapshotRef: await stores.resourceStore.publish('managed-session-root-snapshot', Buffer.from('{"version":1,"messages":[]}')),
    createdBy: 'hosted-harness' } : undefined;
  return openManagedSession({ runtimeBaseDir: cwd, transcriptPath: '', sessionId: key.sessionId, sessionKey: key, cwd, version: 'hosted-harness/1', workerId: 'w', activationLeaseDurationMs: 60_000, journalStore: stores.journalStore, resourceStore: stores.resourceStore, ...(refs ? { create: refs, requireNew: true } : { retainVerifiedResources: true }) });
}
let n = 0;
const cancel = (s, target) => s.authority.appendExecutionEvent(
  { operation: 'requestCancel', commandId: `c-${++n}`, sessionKey: key, contentDigest: 'd'.repeat(64) },
  (sequence) => ({ v: 1, sequence, eventId: `cancel:${n}`, sessionKey: key, kind: 'cancel.requested', occurredAt: Date.now(), payload: { requestId: `r${n}`, target, reason: 'p', requestedBy: 'p' } }),
  { class: 'trusted_entry' });
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const s = await open(true);
try { await cancel(s, { resourceId: 'not-a-ref', kind: 'not-a-ref-kind', schemaVersion: 1, byteLength: 2, digest: 'not-a-digest' }); log('phantom cancel COMMITTED'); } catch (e) { log(`phantom cancel REFUSED ${msg(e)}`); }
try { await cancel(s, { turnId: 't-ok' }); log('same writer, plain cancel afterwards COMMITTED'); } catch (e) { log(`same writer, plain cancel afterwards REFUSED ${msg(e)}`); }
try { await s.close(); log('close() resolved'); } catch (e) { log(`close() REJECTED ${msg(e)}`); }
for (const waitS of [0, 20, 45, 70]) {
  const target = t0 + waitS * 1000;
  if (Date.now() < target) await new Promise((r) => setTimeout(r, target - Date.now()));
  try { const again = await open(false); log(`reopen by a new writer OK (committed ${again.authority.committedSequence})`); await again.close(); break; } catch (e) { log(`reopen by a new writer FAILED ${msg(e)}`); }
}
process.exit(0);
