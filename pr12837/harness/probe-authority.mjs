// Drives the real LocalManagedSessionAuthority from a built core dist:
// commits an enabled domain (control) and monitor_run, then parses the
// committed domain.committed event with its domain swapped to monitor_run.
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
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h0b-probe-'));
const runtimeBaseDir = path.join(root, 'runtime');
const transcriptPath = path.join(root, 'chats', `${sessionId}.jsonl`);
await fs.mkdir(runtimeBaseDir, { recursive: true });
await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
const store = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
const lease = await SessionWriterLease.acquire({ runtimeBaseDir, sessionId, transcriptPath });
const out = { domains: rec.MANAGED_SESSION_DOMAINS.length, enabled: [...rec.MANAGED_SESSION_ENABLED_DOMAINS] };
const cmd = (id) => ({ operation: 'renameSession', commandId: id, sessionKey, contentDigest: 'd'.repeat(64) });
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
  out.control = `session_metadata committed revision ${ok.revision} kind ${ok.recordRef.kind}`;
  const before = (await fs.readFile(transcriptPath, 'utf8')).length;
  try {
    await authority.commitDomainRecord(cmd('cmd-2'), { domain: 'monitor_run', content: {} }, { class: 'trusted_entry' });
    out.monitorCommit = 'ACCEPTED';
  } catch (e) { out.monitorCommit = `${e.constructor.name}: ${e.message}`; }
  out.journalGrewOnRefusal = (await fs.readFile(transcriptPath, 'utf8')).length !== before;
} finally { await lease.release().catch(() => {}); }
// Reader side: the real committed event, with only its domain swapped.
const lines = (await fs.readFile(transcriptPath, 'utf8')).split('\n').filter(Boolean);
let event;
const find = (v) => { if (v && typeof v === 'object') { if (v.kind === 'domain.committed' && v.payload) return v;
  for (const x of Object.values(v)) { const r = find(x); if (r) return r; } } };
for (const l of lines) { event = find(JSON.parse(l)); if (event) break; }
const parse = (e) => { try { rec.parseManagedSessionEvent(e); return 'parsed'; } catch (x) { return `${x.constructor.name}: ${x.message}`; } };
out.parseControlEvent = parse(event);
const swapped = structuredClone(event);
swapped.payload.domain = 'monitor_run';
swapped.payload.recordRef.kind = 'managed-monitor_run';
out.parseMonitorRunEvent = parse(swapped);
console.log(JSON.stringify(out, null, 2));
await fs.rm(root, { recursive: true, force: true });
