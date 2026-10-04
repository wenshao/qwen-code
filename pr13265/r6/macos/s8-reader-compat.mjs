// PR #13265 round 5 — S8: Session header compatibility across versions.
// d00ec4f7bd stamps minimumReader managed-session/2 on every new Session.
// MODE=create: create a Session with this WT's dist and print its header.
// MODE=open:   open SESSION with this WT's dist and report what happens.
// Run with WT=wt-pr6 (this PR) or WT=wt-pr5 (the previous head, whose
// reader is identical to main and v0.24.7-nightly: managed-session/1).
import { randomUUID } from 'node:crypto';
import { openSession, sql, DB, WT, records } from './lib.mjs';

const MODE = process.env.MODE;
const tag = WT.split('/').pop();
if (MODE === 'create') {
  const sessionId = `s8-${tag}-${randomUUID().slice(0, 8)}`;
  const { session } = await openSession({ sessionId, writerId: `w-${sessionId}`, create: true });
  await session.close?.();
  const rows = sql(`SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision LIMIT 1`, DB);
  const storedHeader = rows[0]?.[0]?.match(/"minimumReader":"([^"]+)"/)?.[1] ?? null;
  console.log(`[S8-create] ${JSON.stringify({ wt: tag, reader: records.MANAGED_SESSION_MINIMUM_READER, sessionId, storedHeaderMinimumReader: storedHeader })}`);
} else {
  const sessionId = process.env.SESSION;
  try {
    const { session } = await openSession({ sessionId, writerId: `w2-${randomUUID().slice(0, 8)}` });
    const header = session.authority.header ?? null;
    console.log(`[S8-open] ${JSON.stringify({ wt: tag, reader: records.MANAGED_SESSION_MINIMUM_READER, sessionId, opened: true, minimumReader: header?.minimumReader ?? null })}`);
    await session.close?.();
  } catch (error) {
    console.log(`[S8-open] ${JSON.stringify({ wt: tag, reader: records.MANAGED_SESSION_MINIMUM_READER, sessionId, opened: false, error: `${error.name}: ${error.message}` })}`);
  }
}
process.exit(0);
