// Drives the real LocalManagedSessionAuthority from a built core dist to
// check the acceptance criterion PR #12863 rewrites: commitDomainRecord
// refuses monitor_run, while the generic appendExecution/appendExecutionEvent
// paths and a re-open (replay) take a domain.committed event naming it.
// Usage: node probe-authority2.mjs <packages/core/dist>
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const dist = path.resolve(process.argv[2]);
const m = (p) => import(path.join(dist, 'src', p));
const { LocalManagedSessionAuthority } = await m('managed-runtime/managed-session-authority.js');
const { LocalManagedSessionResourceStore } = await m('managed-runtime/managed-session-resources.js');
const { SessionWriterLease } = await m('services/session-writer-lease.js');
const rec = await m('managed-runtime/managed-session-records.js');

const sessionId = '550e8400-e29b-41d4-a716-446655440000';
const sessionKey = { tenantId: 'tenant-1', workspaceId: 'workspace-1', sessionId };
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h0b-probe2-'));
const runtimeBaseDir = path.join(root, 'runtime');
const transcriptPath = path.join(root, 'chats', `${sessionId}.jsonl`);
await fs.mkdir(runtimeBaseDir, { recursive: true });
await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
const store = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
const out = {
  dist: path.relative(process.cwd(), dist),
  indexHasMonitorRun: rec.MANAGED_SESSION_DOMAINS.includes('monitor_run'),
  enabled: rec.MANAGED_SESSION_ENABLED_DOMAINS.join(','),
};
const cmd = (id) => ({ operation: 'renameSession', commandId: id, sessionKey, contentDigest: 'd'.repeat(64) });
const err = (e) => `REFUSED ${e.constructor.name}: ${e.message}`;
const journalLines = async () => (await fs.readFile(transcriptPath, 'utf8')).split('\n').filter(Boolean).length;

async function domainEvent(authority, sequence, domain, revision) {
  const recordRef = await store.publish(`managed-${domain}`, Buffer.from(JSON.stringify({ probe: revision })));
  return {
    v: rec.MANAGED_SESSION_FORMAT_VERSION ?? 1,
    sequence,
    eventId: `${domain}:${revision}`,
    sessionKey,
    kind: 'domain.committed',
    occurredAt: Date.now(),
    payload: { domain, version: 1, operationId: `op-${revision}`, recordRef },
  };
}

let lease = await SessionWriterLease.acquire({ runtimeBaseDir, sessionId, transcriptPath });
try {
  const authority = await LocalManagedSessionAuthority.open({
    lease, sessionKey, cwd: '/workspace', version: 'probe', resources: store,
    create: {
      definitionRef: await store.publish('managed-definition', Buffer.from('{}')),
      rootSnapshotRef: await store.publish('managed-root', Buffer.from('{}')),
      createdBy: 'daemon',
    },
  });
  const ok = await authority.commitDomainRecord(cmd('cmd-1'),
    { domain: 'session_metadata', content: { title: 't', titleSource: 'manual' } }, { class: 'trusted_entry' });
  out['1 commitDomainRecord(session_metadata)'] = `committed revision ${ok.revision}`;
  let before = await journalLines();
  try {
    await authority.commitDomainRecord(cmd('cmd-2'), { domain: 'monitor_run', content: {} }, { class: 'trusted_entry' });
    out['2 commitDomainRecord(monitor_run)'] = 'ACCEPTED';
  } catch (e) { out['2 commitDomainRecord(monitor_run)'] = err(e); }
  out['2 journal lines added'] = (await journalLines()) - before;

  const seq = () => authority.events.length + 1;
  before = await journalLines();
  try {
    const r = await authority.appendExecution(cmd('cmd-3'), [await domainEvent(authority, seq(), 'monitor_run', 1)], { class: 'harness' });
    out['3 appendExecution(monitor_run, harness)'] = `ACCEPTED sequence ${r.firstSequence}`;
  } catch (e) { out['3 appendExecution(monitor_run, harness)'] = err(e); }
  try {
    const r = await authority.appendExecution(cmd('cmd-4'), [await domainEvent(authority, seq(), 'monitor_run', 1)], { class: 'trusted_entry' });
    out['4 appendExecution(monitor_run, trusted_entry)'] = `ACCEPTED sequence ${r.firstSequence}`;
  } catch (e) { out['4 appendExecution(monitor_run, trusted_entry)'] = err(e); }
  try {
    const event = await domainEvent(authority, 0, 'monitor_run', 2);
    const r = await authority.appendExecutionEvent(cmd('cmd-5'), (sequence) => ({ ...event, sequence }), { class: 'trusted_entry' });
    out['5 appendExecutionEvent(monitor_run, trusted_entry)'] = `ACCEPTED sequence ${r.firstSequence}`;
  } catch (e) { out['5 appendExecutionEvent(monitor_run, trusted_entry)'] = err(e); }
  try {
    const r = await authority.appendExecution(cmd('cmd-6'), [await domainEvent(authority, seq(), 'team_state', 1)], { class: 'trusted_entry' });
    out['6 appendExecution(team_state, trusted_entry)'] = `ACCEPTED sequence ${r.firstSequence}`;
  } catch (e) { out['6 appendExecution(team_state, trusted_entry)'] = err(e); }
  out['3-6 journal lines added'] = (await journalLines()) - before;
} finally { await lease.release().catch(() => {}); }

// Replay: re-open the same Session from its journal.
lease = await SessionWriterLease.acquire({ runtimeBaseDir, sessionId, transcriptPath });
try {
  const reopened = await LocalManagedSessionAuthority.open({ lease, sessionKey, cwd: '/workspace', version: 'probe', resources: store });
  const domains = reopened.events.filter((e) => e.kind === 'domain.committed').map((e) => `${e.payload.domain}:${e.eventId.split(':')[1]}`);
  out['7 re-open (replay)'] = `OPENED, domain events: ${domains.join(', ')}`;
} catch (e) { out['7 re-open (replay)'] = err(e); } finally { await lease.release().catch(() => {}); }
console.log(JSON.stringify(out, null, 2));
await fs.rm(root, { recursive: true, force: true });
