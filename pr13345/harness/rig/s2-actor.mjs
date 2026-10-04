// Triage S2 what-if: with domain.committed admitting harness, does the
// preflight refuse something the commit's own check would accept?
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ARM, SP, attempt, command, localCounts, openLog, openSession, say } from './lib.mjs';
openLog(`s2-${ARM}`);
const sessionId = randomUUID();
const runtimeBaseDir = fs.mkdtempSync(`${SP}/rig/tmp/s2-`);
const { session, sessionKey } = await openSession({ sessionId, writerId: 's2', create: true, local: true, runtimeBaseDir });
const content = { goalId: 'goal-1', title: 'harness' };
const harness = await attempt(() =>
  session.authority.commitDomainRecord(
    command(sessionKey, 'goal:harness', content, 'setGoal'),
    { domain: 'goal_state', content },
    { class: 'harness' },
  ),
);
say('RESULT', { arm: ARM, harnessCommit: harness, goalStateFiles: localCounts(runtimeBaseDir, sessionId)['managed-goal_state'] ?? 0 });
await session.close();
