// R7 (round 2, R1-4 on the real stack): a malformed commandId retried 10x on
// each commit path through the HTTP store -> Spring -> MariaDB. Counts the
// rows MariaDB holds and the buffers the HTTP store keeps staged in memory.
import { randomUUID } from 'node:crypto';
import {
  ARM, FIXTURES, RefMapper, attempt, enableMonitorRun, journalTx, openLog,
  openSession, resourceCounts, say,
} from './lib.mjs';

openLog(`r7-identity-http-${ARM}`);
enableMonitorRun();
const sessionId = randomUUID();
const { session, sessionKey, stores } = await openSession({
  sessionId,
  writerId: `r7-${ARM}-${sessionId.slice(0, 8)}`,
  create: true,
});
const staged = () => stores.resourceStore.staged.size;
const refs = new RefMapper(session.resources);
const record = await refs.remap(FIXTURES.monitorChainCases[0].revisions[0].monitorRun);
const stagedStart = staged();
const txStart = journalTx(sessionId);
const outcomes = new Map();
const note = (r) => outcomes.set(r, (outcomes.get(r) ?? 0) + 1);
for (let i = 1; i <= 10; i += 1) {
  const bad = { operation: 'setGoal', commandId: `goal\u0001${i}`, sessionKey, contentDigest: 'd'.repeat(64) };
  note(await attempt(() => session.authority.commitDomainRecord(
    bad, { domain: 'goal_state', content: { goalId: 'goal-1', title: `t${i}` } }, { class: 'trusted_entry' })));
  const badExt = { operation: 'commitMonitorRun', commandId: `${'m'.repeat(512)}:${i}`, sessionKey, contentDigest: 'd'.repeat(64) };
  note(await attempt(() => session.authority.commitExtensionRecord(
    badExt, { domain: 'monitor_run', record }, { class: 'trusted_entry' })));
}
const stagedAfter = staged();
const rows = resourceCounts(sessionId);
const control = await attempt(() => session.authority.commitDomainRecord(
  { operation: 'setGoal', commandId: 'goal:ok', sessionKey, contentDigest: 'd'.repeat(64) },
  { domain: 'goal_state', content: { goalId: 'goal-1', title: 'ok' } },
  { class: 'trusted_entry' }));
say('refusals', Object.fromEntries(outcomes));
say('RESULT', {
  arm: ARM,
  stagedLeaked: stagedAfter - stagedStart,
  dbRows: { goal: rows['managed-goal_state'] ?? 0, monitor: rows['managed-monitor_run'] ?? 0 },
  txDuringRefusals: journalTx(sessionId) - txStart,
  control,
  goalRowsAfterControl: resourceCounts(sessionId)['managed-goal_state'] ?? 0,
});
await session.close();
