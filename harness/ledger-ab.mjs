/**
 * R9-1 ledger-ordering harness.
 *
 * Real filesystem, real production entry points (unarchiveDaemonSessions /
 * archiveDaemonSessions from the serve layer, real SessionService, real
 * SessionArchiveCoordinator, real acp-bridge ledger readers). Nothing is
 * mocked. Byte-identical across every arm.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.TREE_ROOT;
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const core = await imp('packages/core/dist/index.js');
const arch = await imp('packages/cli/dist/src/serve/server/session-archive.js');
const led = await imp('packages/acp-bridge/dist/prompt-ledger.js');
const ptl = await imp('packages/cli/dist/src/serve/prompt-terminal-ledger.js');
const { SessionService, Storage } = core;
const { archiveDaemonSessions, unarchiveDaemonSessions, SessionArchiveCoordinator } = arch;
const { readPromptLedgerRecords, danglingInFlightPromptIds, recentPromptTerminalRecords } = led;

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r9-rt-'));
Storage.setRuntimeBaseDir(runtimeDir);

const out = [];
const rec = (name, data) => out.push({ scenario: name, ...data });

function freshWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'r9-ws-'));
}
function writeSessionFile(ws, id, state) {
  const chats = path.join(new Storage(ws).getProjectDir(), 'chats');
  const dir = state === 'archived' ? path.join(chats, 'archive') : chats;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`),
    JSON.stringify({ uuid: 'record-1', parentUuid: null, sessionId: id,
      timestamp: '2024-01-01T00:00:00.000Z', type: 'user',
      message: { role: 'user', parts: [{ text: 'hello' }] }, cwd: ws, version: '1.0.0' }) + '\n');
}
function ledgerPaths(svc, id) {
  const active = svc.getPromptLedgerPath(id);
  const archivedPr = svc.getPrSessionPathForArchiveState(id, 'archived');
  const archived = path.join(path.dirname(archivedPr), `${id}.ledger.jsonl`);
  return { active, archived };
}
const line = (o) => JSON.stringify(o) + '\n';

// ---------------------------------------------------------------- L1
// Interrupted unarchive left the OLDER half in chats/archive/; the session
// was reused and wrote the NEWER terminal to the active ledger.
// Correct merge => [in_flight(at:1), completed(at:2)] => no dangling prompt.
{
  const ws = freshWorkspace();
  const id = '550e8400-e29b-41d4-a716-4466554400a1';
  writeSessionFile(ws, id, 'active');
  const svc = new SessionService(ws);
  const p = ledgerPaths(svc, id);
  fs.mkdirSync(path.dirname(p.active), { recursive: true });
  fs.mkdirSync(path.dirname(p.archived), { recursive: true });
  fs.writeFileSync(p.archived, line({ v: 1, promptId: 'p1', state: 'in_flight', at: 1 }));
  fs.writeFileSync(p.active, line({ v: 1, promptId: 'p1', terminal: 'completed', at: 2 }));

  let result, err = null;
  try {
    result = await unarchiveDaemonSessions({ sessionIds: [id], service: svc, coordinator: new SessionArchiveCoordinator() });
  } catch (e) { err = String(e && e.message || e); }
  const records = readPromptLedgerRecords(p.active);
  // Downstream: the cold-load path the daemon actually runs.
  const before = fs.existsSync(p.active) ? fs.readFileSync(p.active, 'utf8') : '';
  await ptl.reconcileDanglingPromptTerminals(svc, id);
  const after = fs.existsSync(p.active) ? fs.readFileSync(p.active, 'utf8') : '';
  const afterRecords = readPromptLedgerRecords(p.active);
  const synthesized = afterRecords.filter(r => r.terminal !== undefined && r.at > 2);
  rec('L1 unarchive reconciliation order', {
    reconcileAppendedRecord: before !== after,
    synthesizedTerminals: synthesized.map(r => ({ promptId: r.promptId, terminal: r.terminal })),
    route: result ? { alreadyActive: result.alreadyActive, unarchived: result.unarchived, errors: (result.errors || []).map(e => e.error) } : null,
    routeError: err,
    archivedHalfStranded: fs.existsSync(p.archived),
    order: records.map(r => r.at),
    dangling: danglingInFlightPromptIds(records),
    expectOrder: [1, 2], expectDangling: [],
  });
}

// ---------------------------------------------------------------- L2
// 70 OLD terminals stranded in the archived half + 10 NEW terminals active.
// recentPromptTerminalRecords keeps the last 64 in file order; correct
// ordering must keep all 10 new ones.
{
  const ws = freshWorkspace();
  const id = '550e8400-e29b-41d4-a716-4466554400a2';
  writeSessionFile(ws, id, 'active');
  const svc = new SessionService(ws);
  const p = ledgerPaths(svc, id);
  fs.mkdirSync(path.dirname(p.active), { recursive: true });
  fs.mkdirSync(path.dirname(p.archived), { recursive: true });
  let old = '', neu = '';
  for (let i = 0; i < 70; i++) old += line({ v: 1, promptId: `old-${i}`, terminal: 'completed', at: 1000 + i });
  for (let i = 0; i < 10; i++) neu += line({ v: 1, promptId: `new-${i}`, terminal: 'completed', at: 9000 + i });
  fs.writeFileSync(p.archived, old);
  fs.writeFileSync(p.active, neu);

  let err = null, result;
  try {
    result = await unarchiveDaemonSessions({ sessionIds: [id], service: svc, coordinator: new SessionArchiveCoordinator() });
  } catch (e) { err = String(e && e.message || e); }
  const records = readPromptLedgerRecords(p.active);
  const recent = recentPromptTerminalRecords(records);
  const newKept = recent.filter(r => r.promptId.startsWith('new-')).length;
  rec('L2 recent-terminal window (cap 64)', {
    routeError: err,
    archivedHalfStranded: fs.existsSync(p.archived),
    totalRecords: records.length,
    newTerminalsKept: newKept, expectNewTerminalsKept: 10,
    firstRecordAt: records[0]?.at, lastRecordAt: records[records.length - 1]?.at,
  });
}

// ---------------------------------------------------------------- L3
// Same, but the merged ledger exceeds the 256 KiB tail window that the
// serve load response actually reads (readRecentPromptTerminals).
{
  const ws = freshWorkspace();
  const id = '550e8400-e29b-41d4-a716-4466554400a3';
  writeSessionFile(ws, id, 'active');
  const svc = new SessionService(ws);
  const p = ledgerPaths(svc, id);
  fs.mkdirSync(path.dirname(p.active), { recursive: true });
  fs.mkdirSync(path.dirname(p.archived), { recursive: true });
  const pad = 'x'.repeat(400);
  let old = '';
  for (let i = 0; i < 900; i++) old += line({ v: 1, promptId: `old-${i}`, terminal: 'completed', at: 1000 + i, note: pad });
  let neu = '';
  for (let i = 0; i < 3; i++) neu += line({ v: 1, promptId: `new-${i}`, terminal: 'completed', at: 9000 + i });
  fs.writeFileSync(p.archived, old);
  fs.writeFileSync(p.active, neu);

  let err = null;
  try {
    await unarchiveDaemonSessions({ sessionIds: [id], service: svc, coordinator: new SessionArchiveCoordinator() });
  } catch (e) { err = String(e && e.message || e); }
  const TAIL = 256 * 1024;
  const windowed = readPromptLedgerRecords(p.active, { tailBytes: TAIL });
  const recent = recentPromptTerminalRecords(windowed);
  rec('L3 256KiB tail window (load response)', {
    routeError: err,
    mergedBytes: fs.existsSync(p.active) ? fs.statSync(p.active).size : 0,
    newTerminalsVisibleInLoadResponse: recent.filter(r => r.promptId.startsWith('new-')).length,
    expectNewTerminalsVisible: 3,
  });
}

// ---------------------------------------------------------------- L4
// Ordinary archive direction: only the active transcript exists, but an
// archived ledger half was stranded by an earlier interrupted cycle.
// active (newer) must land AFTER archived (older).
{
  const ws = freshWorkspace();
  const id = '550e8400-e29b-41d4-a716-4466554400a4';
  writeSessionFile(ws, id, 'active');
  const svc = new SessionService(ws);
  const p = ledgerPaths(svc, id);
  fs.mkdirSync(path.dirname(p.active), { recursive: true });
  fs.mkdirSync(path.dirname(p.archived), { recursive: true });
  fs.writeFileSync(p.archived, line({ v: 1, promptId: 'p1', state: 'in_flight', at: 1 }));
  fs.writeFileSync(p.active, line({ v: 1, promptId: 'p1', terminal: 'completed', at: 2 }));

  let err = null, result;
  try {
    result = await archiveDaemonSessions({ sessionIds: [id], service: svc,
      bridge: { closeSession: async () => {} },
      coordinator: new SessionArchiveCoordinator() });
  } catch (e) { err = String(e && e.message || e); }
  const records = fs.existsSync(p.archived) ? readPromptLedgerRecords(p.archived) : [];
  rec('L4 archive direction order', {
    route: result ? { archived: result.archived, alreadyArchived: result.alreadyArchived, errors: (result.errors || []).map(e => String(e.error)) } : null,
    routeError: err,
    activeHalfStranded: fs.existsSync(p.active),
    order: records.map(r => r.at),
    dangling: danglingInFlightPromptIds(records),
    expectOrder: [1, 2], expectDangling: [],
  });
}

// ---------------------------------------------------------------- L5
// Conflict repair (resolveConflicts: true): active + archived transcripts
// both exist. Archive keeps the archived copy and removes the active one.
// What happens to the active ledger half?
{
  const ws = freshWorkspace();
  const id = '550e8400-e29b-41d4-a716-4466554400a5';
  writeSessionFile(ws, id, 'archived');
  writeSessionFile(ws, id, 'active');
  const svc = new SessionService(ws);
  const p = ledgerPaths(svc, id);
  fs.mkdirSync(path.dirname(p.active), { recursive: true });
  fs.mkdirSync(path.dirname(p.archived), { recursive: true });
  fs.writeFileSync(p.archived, line({ v: 1, promptId: 'p1', state: 'in_flight', at: 1 }));
  fs.writeFileSync(p.active, line({ v: 1, promptId: 'p1', terminal: 'completed', at: 2 }));

  let err = null, result;
  try {
    result = await archiveDaemonSessions({ sessionIds: [id], service: svc,
      bridge: { closeSession: async () => {} },
      coordinator: new SessionArchiveCoordinator(), resolveConflicts: true });
  } catch (e) { err = String(e && e.message || e); }
  const records = fs.existsSync(p.archived) ? readPromptLedgerRecords(p.archived) : [];
  rec('L5 conflict repair, active ledger fate', {
    route: result ? { archived: result.archived, resolvedConflicts: result.resolvedConflicts, errors: (result.errors || []).map(e => String(e.error)) } : null,
    routeError: err,
    activeLedgerStillPresent: fs.existsSync(p.active),
    archivedLedgerOrder: records.map(r => r.at),
    dangling: danglingInFlightPromptIds(records),
  });
}

Storage.setRuntimeBaseDir(null);
console.log(JSON.stringify({ arm: process.env.ARM_LABEL, observations: out }, null, 2));
