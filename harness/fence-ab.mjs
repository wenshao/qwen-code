/**
 * Post-commit ownership-fence harness.
 *
 * Real filesystem, real serve entry points, real SessionService, real
 * SessionWriterLease. The only injected fault is closing the caller's
 * runtime-generation guard (assertCanMutate) at the moment the primary
 * transcript mutation lands, and — in F5 — replacing the writer lock with a
 * byte-identical copy at a new inode. Byte-identical across both arms.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.TREE_ROOT;
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const core = await imp('packages/core/dist/index.js');
const arch = await imp('packages/cli/dist/src/serve/server/session-archive.js');
const { SessionService, Storage } = core;
const { archiveDaemonSessions, unarchiveDaemonSessions, deleteDaemonSessions, SessionArchiveCoordinator } = arch;

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fence-rt-'));
Storage.setRuntimeBaseDir(runtimeDir);
const lockPath = (id) => path.join(runtimeDir, 'tmp', 'session-writer-locks', `${encodeURIComponent(id)}.lock`);

const out = [];
const rec = (scenario, data) => out.push({ scenario, ...data });
const ws = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fence-ws-'));
const line = (o) => JSON.stringify(o) + '\n';

function chatsDir(w) { return path.join(new Storage(w).getProjectDir(), 'chats'); }
function writeSessionFile(w, id, state) {
  const dir = state === 'archived' ? path.join(chatsDir(w), 'archive') : chatsDir(w);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`),
    JSON.stringify({ uuid: 'record-1', parentUuid: null, sessionId: id,
      timestamp: '2024-01-01T00:00:00.000Z', type: 'user',
      message: { role: 'user', parts: [{ text: 'hello' }] }, cwd: w, version: '1.0.0' }) + '\n');
}
function sidecarPaths(svc, id, state) {
  const worktree = svc.getWorktreeSessionPathForArchiveState(id, state);
  const pr = svc.getPrSessionPathForArchiveState(id, state);
  const ledger = path.join(path.dirname(pr), `${id}.ledger.jsonl`);
  return { worktree, pr, ledger };
}
function seedSidecars(p) {
  for (const f of [p.worktree, p.pr, p.ledger]) fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(p.worktree, JSON.stringify({ worktreePath: '/tmp/wt', branch: 'x' }));
  fs.writeFileSync(p.pr, JSON.stringify([{ number: 7, url: 'https://example/7', repo: 'a/b' }]));
  fs.writeFileSync(p.ledger, line({ v: 1, promptId: 'p1', terminal: 'completed', at: 1 }));
}
const present = (p) => ({ worktree: fs.existsSync(p.worktree), pr: fs.existsSync(p.pr), ledger: fs.existsSync(p.ledger) });
const count = (o) => Object.values(o).filter(Boolean).length;

/** Guard that closes as soon as the transcript leaves `watchPath`. */
function closingGuard(watchPath) {
  let closed = false;
  return () => {
    if (!closed && !fs.existsSync(watchPath)) closed = true;
    if (closed) { const e = new Error('runtime generation closed'); e.code = 'GENERATION_CLOSED'; throw e; }
  };
}
/** Replace the lock with a byte-identical copy at a NEW inode. */
function swapLockInode(id) {
  const lp = lockPath(id);
  if (!fs.existsSync(lp)) return false;
  const raw = fs.readFileSync(lp);
  const tmp = `${lp}.swap`;
  fs.writeFileSync(tmp, raw);
  fs.renameSync(tmp, lp);
  return true;
}

// ---------------- F1 archive, generation closes at the transcript move
{
  const w = ws(); const id = '550e8400-e29b-41d4-a716-4466554401f1';
  writeSessionFile(w, id, 'active');
  const svc = new SessionService(w);
  const src = sidecarPaths(svc, id, 'active'), dst = sidecarPaths(svc, id, 'archived');
  seedSidecars(src);
  const transcript = path.join(chatsDir(w), `${id}.jsonl`);
  let r = null, err = null;
  try {
    r = await archiveDaemonSessions({ sessionIds: [id], service: svc, bridge: { closeSession: async () => {} },
      coordinator: new SessionArchiveCoordinator(), assertCanMutate: closingGuard(transcript) });
  } catch (e) { err = String(e?.message ?? e); }
  rec('F1 archive + generation closed after transcript move', {
    transcriptArchived: fs.existsSync(path.join(chatsDir(w), 'archive', `${id}.jsonl`)),
    sidecarsMoved: count(present(dst)), sidecarsStranded: count(present(src)),
    route: r && { archived: r.archived, errors: (r.errors || []).map(e => String(e.error)) }, thrown: err,
  });
}

// ---------------- F2 unarchive, generation closes at the transcript move
{
  const w = ws(); const id = '550e8400-e29b-41d4-a716-4466554401f2';
  writeSessionFile(w, id, 'archived');
  const svc = new SessionService(w);
  const src = sidecarPaths(svc, id, 'archived'), dst = sidecarPaths(svc, id, 'active');
  seedSidecars(src);
  const transcript = path.join(chatsDir(w), 'archive', `${id}.jsonl`);
  let r = null, err = null;
  try {
    r = await unarchiveDaemonSessions({ sessionIds: [id], service: svc,
      coordinator: new SessionArchiveCoordinator(), assertCanMutate: closingGuard(transcript) });
  } catch (e) { err = String(e?.message ?? e); }
  rec('F2 unarchive + generation closed after transcript move', {
    transcriptActive: fs.existsSync(path.join(chatsDir(w), `${id}.jsonl`)),
    sidecarsMoved: count(present(dst)), sidecarsStranded: count(present(src)),
    route: r && { unarchived: r.unarchived, errors: (r.errors || []).map(e => String(e.error)) }, thrown: err,
  });
}

// ---------------- F3 delete, generation closes at the transcript unlink
{
  const w = ws(); const id = '550e8400-e29b-41d4-a716-4466554401f3';
  writeSessionFile(w, id, 'active');
  const svc = new SessionService(w);
  const src = sidecarPaths(svc, id, 'active');
  seedSidecars(src);
  const transcript = path.join(chatsDir(w), `${id}.jsonl`);
  let r = null, err = null;
  try {
    r = await deleteDaemonSessions({ sessionIds: [id], service: svc,
      bridge: { closeSession: async () => {}, deleteSessionAttachments: async () => {} },
      coordinator: new SessionArchiveCoordinator(), assertCanMutate: closingGuard(transcript) });
  } catch (e) { err = String(e?.message ?? e); }
  rec('F3 delete + generation closed after transcript unlink', {
    transcriptGone: !fs.existsSync(transcript),
    sidecarsStranded: count(present(src)),
    route: r && { deleted: r.deleted, errors: (r.errors || []).map(e => String(e.error)) }, thrown: err,
  });
}

// ---------------- F4 plain retry over the residue an interrupted run left
{
  const w = ws(); const id = '550e8400-e29b-41d4-a716-4466554401f4';
  writeSessionFile(w, id, 'archived');       // primary mutation already committed
  const svc = new SessionService(w);
  const src = sidecarPaths(svc, id, 'active'), dst = sidecarPaths(svc, id, 'archived');
  seedSidecars(src);                          // sidecars left behind in chats/
  let r = null, err = null;
  try {
    r = await archiveDaemonSessions({ sessionIds: [id], service: svc, bridge: { closeSession: async () => {} },
      coordinator: new SessionArchiveCoordinator() });   // guard fully open
  } catch (e) { err = String(e?.message ?? e); }
  rec('F4 retry with an open guard resumes the stranded cleanup', {
    sidecarsMoved: count(present(dst)), sidecarsStranded: count(present(src)),
    route: r && { alreadyArchived: r.alreadyArchived, errors: (r.errors || []).map(e => String(e.error)) }, thrown: err,
  });
}

// ---------------- F5 lock replaced by a byte-identical copy at a new inode
{
  const w = ws(); const id = '550e8400-e29b-41d4-a716-4466554401f5';
  writeSessionFile(w, id, 'active');
  const svc = new SessionService(w);
  const src = sidecarPaths(svc, id, 'active'), dst = sidecarPaths(svc, id, 'archived');
  seedSidecars(src);
  const transcript = path.join(chatsDir(w), `${id}.jsonl`);
  let swapped = false;
  const guard = () => { if (!swapped && !fs.existsSync(transcript)) swapped = swapLockInode(id); };
  let r = null, err = null;
  try {
    r = await archiveDaemonSessions({ sessionIds: [id], service: svc, bridge: { closeSession: async () => {} },
      coordinator: new SessionArchiveCoordinator(), assertCanMutate: guard });
  } catch (e) { err = String(e?.message ?? e); }
  rec('F5 foreign lock (identical bytes, new inode) after the primary mutation', {
    lockSwapped: swapped,
    sidecarsMovedUnderForeignLock: count(present(dst)), sidecarsUntouched: count(present(src)),
    route: r && { archived: r.archived, errors: (r.errors || []).map(e => String(e.error)) }, thrown: err,
  });
}

Storage.setRuntimeBaseDir(null);
console.log(JSON.stringify({ arm: process.env.ARM_LABEL, observations: out }, null, 2));
