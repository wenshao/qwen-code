// Upgrade probe: a Session written under the base jar (its Monitor revision
// announced task.updated onto the event stream and split a message) is
// served by the head jar after V35. Old events stay readable; the next
// Monitor revisions commit and announce on the outbox only.
//
// usage: node upgrade.mjs <springBaseUrl> <db>
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HEAD = '/Users/wenshao/git/pr13336-head';
const CORE = `${HEAD}/packages/core/dist/src`;
const { managedSessionEventsDigest, MANAGED_SESSION_LIMITS } = await import(`${CORE}/managed-runtime/managed-session-records.js`);
const { managedToolDigest } = await import(`${CORE}/tools/managed-tool-protocol.js`);
const [base, db] = process.argv.slice(2);
const sql = (q) => execFileSync('/Users/wenshao/git/pr13336-rig/sql.sh', ['-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const [sessionId, workspaceId, tenantId] = sql(`SELECT session_id, workspace_id, tenant_id FROM ${db}.qwen_managed_session_journal_head`).split('\t');
const headers = { 'x-qwen-tenant-id': tenantId, 'x-qwen-e2e-trusted-actor': 'e2e-actor' };
const get = async (p) => (await fetch(`${base}/v1/agents/sessions/${sessionId}${p}`, { headers })).json();
const show = async (when) => {
  const events = (await get('/events?after=0&limit=1000')).data.map((e) => `${e.sequence}:${e.type}`).join(' ');
  const items = (await get('/items?limit=100')).data.filter((i) => i.role === 'assistant').map((i) => JSON.stringify(i.content.map((p) => p.text)));
  const tasks = (await get('/tasks')).data.map((t) => `${t.kind}:${t.state}`).join(',');
  const outbox = sql(`SELECT GROUP_CONCAT(CONCAT(task_state,'@rev',revision) ORDER BY revision) FROM ${db}.qwen_managed_session_task_event WHERE session_id='${sessionId}'`);
  console.log(`${when}\n  events: ${events}\n  assistant parts: ${items.join(' ')}\n  tasks: ${tasks}\n  outbox: ${outbox}`);
};
await show('after V35, before any new commit');

// The Monitor's next revisions follow the stored revision 1, keeping its
// fixed fields (commandRef included) as the record contract requires.
const stored = JSON.parse(Buffer.from(sql(`SELECT HEX(r.inline_bytes) FROM ${db}.qwen_managed_session_resource r WHERE r.kind='managed-monitor_run' LIMIT 1`), 'hex').toString('utf8'));
const fixtures = JSON.parse(readFileSync(`${HEAD}/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json`, 'utf8'));
const chain = fixtures.monitorChainCases[0].revisions;

const token = `upgrade${randomUUID().replaceAll('-', '')}`;
const writerId = `upgrade-${randomUUID().slice(0, 8)}`;
async function store(p, body) {
  const r = await fetch(`${base}/internal/managed-session-store/v1/sessions/${encodeURIComponent(sessionId)}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Qwen-Tenant-Id': tenantId, 'X-Qwen-Managed-Writer-Token': token },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const acquired = await store('/writers:acquire', { workspaceId, writerId, leaseMillis: 30_000 });
console.log(`acquire ${acquired.status}`);
let head = acquired.json;
const key = { tenantId, workspaceId, sessionId };
let parent = null;
async function commitRevision(n, record) {
  const bytes = Buffer.from(JSON.stringify(record));
  const ref = { resourceId: randomUUID(), kind: 'managed-monitor_run', schemaVersion: 1, byteLength: bytes.length, digest: sha256(bytes) };
  const seq = head.committedSequence + 1;
  const commandId = `upgrade-${n}-${randomUUID().slice(0, 6)}`;
  const event = { v: 1, sequence: seq, eventId: `monitor_run:${n}`, sessionKey: key, kind: 'domain.committed', occurredAt: Date.now(),
    payload: { domain: 'monitor_run', version: 1, operationId: commandId, recordRef: ref } };
  const marker = { transactionId: randomUUID(), commandId, operation: 'commitExtensionRecord', contentDigest: sha256(bytes),
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest: managedSessionEventsDigest([event]), previousCommitDigest: head.lastCommitDigest };
  const wrap = (subtype, body) => {
    const r = { uuid: randomUUID(), parentUuid: parent, sessionId, timestamp: new Date().toISOString(), type: 'system', subtype, cwd: '/workspace', version: 'h3-preview/1', managedSession: body };
    parent = r.uuid;
    return r;
  };
  const lines = Buffer.from(JSON.stringify(wrap('managed_session_event_v1', event)) + '\n' + JSON.stringify(wrap('managed_session_commit_v1', marker)) + '\n');
  const commitDigest = managedToolDigest(marker, MANAGED_SESSION_LIMITS.maxCommitMarkerBytes);
  const r = await store('/transactions:commit', {
    workspaceId, writerId, writerGeneration: head.writerGeneration,
    expectedJournalRevision: head.journalRevision, expectedCommittedSequence: head.committedSequence,
    transactionId: marker.transactionId, operation: marker.operation, commandId, contentDigest: marker.contentDigest,
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest: marker.eventsDigest,
    previousCommitDigest: head.lastCommitDigest, commitDigest, activationEpoch: head.activationEpoch,
    latestCheckpointResourceId: null, recordCount: 2, recordBytesBase64: lines.toString('base64'), recordDigest: sha256(lines),
    resources: [{ ...ref, bytesBase64: bytes.toString('base64') }],
  });
  if (r.status === 200) head = { ...head, journalRevision: head.journalRevision + 1, committedSequence: seq, lastCommitDigest: commitDigest };
  console.log(`revision ${n} (${record.run.state}/${record.run.execution}) commit=${r.status} ${r.status === 200 ? '' : JSON.stringify(r.json).slice(0, 200)}`);
}
for (const n of [2, 3]) {
  await commitRevision(n, { ...chain[n - 1].monitorRun, commandRef: stored.commandRef });
}
await store('/writers:seal', { workspaceId, writerId, writerGeneration: head.writerGeneration });
await show('after two more Monitor revisions under the head jar');
