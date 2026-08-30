/**
 * Deterministic probe for the two fences the mutation run left uncovered:
 *   M2 = assertCanCommit inside the unarchive ledger merge's atomic write
 *   M3 = assertCanCommit before the ledger source unlink
 * Fault injection is in the WORLD only (node:fs), never in product code:
 * the writer lock is replaced by a byte-identical copy at a new inode at a
 * precise filesystem moment. Same technique as the PR's own ENOSPC test.
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.TREE_ROOT;
const imp = (r) => import(pathToFileURL(path.join(ROOT, r)).href);
const { SessionService, Storage } = await imp('packages/core/dist/index.js');
const { unarchiveDaemonSessions, SessionArchiveCoordinator } = await imp('packages/cli/dist/src/serve/server/session-archive.js');

const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-rt-'));
Storage.setRuntimeBaseDir(rt);
const lockPath = (id) => path.join(rt, 'tmp', 'session-writer-locks', `${encodeURIComponent(id)}.lock`);
const line = (o) => JSON.stringify(o) + '\n';
const realWrite = fs.writeFileSync, realRename = fs.renameSync;

async function probe(label, hookAt) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-ws-'));
  const id = `550e8400-e29b-41d4-a716-44665544${hookAt === 'tmpWrite' ? '9001' : '9002'}`;
  const chats = path.join(new Storage(w).getProjectDir(), 'chats');
  fs.mkdirSync(path.join(chats, 'archive'), { recursive: true });
  realWrite(path.join(chats, `${id}.jsonl`), JSON.stringify({ uuid: 'r1', parentUuid: null, sessionId: id, timestamp: '2024-01-01T00:00:00.000Z', type: 'user', message: { role: 'user', parts: [{ text: 'hi' }] }, cwd: w, version: '1.0.0' }) + '\n');
  const svc = new SessionService(w);
  const act = svc.getPromptLedgerPath(id);
  const arc = path.join(path.dirname(svc.getPrSessionPathForArchiveState(id, 'archived')), `${id}.ledger.jsonl`);
  const arcBytes = line({ v: 1, promptId: 'p1', state: 'in_flight', at: 1 });
  const actBytes = line({ v: 1, promptId: 'p1', terminal: 'completed', at: 2 });
  realWrite(arc, arcBytes); realWrite(act, actBytes);

  let swapped = false;
  const swap = () => {
    const lp = lockPath(id);
    if (swapped || !fs.existsSync(lp)) return;
    const raw = fs.readFileSync(lp);
    realWrite(`${lp}.swap`, raw);
    realRename(`${lp}.swap`, lp);
    swapped = true;
  };
  fs.writeFileSync = function (file, data, opts) {
    const p = String(file);
    if (hookAt === 'tmpWrite' && p.startsWith(`${act}.`) && p.endsWith('.tmp')) swap();
    return realWrite(file, data, opts);
  };
  fs.renameSync = function (src, dst) {
    const r = realRename(src, dst);
    if (hookAt === 'afterRename' && String(dst) === act) swap();
    return r;
  };
  syncBuiltinESMExports();
  let errors = [];
  try {
    const r = await unarchiveDaemonSessions({ sessionIds: [id], service: svc, coordinator: new SessionArchiveCoordinator() });
    errors = (r.errors || []).map((e) => String(e.error));
  } catch (e) { errors = [String(e?.message ?? e)]; }
  fs.writeFileSync = realWrite; fs.renameSync = realRename; syncBuiltinESMExports();
  return {
    probe: label, lockSwapped: swapped, errors,
    sourceHalfPreserved: fs.existsSync(arc),
    sourceBytesIntact: fs.existsSync(arc) && fs.readFileSync(arc, 'utf8') === arcBytes,
    destinationRewritten: fs.readFileSync(act, 'utf8') !== actBytes,
  };
}
const rows = [
  await probe('M2 site — lock swapped while the merge tmp file is written (before its commit rename)', 'tmpWrite'),
  await probe('M3 site — lock swapped after the merge committed, before the source unlink', 'afterRename'),
];
Storage.setRuntimeBaseDir(null);
console.log(JSON.stringify({ arm: process.env.ARM_LABEL, rows }, null, 2));
