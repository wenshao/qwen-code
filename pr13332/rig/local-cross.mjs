// Cross-binary local Managed Session log: <writer> arm's authority writes a
// local log (the ordinary-host M4 engine's store), then each reader arm runs
// the cold projection (readManagedSessionRecords = session list / resume).
// usage: node local-cross.mjs <writerArm> <readerArm,...>
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const [writer, readers] = process.argv.slice(2);
const dist = (a) => `/Users/wenshao/git/pr13332-${a}/packages/core/dist/src/managed-runtime`;
const W = {
  asm: await import(`${dist(writer)}/managed-session-assembly.js`),
  res: await import(`${dist(writer)}/managed-session-resources.js`),
};
const msg = (e) => (e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e));
const ROOT = mkdtempSync('/private/tmp/claude-501/p13332-local-');
async function makeSession(name, settle) {
  const sessionId = `local-${name}-${randomUUID().slice(0, 8)}`;
  const sessionKey = { tenantId: 'local', workspaceId: 'local', sessionId };
  const runtimeBaseDir = path.join(ROOT, name, 'runtime');
  const cwd = path.join(ROOT, name, 'project');
  mkdirSync(runtimeBaseDir, { recursive: true }); mkdirSync(cwd, { recursive: true });
  const transcriptPath = path.join(runtimeBaseDir, 'chats', `${sessionId}.jsonl`);
  mkdirSync(path.dirname(transcriptPath), { recursive: true });
  const store = W.res.LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
  const session = await W.asm.openManagedSession({
    runtimeBaseDir, transcriptPath, sessionId, sessionKey, cwd, version: 'probe', workerId: 'w',
    activationLeaseDurationMs: 60_000, resourceStore: store,
    create: {
      definitionRef: await store.publish('managed-session-definition', Buffer.from('{"model":"probe"}')),
      rootSnapshotRef: await store.publish('managed-session-root-snapshot', Buffer.from('{"version":1,"messages":[]}')),
      createdBy: 'daemon',
    },
  });
  let w;
  try { await settle(session, sessionKey, store, cwd); w = 'COMMITTED'; } catch (e) { w = `REFUSED ${msg(e)}`; }
  await session.close().catch(() => undefined);
  return { name, sessionKey, runtimeBaseDir, transcriptPath, w };
}
const settled = (resultRef) => (s, key) => s.authority.appendExecutionEvent(
  { operation: 'settleTurn', commandId: `settle-${randomUUID().slice(0, 6)}`, sessionKey: key, contentDigest: 'e'.repeat(64) },
  (sequence) => ({ v: 1, sequence, eventId: 'turn:t-1', sessionKey: key, kind: 'turn.settled', occurredAt: Date.now(),
    payload: { turnId: 't-1', outcome: 'completed', stopReason: null, resultRef, usageRef: null, pendingOwnersRef: null } }),
  { class: 'authority' });
const tr = (k, cwd, mut) => { const r = { uuid: randomUUID(), parentUuid: null, sessionId: k.sessionId, timestamp: new Date().toISOString(), type: 'system', cwd, version: 'probe', subtype: 'turn_result', systemPayload: { promptId: 't-1', state: 'completed' } }; mut(r); return Buffer.from(JSON.stringify(r)); };
const bodyCase = (name, mut) => makeSession(name, async (s, k, store, cwd) => settled(await store.publish('managed-turn-result', tr(k, cwd, mut)))(s, k));
const ONLY = process.env.ONLY_BODY === '1';
const sessions = ONLY ? [
  await bodyCase('turn-result-control', () => {}),
  await bodyCase('turn-result-no-version', (r) => { delete r.version; }),
  await bodyCase('turn-result-bad-timestamp', (r) => { r.timestamp = 'not-a-date'; }),
  await bodyCase('turn-result-unknown-subtype', (r) => { r.subtype = 'turn_result_v9'; }),
  await bodyCase('turn-result-malformed-message', (r) => { r.message = 'x'; }),
] : [
  await makeSession('null-resultref', (s, k) => settled(null)(s, k)),
  await makeSession('result-body-not-a-record', async (s, k, store) =>
    settled(await store.publish('managed-turn-result', Buffer.from('{"state":"completed"}')))(s, k)),
];
for (const r of readers.split(',')) {
  const P = await import(`${dist(r)}/managed-session-message-projection.js`);
  for (const s of sessions) {
    let out;
    try { const recs = await P.readManagedSessionRecords({ transcriptPath: s.transcriptPath, runtimeBaseDir: s.runtimeBaseDir, sessionKey: s.sessionKey }); out = `OK ${recs.length} records`; }
    catch (e) { out = `FAILED ${msg(e)}`; }
    console.log(`RESULT\twriter=${writer}\t${s.name}\twrite: ${s.w}\treader=${r}\t${out}`);
  }
}
process.exit(0);
