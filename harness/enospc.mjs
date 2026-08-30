/**
 * Real ENOSPC on a real 6.5 MiB ext4 loop filesystem — no fs mocking.
 * The archive-direction ledger merge appends in place; the unarchive
 * direction writes atomically. What does each leave behind when the
 * filesystem fills mid-merge?
 */
import fs from 'node:fs'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.TREE_ROOT, MNT = process.env.MNT;
const imp = (r) => import(pathToFileURL(path.join(ROOT, r)).href);
const { SessionService, Storage } = await imp('packages/core/dist/index.js');
const { archiveDaemonSessions, unarchiveDaemonSessions, SessionArchiveCoordinator } = await imp('packages/cli/dist/src/serve/server/session-archive.js');
const { readPromptLedgerRecords } = await imp('packages/acp-bridge/dist/prompt-ledger.js');

const rt = fs.mkdtempSync(path.join(MNT, 'rt-'));
Storage.setRuntimeBaseDir(rt);
const line = (o) => JSON.stringify(o) + '\n';
const rows = [];

async function run(direction) {
  const w = fs.mkdtempSync(path.join(MNT, 'ws-'));
  const id = `550e8400-e29b-41d4-a716-44665544${direction === 'archive' ? '7001' : '7002'}`;
  const chats = path.join(new Storage(w).getProjectDir(), 'chats');
  fs.mkdirSync(path.join(chats, 'archive'), { recursive: true });
  fs.writeFileSync(path.join(chats, direction === 'archive' ? `${id}.jsonl` : `archive/${id}.jsonl`),
    JSON.stringify({ uuid: 'r1', parentUuid: null, sessionId: id, timestamp: '2024-01-01T00:00:00.000Z', type: 'user', message: { role: 'user', parts: [{ text: 'hi' }] }, cwd: w, version: '1.0.0' }) + '\n');
  const svc = new SessionService(w);
  const act = svc.getPromptLedgerPath(id);
  const arc = path.join(path.dirname(svc.getPrSessionPathForArchiveState(id, 'archived')), `${id}.ledger.jsonl`);
  const src = direction === 'archive' ? act : arc;
  const dst = direction === 'archive' ? arc : act;
  // ~700 KiB of source records, an existing destination half
  let payload = '';
  for (let i = 0; i < 3000; i++) payload += line({ v: 1, promptId: `s-${i}`, terminal: 'completed', at: 5000 + i, pad: 'y'.repeat(180) });
  fs.mkdirSync(path.dirname(src), { recursive: true }); fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(src, payload);
  const dstBytes = line({ v: 1, promptId: 'd-0', terminal: 'completed', at: 1 });
  fs.writeFileSync(dst, dstBytes);
  // fill the filesystem, leaving just enough room to start but not finish
  const filler = path.join(MNT, `fill-${direction}`);
  let free = 0;
  try {
    const st = fs.statfsSync(MNT); free = st.bsize * st.bavail;
    fs.writeFileSync(filler, Buffer.alloc(Math.max(0, free - 320 * 1024)));
  } catch (e) { /* already full */ }
  let errors = [], warns = [];
  const svc2 = new SessionService(w, { onWarning: (m) => warns.push(m) });
  try {
    const r = direction === 'archive'
      ? await archiveDaemonSessions({ sessionIds: [id], service: svc2, bridge: { closeSession: async () => {} }, coordinator: new SessionArchiveCoordinator() })
      : await unarchiveDaemonSessions({ sessionIds: [id], service: svc2, coordinator: new SessionArchiveCoordinator() });
    errors = (r.errors || []).map(e => String(e.error));
  } catch (e) { errors = [String(e?.message ?? e)]; }
  try { fs.unlinkSync(filler); } catch {}
  // retry the same lifecycle request with the filesystem no longer full
  let retryErrors = [];
  try {
    const r2 = direction === 'archive'
      ? await archiveDaemonSessions({ sessionIds: [id], service: svc2, bridge: { closeSession: async () => {} }, coordinator: new SessionArchiveCoordinator() })
      : await unarchiveDaemonSessions({ sessionIds: [id], service: svc2, coordinator: new SessionArchiveCoordinator() });
    retryErrors = (r2.errors || []).map(e => String(e.error));
  } catch (e) { retryErrors = [String(e?.message ?? e)]; }
  const afterRetry = fs.existsSync(dst) ? readPromptLedgerRecords(dst) : [];
  const ids = afterRetry.map(r => r.promptId);
  const dupes = ids.length - new Set(ids).size;
  const dstNow = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : '';
  const torn = dstNow.length > 0 && !dstNow.endsWith('\n');
  const parsed = fs.existsSync(dst) ? readPromptLedgerRecords(dst) : [];
  rows.push({
    direction,
    mergeStrategy: direction === 'archive' ? 'in-place appendFileSync' : 'atomicWriteFileSync (tmp + rename)',
    sourceStillPresent: fs.existsSync(src),
    destinationBytesChanged: dstNow !== dstBytes,
    destinationTailTorn: torn,
    destinationRecordsParsed: parsed.length,
    destinationOriginalRecordSurvives: parsed.some(r => r.promptId === 'd-0'),
    errors: errors.slice(0, 1), warnings: warns.slice(0, 1).map(w => w.slice(0, 110)),
    retry: { errors: retryErrors.slice(0,1), sourceCleared: !fs.existsSync(src), recordsAfterRetry: afterRetry.length, duplicateRecords: dupes },
  });
}
await run('archive');
await run('unarchive');
Storage.setRuntimeBaseDir(null);
console.log(JSON.stringify({ arm: process.env.ARM_LABEL, rows }, null, 2));
