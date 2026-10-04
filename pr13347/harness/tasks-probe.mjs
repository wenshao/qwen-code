// Real-stack probe of the task routes #13347 documents, over HTTP against a
// running Spring Managed Agent Server on MySQL 8.4.7.
//   Session A: public Session; the real TypeScript authority writes its
//     genesis through the Session Store HTTP route; a writer then commits the
//     shared fixture chain monitorChainCases[0] (occurredAt from the fixture)
//     and a second Monitor's first revision, as H3 will.
//   Session B: public Session with no Stage H record.
// usage: node tasks-probe.mjs <springBaseUrl> <arm> <out.json>
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CORE = '/Users/wenshao/git/pr13336-head/packages/core/dist/src';
const { createHttpManagedSessionStores } = await import(`${CORE}/managed-runtime/http-managed-session-store.js`);
const { openManagedSession } = await import(`${CORE}/managed-runtime/managed-session-assembly.js`);
const { managedSessionEventsDigest, MANAGED_SESSION_LIMITS } = await import(`${CORE}/managed-runtime/managed-session-records.js`);
const { managedToolDigest } = await import(`${CORE}/tools/managed-tool-protocol.js`);

const [base, arm, out] = process.argv.slice(2);
const TENANT = 'tenant-13347';
const OTHER = 'tenant-13347-other';
const WORKSPACE = 'ws-13347';
const WS = `${base}/api/agent/web-shell/v1`;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const H = (tenant = TENANT) => ({ 'content-type': 'application/json', 'x-qwen-tenant-id': tenant });

async function call(method, url, { tenant = TENANT, body, extra = {} } = {}) {
  const r = await fetch(url, { method, headers: { ...H(tenant), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json };
}
async function createSession(label) {
  const r = await call('POST', `${base}/v1/agents/sessions`, {
    body: { agent_id: 'qwen-code', metadata: { title: `pr13347 ${arm} ${label}` } },
    extra: { 'idempotency-key': `pr13347-${label}-${randomUUID()}` } });
  if (r.status >= 300) throw new Error(`create ${label}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.id;
}

const A = await createSession('A');
const B = await createSession('B');
const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId: A };

// The real authority writes A's genesis.
const cwd = mkdtempSync(path.join(tmpdir(), 'pr13347-'));
const stores = createHttpManagedSessionStores({ baseUrl: base, sessionKey: key, writerId: 'harness-genesis', leaseDurationMs: 5_000 });
const managed = await openManagedSession({
  runtimeBaseDir: cwd, transcriptPath: '', sessionId: A, sessionKey: key, cwd,
  version: 'hosted-harness/1', workerId: 'probe-worker', activationLeaseDurationMs: 5_000,
  journalStore: stores.journalStore, resourceStore: stores.resourceStore,
  create: {
    definitionRef: await stores.resourceStore.publish('managed-definition', Buffer.from(JSON.stringify({ engine: 'managed', sessionId: A }))),
    rootSnapshotRef: await stores.resourceStore.publish('managed-root', Buffer.from(JSON.stringify({ cwd }))),
    createdBy: 'hosted-harness',
  },
  requireNew: true,
});
await managed.close();

// A Stage H writer commits the shared chain revision by revision.
const token = `probe${randomUUID().replaceAll('-', '')}`;
const writerId = `monitor-${randomUUID().slice(0, 8)}`;
const store = (p, body) => call('POST', `${base}/internal/managed-session-store/v1/sessions/${encodeURIComponent(A)}${p}`,
  { body, extra: { accept: 'application/json', 'X-Qwen-Managed-Writer-Token': token } });
let head = (await store('/writers:acquire', { workspaceId: WORKSPACE, writerId, leaseMillis: 30_000 })).json;
let parent = null;
async function commitRevision(commandId, record, occurredAt) {
  const bytes = Buffer.from(JSON.stringify(record));
  const ref = { resourceId: randomUUID(), kind: 'managed-monitor_run', schemaVersion: 1, byteLength: bytes.length, digest: sha256(bytes) };
  const seq = head.committedSequence + 1;
  const event = { v: 1, sequence: seq, eventId: `monitor_run:${seq}`, sessionKey: key, kind: 'domain.committed', occurredAt,
    payload: { domain: 'monitor_run', version: 1, operationId: commandId, recordRef: ref } };
  const marker = { transactionId: randomUUID(), commandId, operation: 'commitExtensionRecord', contentDigest: sha256(bytes),
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest: managedSessionEventsDigest([event]), previousCommitDigest: head.lastCommitDigest };
  const wrap = (subtype, body) => {
    const r = { uuid: randomUUID(), parentUuid: parent, sessionId: A, timestamp: new Date().toISOString(), type: 'system', subtype, cwd, version: 'h3-preview/1', managedSession: body };
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
    resources: [{ ...ref, bytesBase64: bytes.toString('base64') }],
  });
  if (r.status === 200) head = { ...head, journalRevision: head.journalRevision + 1, committedSequence: seq, lastCommitDigest: commitDigest };
  return r.status;
}
const fixtures = JSON.parse(readFileSync('/Users/wenshao/git/pr13347-head/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json', 'utf8'));
const chain = fixtures.monitorChainCases[0].revisions;
const commits = [];
for (let i = 0; i < chain.length; i++) commits.push(await commitRevision(`monitor-1:${i}`, chain[i].monitorRun, chain[i].occurredAt));
commits.push(await commitRevision('monitor-2:0', { ...chain[0].monitorRun, monitorId: 'monitor-2' }, 99_000));
await store('/writers:seal', { workspaceId: WORKSPACE, writerId, writerGeneration: head.writerGeneration });
const finalView = chain.at(-1).view;

// The probes.
const rows = [];
const probe = (id, what, res, pick, expect) => {
  const got = pick(res);
  rows.push({ id, what, status: res.status, got, expect, ok: JSON.stringify(got) === JSON.stringify(expect) });
};
const errCode = (r) => r.json?.error?.code ?? r.json?.code ?? null;

const pub = await call('GET', `${base}/v1/agents/sessions/${A}`);
probe('P1', 'Public Session A carries capabilities.tasks', pub, (r) => [r.status, r.json?.capabilities?.tasks], [200, true]);
const ws = await call('POST', `${WS}/sessions/get`, { body: { sessionId: A } });
probe('P2', 'WebShell Session A carries the capabilities object (now required)', ws, (r) => [r.status, 'capabilities' in (r.json ?? {}), r.json?.capabilities?.tasks], [200, true, true]);
const page = await call('GET', `${base}/v1/agents/sessions/${A}/tasks?limit=1`);
probe('P3', 'A lists newest first: the pending Monitor, with a cursor', page, (r) => [r.status, r.json?.data?.[0]?.state, r.json?.has_more], [200, 'pending', true]);
const rest = await call('GET', `${base}/v1/agents/sessions/${A}/tasks?cursor=${encodeURIComponent(page.json?.next_cursor ?? '')}`);
const t = rest.json?.data?.[0] ?? {};
probe('P4', 'A page 2: settled Monitor body equals the fixture final view', rest,
  (r) => [r.status, t.kind, t.state, t.created_at, t.started_at, t.settled_at, t.runtime_state ?? null, t.definition_revision ?? null, r.json?.has_more],
  [200, 'monitor', finalView.state, finalView.createdAt, finalView.startedAt, finalView.settledAt, null, null, false]);
const settledId = t.id;
const detail = await call('GET', `${base}/v1/agents/sessions/${A}/tasks/${settledId}`);
probe('P5', 'A detail of its settled task', detail, (r) => [r.status, r.json?.state, r.json?.settled_at], [200, finalView.state, finalView.settledAt]);
const wsDetail = await call('POST', `${WS}/tasks/get`, { body: { sessionId: A, taskId: settledId } });
probe('P6', 'WebShell detail of A\'s settled task', wsDetail, (r) => [r.status, r.json?.state, r.json?.settledAt], [200, finalView.state, finalView.settledAt]);
const empty = await call('GET', `${base}/v1/agents/sessions/${B}/tasks`);
probe('P7', 'B (no Stage H record) lists no task', empty, (r) => [r.status, r.json?.data?.length, r.json?.has_more], [200, 0, false]);
const cross = await call('GET', `${base}/v1/agents/sessions/${B}/tasks/${settledId}`);
probe('P8', 'B asked for A\'s (well-formed) task id: documented 404', cross, (r) => [r.status, errCode(r)], [404, 'task_not_found']);
const wsCross = await call('POST', `${WS}/tasks/get`, { body: { sessionId: B, taskId: settledId } });
probe('P9', 'WebShell: B asked for A\'s task id: documented 404', wsCross, (r) => [r.status, errCode(r)], [404, 'task_not_found']);
const wsEmpty = await call('POST', `${WS}/tasks/query`, { body: { sessionId: B } });
probe('P10', 'WebShell: B task page is empty', wsEmpty, (r) => [r.status, (r.json?.data ?? r.json?.tasks ?? []).length, r.json?.hasMore ?? r.json?.has_more], [200, 0, false]);
const otherTenant = await call('GET', `${base}/v1/agents/sessions/${A}/tasks`, { tenant: OTHER });
probe('P11', 'Another tenant listing A\'s tasks', otherTenant, (r) => [r.status, errCode(r)], [404, 'session_not_found']);
const malformed = await call('GET', `${base}/v1/agents/sessions/${B}/tasks/task_missing`);
probe('P12', 'Malformed task id (format short-circuit)', malformed, (r) => [r.status, errCode(r)], [404, 'task_not_found']);

const result = { arm, base, sessionA: A, sessionB: B, commits, settledId, finalView, rows };
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`${arm} commits=${commits.join(',')} A=${A} B=${B}`);
for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'DIFF'} ${r.id} ${r.what}: got ${JSON.stringify(r.got)}${r.ok ? '' : ` expected ${JSON.stringify(r.expect)}`}`);
