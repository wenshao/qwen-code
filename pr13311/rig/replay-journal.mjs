// Usage: node replay-journal.mjs <label> <worktree> <journal.tsv>
// Re-reads every Session Store transaction dumped from MySQL through the
// BUILT core's real read path (describeTransaction -> parseManagedSessionEvent
// / header / commit marker) and prints a census of what the new guards saw.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const [label, wt, tsv] = process.argv.slice(2);
const core = path.join(wt, 'packages/core/dist/src/managed-runtime');
const imp = (p) => import(pathToFileURL(path.join(core, p)).href);
const { describeTransaction } = await imp('http-managed-session-store.js');
const { parseManagedSessionRecordJson, MANAGED_SESSION_LIMITS } = await imp(
  'managed-session-records.js',
);

const rows = fs
  .readFileSync(tsv, 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.split('\t'));
let ok = 0;
let failed = 0;
const kinds = {};
const census = {
  'activation.changed with activation payload subject (R3-3 id/epoch check ran)': 0,
  'activation.changed with envelope subject (R3-3 envelope match ran)': 0,
  'wake.requested with envelope subject (R3-3 envelope match ran)': 0,
  'wake.requested without envelope subject': 0,
  'message.committed with non-null parentMessageId (R3-4 ran)': 0,
  'checkpoint.committed with non-null previousCheckpointId (R3-4 ran)': 0,
  'config.bound with non-null previousRevision (R3-4 ran)': 0,
};
let epoch = 0;
for (const [tenantId, workspaceId, sessionId, revision, actEpoch, enc, b64] of rows) {
  const bytes = Buffer.from(b64, 'hex');
  const text = bytes.toString('utf8');
  try {
    const records = text
      .slice(0, -1)
      .split('\n')
      .map((line) =>
        parseManagedSessionRecordJson(line, MANAGED_SESSION_LIMITS.maxEventBytes),
      );
    describeTransaction(records, bytes, epoch, { tenantId, workspaceId, sessionId });
    ok++;
    for (const r of records) {
      const ev = r.managedSession;
      if (r.subtype !== 'managed_session_event' && !ev?.kind) continue;
      if (!ev?.kind) continue;
      kinds[ev.kind] = (kinds[ev.kind] ?? 0) + 1;
      const p = ev.payload ?? {};
      if (ev.kind === 'activation.changed') {
        if (p.subject?.type === 'activation') census[Object.keys(census)[0]]++;
        if (ev.subject) census[Object.keys(census)[1]]++;
      }
      if (ev.kind === 'wake.requested') {
        census[Object.keys(census)[ev.subject ? 2 : 3]]++;
      }
      if (ev.kind === 'message.committed' && p.parentMessageId != null) census[Object.keys(census)[4]]++;
      if (ev.kind === 'checkpoint.committed' && p.previousCheckpointId != null) census[Object.keys(census)[5]]++;
      if (ev.kind === 'config.bound' && p.previousRevision != null) census[Object.keys(census)[6]]++;
    }
  } catch (e) {
    failed++;
    console.log(`RESULT\t${label}\ttx rev=${revision}\tFAILED\t${e.name}: ${String(e.message).slice(0, 160)}`);
  }
  epoch = Number(actEpoch);
}
console.log(
  `RESULT\t${label}\treplay\t${path.basename(tsv)}\ttx=${rows.length}\tok=${ok}\tfailed=${failed}\tkinds=${JSON.stringify(kinds)}`,
);
for (const [k, v] of Object.entries(census)) console.log(`CENSUS\t${label}\t${k}\t${v}`);
