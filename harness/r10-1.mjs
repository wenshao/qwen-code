/**
 * R10-1: with `resolveConflicts: true`, what does conflict repair do to an
 * ACTIVE copy whose ownership cannot be derived from its records?
 * Real filesystem, real archiveDaemonSessions.
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.TREE_ROOT;
const imp = (r) => import(pathToFileURL(path.join(ROOT, r)).href);
const { SessionService, Storage } = await imp('packages/core/dist/index.js');
const { archiveDaemonSessions, SessionArchiveCoordinator } = await imp('packages/cli/dist/src/serve/server/session-archive.js');
const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'r10-rt-'));
Storage.setRuntimeBaseDir(rt);
const rows = [];

async function probe(label, activeBytes) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'r10-ws-'));
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'r10-foreign-'));
  const id = '550e8400-e29b-41d4-a716-446655448001';
  const chats = path.join(new Storage(w).getProjectDir(), 'chats');
  fs.mkdirSync(path.join(chats, 'archive'), { recursive: true });
  const good = (cwd) => JSON.stringify({ uuid: 'r1', parentUuid: null, sessionId: id, timestamp: '2024-01-01T00:00:00.000Z', type: 'user', message: { role: 'user', parts: [{ text: 'hi' }] }, cwd, version: '1.0.0' }) + '\n';
  fs.writeFileSync(path.join(chats, 'archive', `${id}.jsonl`), good(w));
  const activePath = path.join(chats, `${id}.jsonl`);
  fs.writeFileSync(activePath, activeBytes === 'FOREIGN' ? good(foreign) : activeBytes === 'OWN' ? good(w) : activeBytes);
  const before = fs.existsSync(activePath) ? fs.readFileSync(activePath) : null;
  const svc = new SessionService(w);
  let r = null, err = null;
  try {
    r = await archiveDaemonSessions({ sessionIds: [id], service: svc, bridge: { closeSession: async () => {} }, coordinator: new SessionArchiveCoordinator(), resolveConflicts: true });
  } catch (e) { err = String(e?.message ?? e); }
  rows.push({
    activeCopy: label,
    bytes: before ? before.length : 0,
    activeCopyDeleted: !fs.existsSync(activePath),
    resolvedConflicts: r ? r.resolvedConflicts : null,
    errors: r ? (r.errors || []).map(e => String(e.error)) : [err],
  });
}
await probe('empty (0 bytes)', '');
await probe('non-empty but unparseable — no record, so no ownership evidence', 'not json at all\nstill not json\n');
await probe('valid record naming a DIFFERENT workspace cwd', 'FOREIGN');
await probe('valid record naming this workspace', 'OWN');
Storage.setRuntimeBaseDir(null);
console.log(JSON.stringify({ arm: process.env.ARM_LABEL, rows }, null, 2));
