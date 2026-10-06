// VERIFICATION RIG ONLY (PR #13355), adapted from the #13336 rig.
// R3-1 downstream probe: a Monitor admitted with an execution intent is then
// cancelled before its call was claimed. Its settling revision carries the
// execution the arm's own executionOf produced from the real Broker row
// (results/r3-1-mapping.txt). The real store either commits it (task view
// settles) or refuses it (task view stuck at pending).
//
// usage: node monitor-cancel.mjs <springBaseUrl> <arm> <execution>
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HEAD = '/Users/wenshao/git/pr13355-head';
const CORE = `${HEAD}/packages/core/dist/src`;
const { createHttpManagedSessionStores } = await import(`${CORE}/managed-runtime/http-managed-session-store.js`);
const { openManagedSession } = await import(`${CORE}/managed-runtime/managed-session-assembly.js`);
const { managedSessionEventsDigest, MANAGED_SESSION_LIMITS } = await import(`${CORE}/managed-runtime/managed-session-records.js`);
const { managedToolDigest } = await import(`${CORE}/tools/managed-tool-protocol.js`);

const [base, arm, execution] = process.argv.slice(2);
const TENANT = 'tenant-13355';
const WORKSPACE = 'ws-13355';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const headers = { 'content-type': 'application/json', 'x-qwen-tenant-id': TENANT };

// A public Session, so the task routes serve its projected view.
const created = await fetch(`${base}/v1/agents/sessions`, {
  method: 'POST',
  headers: { ...headers, 'idempotency-key': `r3-1-${randomUUID()}` },
  body: JSON.stringify({ agent_id: 'qwen-code', metadata: { title: `r3-1 ${arm}` } }),
});
const sessionId = (await created.json()).id;
const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId };

// The real authority writes the genesis.
const cwd = mkdtempSync(path.join(tmpdir(), 'r13355-mc-'));
const stores = createHttpManagedSessionStores({ baseUrl: base, sessionKey: key, writerId: 'harness-genesis', leaseDurationMs: 5_000 });
const managed = await openManagedSession({
  runtimeBaseDir: cwd, transcriptPath: '', sessionId, sessionKey: key, cwd,
  version: 'hosted-harness/1', workerId: 'probe-worker', activationLeaseDurationMs: 5_000,
  journalStore: stores.journalStore, resourceStore: stores.resourceStore,
  create: {
    definitionRef: await stores.resourceStore.publish('managed-definition', Buffer.from(JSON.stringify({ engine: 'managed', sessionId }))),
    rootSnapshotRef: await stores.resourceStore.publish('managed-root', Buffer.from(JSON.stringify({ cwd }))),
    createdBy: 'hosted-harness',
  },
  requireNew: true,
});
await managed.close();

// The Monitor's writer (H3) commits each revision as the authority would.
const token = `monitor${randomUUID().replaceAll('-', '')}`;
const writerId = `monitor-${randomUUID().slice(0, 8)}`;
async function store(p, body) {
  const r = await fetch(`${base}/internal/managed-session-store/v1/sessions/${encodeURIComponent(sessionId)}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Qwen-Tenant-Id': TENANT, 'X-Qwen-Managed-Writer-Token': token },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const acquired = await store('/writers:acquire', { workspaceId: WORKSPACE, writerId, leaseMillis: 30_000 });
let head = acquired.json;
let parent = null;
// Since H3 the store commits a Stage H body's closure: the command it cites
// must be a stored resource, so revision 1 carries it.
const argsBytes = Buffer.from(JSON.stringify({ monitor: 'r3-1' }));
const argsRef = { resourceId: `args-${randomUUID()}`, kind: 'managed-tool-args', schemaVersion: 1, byteLength: argsBytes.length, digest: sha256(argsBytes) };
async function commitRevision(n, recordIn) {
  const record = { ...recordIn, commandRef: argsRef };
  const bytes = Buffer.from(JSON.stringify(record));
  const ref = { resourceId: randomUUID(), kind: 'managed-monitor_run', schemaVersion: 1, byteLength: bytes.length, digest: sha256(bytes) };
  const seq = head.committedSequence + 1;
  const commandId = `monitor-${n}-${randomUUID().slice(0, 6)}`;
  const event = { v: 1, sequence: seq, eventId: `monitor_run:${n}`, sessionKey: key, kind: 'domain.committed', occurredAt: Date.now(),
    payload: { domain: 'monitor_run', version: 1, operationId: commandId, recordRef: ref } };
  const marker = { transactionId: randomUUID(), commandId, operation: 'commitExtensionRecord', contentDigest: sha256(bytes),
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest: managedSessionEventsDigest([event]), previousCommitDigest: head.lastCommitDigest };
  const wrap = (subtype, body) => {
    const r = { uuid: randomUUID(), parentUuid: parent, sessionId, timestamp: new Date().toISOString(), type: 'system', subtype, cwd, version: 'h3-preview/1', managedSession: body };
    parent = r.uuid;
    return r;
  };
  const lines = Buffer.from(JSON.stringify(wrap('managed_session_event_v1', event)) + '\n' + JSON.stringify(wrap('managed_session_commit_v1', marker)) + '\n');
  const commitDigest = managedToolDigest(marker, MANAGED_SESSION_LIMITS.maxCommitMarkerBytes);
  const r = await store('/transactions:commit', {
    workspaceId: WORKSPACE, writerId, writerGeneration: head.writerGeneration,
    expectedJournalRevision: head.journalRevision, expectedCommittedSequence: head.committedSequence,
    transactionId: marker.transactionId, operation: marker.operation, commandId, contentDigest: marker.contentDigest,
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest: marker.eventsDigest,
    previousCommitDigest: head.lastCommitDigest, commitDigest, activationEpoch: head.activationEpoch,
    latestCheckpointResourceId: null, recordCount: 2, recordBytesBase64: lines.toString('base64'), recordDigest: sha256(lines),
    resources: [{ ...ref, bytesBase64: bytes.toString('base64') }, ...(n === 1 ? [{ ...argsRef, bytesBase64: argsBytes.toString('base64') }] : [])],
  });
  if (r.status === 200) {
    head = { ...head, journalRevision: head.journalRevision + 1, committedSequence: seq, lastCommitDigest: commitDigest };
  }
  return r;
}
async function task() {
  const r = await fetch(`${base}/v1/agents/sessions/${sessionId}/tasks`, { headers });
  const data = (await r.json()).data ?? [];
  return data.map((t) => `${t.kind}:${t.state}${t.settled_at ? '@settled' : ''}`).join(',') || '(none)';
}

const fixtures = JSON.parse(readFileSync(`${HEAD}/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json`, 'utf8'));
const admitted = fixtures.monitorChainCases[0].revisions[0].monitorRun;
const first = await commitRevision(1, admitted);
console.log(`${arm}\trevision 1 (admitted, execution intent)\tcommit=${first.status}\ttask=${await task()}`);
const settling = structuredClone(admitted);
settling.run.state = 'cancelled';
settling.run.execution = execution;
settling.stopReason = 'stop_requested';
const second = await commitRevision(2, settling);
console.log(`${arm}\trevision 2 (cancelled, execution ${execution})\tcommit=${second.status}\t${JSON.stringify(second.json).slice(0, 260)}\ttask=${await task()}`);
await store('/writers:seal', { workspaceId: WORKSPACE, writerId, writerGeneration: head.writerGeneration });
console.log(`RESULT\t${arm}\texecution=${execution}\tsettlingCommit=${second.status}\tfinalTask=${await task()}\tsession=${sessionId}`);
