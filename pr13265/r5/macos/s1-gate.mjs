// S1: the production gate. With the shipped MANAGED_SESSION_ENABLED_DOMAINS
// (no ENABLE_CHILD_RUN), the built authority must refuse a child_run commit
// before publishing anything, and the real Java store must hold nothing new.
import { BINDING_1, ENABLED, WT, child, commitChild, createPublicSession, journalCounts, openLog, openSession, publish, records, say } from './lib.mjs';

if (ENABLED) throw new Error('S1 must run with the shipped enabled-domain list');
openLog(process.env.LOGNAME_S1 ?? 's1-gate');
say('tree', WT.split('/').pop());
say('enabled-domains', records.MANAGED_SESSION_ENABLED_DOMAINS);
const pub = await createPublicSession();
const sessionId = pub.id;
const { session, sessionKey } = await openSession({ sessionId, writerId: 'writer-gate', create: true });
const commandRef = await publish(session, 'managed-tool-args', { command: 'sleep 30 &', cwd: '/workspace' });
const before = journalCounts(sessionId);
let outcome;
try {
  const r = await commitChild(session, sessionKey, 'shell-1:1', child({ commandRef }));
  outcome = `COMMITTED revision ${r.revision}`;
} catch (e) {
  outcome = `${e.name}: ${e.message}`;
}
const after = journalCounts(sessionId);
say('commit child_run', outcome);
say('journal before/after', { before, after });
say('RESULT', {
  refused: !outcome.startsWith('COMMITTED'),
  nothingWritten: before.tx === after.tx && before.resources === after.resources && before.records === after.records,
});
await session.close();
void BINDING_1;
