/**
 * Do the two untested fences (M2: the unarchive ledger merge's
 * assertCanCommit; M3: the pre-unlink check) actually fire at runtime?
 * The lock is swapped for a byte-identical copy at a new inode from an
 * event-loop poller that wakes inside the await window of the PR-sidecar
 * move, i.e. after cleanup started but before the ledger merge commits.
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.TREE_ROOT;
const imp = (r) => import(pathToFileURL(path.join(ROOT, r)).href);
const { SessionService, Storage } = await imp('packages/core/dist/index.js');
const { unarchiveDaemonSessions, SessionArchiveCoordinator } = await imp('packages/cli/dist/src/serve/server/session-archive.js');
const { readPromptLedgerRecords } = await imp('packages/acp-bridge/dist/prompt-ledger.js');

const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-rt-'));
Storage.setRuntimeBaseDir(rt);
const lockPath = (id) => path.join(rt, 'tmp', 'session-writer-locks', `${encodeURIComponent(id)}.lock`);
const line = (o) => JSON.stringify(o) + '\n';

async function trial(n) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ws-'));
  const id = `550e8400-e29b-41d4-a716-4466554${String(30000 + n).slice(0, 5)}`;
  const chats = path.join(new Storage(w).getProjectDir(), 'chats');
  fs.mkdirSync(path.join(chats, 'archive'), { recursive: true });
  fs.writeFileSync(path.join(chats, `${id}.jsonl`), JSON.stringify({ uuid: 'r1', parentUuid: null, sessionId: id, timestamp: '2024-01-01T00:00:00.000Z', type: 'user', message: { role: 'user', parts: [{ text: 'hi' }] }, cwd: w, version: '1.0.0' }) + '\n');
  const svc = new SessionService(w);
  const actLedger = svc.getPromptLedgerPath(id);
  const arcPr = svc.getPrSessionPathForArchiveState(id, 'archived');
  const actPr = svc.getPrSessionPathForArchiveState(id, 'active');
  const arcLedger = path.join(path.dirname(arcPr), `${id}.ledger.jsonl`);
  // both PR-sidecar halves exist => the merge path awaits, opening a window
  fs.writeFileSync(arcPr, JSON.stringify([{ number: 1, url: 'https://e/1', repo: 'a/b' }]));
  fs.writeFileSync(actPr, JSON.stringify([{ number: 2, url: 'https://e/2', repo: 'a/b' }]));
  const arcBytes = line({ v: 1, promptId: 'p1', state: 'in_flight', at: 1 });
  const actBytes = line({ v: 1, promptId: 'p1', terminal: 'completed', at: 2 });
  fs.writeFileSync(arcLedger, arcBytes);
  fs.writeFileSync(actLedger, actBytes);

  let swapped = false;
  const poll = setInterval(() => {
    if (swapped) return;
    const lp = lockPath(id);
    if (!fs.existsSync(lp)) return;
    if (!fs.existsSync(actPr)) return;      // PR-sidecar merge in progress
    const raw = fs.readFileSync(lp);
    fs.writeFileSync(`${lp}.swap`, raw);
    fs.renameSync(`${lp}.swap`, lp);        // identical bytes, new inode
    swapped = true;
  }, 0);
  let errs = [];
  try {
    const r = await unarchiveDaemonSessions({ sessionIds: [id], service: svc, coordinator: new SessionArchiveCoordinator() });
    errs = (r.errors || []).map((e) => String(e.error));
  } catch (e) { errs = [String(e?.message ?? e)]; }
  clearInterval(poll);
  return {
    swapped,
    errors: errs,
    bothHalvesIntact: fs.existsSync(arcLedger) && fs.readFileSync(arcLedger, 'utf8') === arcBytes
      && fs.existsSync(actLedger) && fs.readFileSync(actLedger, 'utf8') === actBytes,
    activeLedgerOrder: fs.existsSync(actLedger) ? readPromptLedgerRecords(actLedger).map(r => r.at) : [],
    archivedHalfPresent: fs.existsSync(arcLedger),
  };
}
const rows = [];
for (let i = 0; i < 8; i++) rows.push(await trial(i));
Storage.setRuntimeBaseDir(null);
const swapped = rows.filter(r => r.swapped);
console.log(JSON.stringify({
  arm: process.env.ARM_LABEL, trials: rows.length,
  swapLanded: swapped.length,
  fencedWithBothHalvesIntact: swapped.filter(r => r.bothHalvesIntact && r.errors.some(e => /WriterLost|ownership/i.test(e))).length,
  mergedUnderForeignLock: swapped.filter(r => !r.archivedHalfPresent).length,
  sample: rows.slice(0, 3),
}, null, 2));
