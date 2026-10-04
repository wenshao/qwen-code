// Real-stack probe of the resend consequence #13347 pins (R1-2): on a public
// Session, a refused Stage H commit leaves nothing behind, so the identical
// request is refused again (not replayed) and a new body under the same
// command id commits as new; the accepted commit, resent, is a replay.
// usage: node resend-probe.mjs <springBaseUrl> <arm> <db> <out.json>
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CORE = '/Users/wenshao/git/pr13336-head/packages/core/dist/src';
const { createHttpManagedSessionStores } = await import(`${CORE}/managed-runtime/http-managed-session-store.js`);
const { openManagedSession } = await import(`${CORE}/managed-runtime/managed-session-assembly.js`);
const { managedSessionEventsDigest, MANAGED_SESSION_LIMITS } = await import(`${CORE}/managed-runtime/managed-session-records.js`);
const { managedToolDigest } = await import(`${CORE}/tools/managed-tool-protocol.js`);

const [base, arm, db, out] = process.argv.slice(2);
const TENANT = 'tenant-13347';
const WORKSPACE = 'ws-13347';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sql = (q) => execFileSync('/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql',
  ['--no-defaults', '-uroot', '-pruntime-broker', '-h127.0.0.1', '-P13347', '-N', db, '-e', q],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const created = await fetch(`${base}/v1/agents/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-qwen-tenant-id': TENANT, 'idempotency-key': `pr13347-resend-${randomUUID()}` },
  body: JSON.stringify({ agent_id: 'qwen-code', metadata: { title: `pr13347 ${arm} resend` } }),
});
const sessionId = (await created.json()).id;
const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId };
const cwd = mkdtempSync(path.join(tmpdir(), 'pr13347-resend-'));
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

const token = `probe${randomUUID().replaceAll('-', '')}`;
const writerId = `monitor-${randomUUID().slice(0, 8)}`;
async function store(p, body) {
  const r = await fetch(`${base}/internal/managed-session-store/v1/sessions/${encodeURIComponent(sessionId)}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Qwen-Tenant-Id': TENANT, 'X-Qwen-Managed-Writer-Token': token },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
let head = (await store('/writers:acquire', { workspaceId: WORKSPACE, writerId, leaseMillis: 30_000 })).json;
let parent = null;
function request(commandId, record, occurredAt) {
  const bytes = Buffer.from(JSON.stringify(record));
  const ref = { resourceId: `res-${sha256(bytes).slice(0, 24)}`, kind: 'managed-monitor_run', schemaVersion: 1, byteLength: bytes.length, digest: sha256(bytes) };
  const seq = head.committedSequence + 1;
  const event = { v: 1, sequence: seq, eventId: `monitor_run:${seq}`, sessionKey: key, kind: 'domain.committed', occurredAt,
    payload: { domain: 'monitor_run', version: 1, operationId: commandId, recordRef: ref } };
  const marker = { transactionId: randomUUID(), commandId, operation: 'commitExtensionRecord', contentDigest: sha256(bytes),
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest: managedSessionEventsDigest([event]), previousCommitDigest: head.lastCommitDigest };
  let p = parent;
  const wrap = (subtype, body) => {
    const r = { uuid: randomUUID(), parentUuid: p, sessionId, timestamp: new Date().toISOString(), type: 'system', subtype, cwd, version: 'h3-preview/1', managedSession: body };
    p = r.uuid;
    return r;
  };
  const lines = Buffer.from(JSON.stringify(wrap('managed_session_event_v1', event)) + '\n' + JSON.stringify(wrap('managed_session_commit_v1', marker)) + '\n');
  const commitDigest = managedToolDigest(marker, MANAGED_SESSION_LIMITS.maxCommitMarkerBytes);
  return { lastUuid: p, seq, commitDigest, resourceId: ref.resourceId, body: {
    workspaceId: WORKSPACE, writerId, writerGeneration: head.writerGeneration,
    expectedJournalRevision: head.journalRevision, expectedCommittedSequence: head.committedSequence,
    transactionId: marker.transactionId, operation: marker.operation, commandId, contentDigest: marker.contentDigest,
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest: marker.eventsDigest,
    previousCommitDigest: head.lastCommitDigest, commitDigest, activationEpoch: head.activationEpoch,
    latestCheckpointResourceId: null, recordCount: 2, recordBytesBase64: lines.toString('base64'), recordDigest: sha256(lines),
    resources: [{ ...ref, bytesBase64: bytes.toString('base64') }],
  } };
}
async function send(req) {
  const r = await store('/transactions:commit', req.body);
  if (r.status === 200 && !r.json.replayed) {
    head = { ...head, journalRevision: head.journalRevision + 1, committedSequence: req.seq, lastCommitDigest: req.commitDigest };
    parent = req.lastUuid;
  }
  return r;
}
const scope = sha256(Buffer.from(`${TENANT}\u0000${sessionId}`));
const counts = (commandId, resourceId) => ({
  events: Number(sql(`SELECT COUNT(*) FROM managed_agent_event WHERE tenant_id='${TENANT}' AND session_id='${sessionId}'`)),
  taskUpdated: Number(sql(`SELECT COUNT(*) FROM managed_agent_event WHERE tenant_id='${TENANT}' AND session_id='${sessionId}' AND event_type='task.updated'`)),
  resourceRefs: Number(sql(`SELECT COUNT(*) FROM qwen_managed_session_resource_ref WHERE session_scope_key='${scope}'`)),
  refusedResource: Number(sql(`SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_scope_key='${scope}' AND resource_id='${resourceId}'`)),
  commandRows: Number(sql(`SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE tenant_id='${TENANT}' AND session_id='${sessionId}' AND command_id='${commandId}'`)),
  revisions: Number(sql(`SELECT COALESCE(SUM(revision),0) FROM qwen_managed_session_extension_record WHERE session_scope_key='${scope}'`)),
});

const fixtures = JSON.parse(readFileSync('/Users/wenshao/git/pr13347-head2/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json', 'utf8'));
const reject = fixtures.monitorChainRejectCases.find((c) => c.id === 'steps-back-to-admitted');
const steps = [];
const step = (label, r, extra = {}) => steps.push({ label, status: r.status, code: r.json?.error?.code ?? r.json?.code ?? null, replayed: r.json?.replayed ?? null, ...extra });
for (let i = 0; i < reject.accepted.length; i++) step(`accepted ${i + 1}`, await send(request(`accepted-${i}`, reject.accepted[i], 1_000 * (i + 1))));
const refused = request('rejected', reject.next, 9_000);
const before = counts('rejected', refused.resourceId);
step('refused: steps back to admitted', await send(refused));
const afterRefusal = counts('rejected', refused.resourceId);
step('identical request resent', await send(refused));
const afterResend = counts('rejected', refused.resourceId);
const retry = request('rejected', { ...fixtures.monitorChainCases[0].revisions[0].monitorRun, monitorId: 'monitor-retry' }, 9_500);
step('new body, same command id', await send(retry));
const afterRetry = counts('rejected', refused.resourceId);
step('that commit resent (control)', await send(retry));
await store('/writers:seal', { workspaceId: WORKSPACE, writerId, writerGeneration: head.writerGeneration });
const result = { arm, sessionId, reject: reject.id, steps, counts: { before, afterRefusal, afterResend, afterRetry } };
writeFileSync(out, JSON.stringify(result, null, 2));
for (const s of steps) console.log(`${arm}\t${s.label}\t${s.status}\t${s.code ?? ''}\treplayed=${s.replayed}`);
for (const [k, v] of Object.entries(result.counts)) console.log(`${arm}\tcounts ${k}\t${JSON.stringify(v)}`);
