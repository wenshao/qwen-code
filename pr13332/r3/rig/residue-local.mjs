// Round 3 (review R3-6) on the local store: does a message body the fence
// refuses stay on disk? Counts files under the session's runtime dir around
// one refused commit, and lists what appeared.
//
// usage: node residue-local.mjs <arm> [resultsFile]
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const [arm, resultsFile] = process.argv.slice(2);
const CORE = `/Users/wenshao/git/pr13332-${arm}/packages/core/dist/src/managed-runtime`;
const { openManagedSession } = await import(`${CORE}/managed-session-assembly.js`);
const { LocalManagedSessionResourceStore } = await import(`${CORE}/managed-session-resources.js`);

const key = { tenantId: 'tenant-13332', workspaceId: 'ws-13332', sessionId: `residue-${arm}-${randomUUID().slice(0, 8)}` };
const root = mkdtempSync('/private/tmp/claude-501/p13332-residue-');
const cwd = path.join(root, 'project');
const runtimeBaseDir = path.join(root, 'runtime');
mkdirSync(cwd, { recursive: true });
const transcriptPath = path.join(runtimeBaseDir, 'chats', `${key.sessionId}.jsonl`);
mkdirSync(path.dirname(transcriptPath), { recursive: true });
const store = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey: key });
const session = await openManagedSession({
  runtimeBaseDir, transcriptPath, sessionId: key.sessionId, sessionKey: key, cwd, version: 'probe', workerId: 'residue', activationLeaseDurationMs: 60_000, resourceStore: store,
  create: {
    definitionRef: await store.publish('managed-session-definition', Buffer.from('{"model":"probe"}')),
    rootSnapshotRef: await store.publish('managed-session-root-snapshot', Buffer.from('{"version":1,"messages":[]}')),
    createdBy: 'daemon',
  },
});
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const snapshot = () => new Map(walk(runtimeBaseDir).map((f) => [f, statSync(f).size]));
const user = (text) => ({ uuid: randomUUID(), parentUuid: null, sessionId: key.sessionId, timestamp: new Date().toISOString(), type: 'user', cwd, version: 'probe', message: { role: 'user', parts: [{ text }] } });
await session.sink.write(user('warm-up'));
const before = snapshot();
let out;
try { const r = user('z'.repeat(100 * 1024)); delete r.cwd; await session.sink.write(r); out = 'COMMITTED'; }
catch (e) { out = `REFUSED ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`; }
const after = snapshot();
const added = [...after].filter(([f]) => !before.has(f)).map(([f, size]) => `${path.relative(runtimeBaseDir, f)} (${size} B)`);
await session.close().catch(() => undefined);
const row = { arm, store: 'local', out, filesBefore: before.size, filesAfter: after.size, added };
console.log(JSON.stringify(row));
if (resultsFile) appendFileSync(resultsFile, JSON.stringify(row) + '\n');
process.exit(0);
