// Round 3 (be2c87bb, /review R2-1): commitDomainRecord's two hoisted checks.
//   R10 stale expectedSequence, retried 10x            -> orphan bodies / staged buffers
//   R11 writeFailure latched by a real EACCES append, then 5 more commits as
//       the record sink would make them (local store only) -> orphan bodies
//   R12 an idempotent retry of a command that carried expectedSequence:
//       commitDomainRecord vs commitExtensionRecord      -> replayed or refused?
// LOCAL=1 runs on the local journal + resource files; otherwise the HTTP store.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  ARM, FIXTURES, RefMapper, SP, attempt, enableMonitorRun, localCounts,
  openLog, openSession, resourceCounts, say,
} from './lib.mjs';

const LOCAL = process.env.LOCAL === '1';
openLog(`r10-domain-${ARM}-${LOCAL ? 'local' : 'http'}`);
enableMonitorRun();
const D = 'd'.repeat(64);

async function fresh(tag) {
  const sessionId = randomUUID();
  const runtimeBaseDir = fs.mkdtempSync(`${SP}/rig/tmp/r10-`);
  const opened = await openSession({
    sessionId,
    writerId: `r10-${tag}-${ARM}-${sessionId.slice(0, 8)}`,
    create: true,
    local: LOCAL,
    runtimeBaseDir,
  });
  const goalBodies = () =>
    LOCAL
      ? (localCounts(runtimeBaseDir, sessionId)['managed-goal_state'] ?? 0)
      : (resourceCounts(sessionId)['managed-goal_state'] ?? 0);
  const staged = () => (LOCAL ? null : opened.stores.resourceStore.staged.size);
  return { ...opened, sessionId, runtimeBaseDir, goalBodies, staged };
}
const goal = (sessionKey, commandId, title, extra = {}) => [
  { operation: 'setGoal', commandId, sessionKey, contentDigest: D, ...extra },
  { domain: 'goal_state', content: { goalId: 'goal-1', title } },
  { class: 'trusted_entry' },
];

// R10
{
  const s = await fresh('r10');
  const a = s.session.authority;
  await a.commitDomainRecord(...goal(s.sessionKey, 'goal:1', 'one'));
  const before = { bodies: s.goalBodies(), staged: s.staged() };
  const outcomes = new Map();
  for (let i = 1; i <= 10; i += 1) {
    const r = await attempt(() =>
      a.commitDomainRecord(...goal(s.sessionKey, `goal:stale:${i}`, `s${i}`, { expectedSequence: 1 })),
    );
    outcomes.set(r.slice(0, 90), (outcomes.get(r.slice(0, 90)) ?? 0) + 1);
  }
  const after = { bodies: s.goalBodies(), staged: s.staged() };
  say('R10', {
    arm: ARM, store: LOCAL ? 'local' : 'http', refusals: Object.fromEntries(outcomes),
    leakedBodies: after.bodies - before.bodies,
    leakedStaged: LOCAL ? null : after.staged - before.staged,
  });
  await attempt(() => s.session.close());
}

// R11 (local only): a real append failure latches writeFailure.
if (LOCAL) {
  const s = await fresh('r11');
  const a = s.session.authority;
  await a.commitDomainRecord(...goal(s.sessionKey, 'goal:1', 'one'));
  const transcript = `${s.runtimeBaseDir}/session.jsonl`;
  fs.chmodSync(transcript, 0o444);
  const first = await attempt(() => a.commitDomainRecord(...goal(s.sessionKey, 'goal:2', 'two')));
  const latched = a.writesStopped ?? null;
  const before = s.goalBodies();
  const outcomes = new Map();
  for (let i = 3; i <= 7; i += 1) {
    const r = await attempt(() => a.commitDomainRecord(...goal(s.sessionKey, `goal:${i}`, `t${i}`)));
    outcomes.set(r.slice(0, 80), (outcomes.get(r.slice(0, 80)) ?? 0) + 1);
  }
  fs.chmodSync(transcript, 0o644);
  say('R11', {
    arm: ARM, firstFailure: first.slice(0, 90), writesStopped: latched,
    refusals: Object.fromEntries(outcomes), leakedBodies: s.goalBodies() - before,
  });
  await attempt(() => s.session.close());
}

// R12: idempotent retries of commands that carried expectedSequence.
{
  const s = await fresh('r12');
  const a = s.session.authority;
  const seq0 = a.committedSequence;
  const cmd = goal(s.sessionKey, 'goal:once', 'once', { expectedSequence: seq0 });
  const first = await attempt(() => a.commitDomainRecord(...cmd));
  const bodiesAfterFirst = s.goalBodies();
  let retryDomain;
  try {
    const r = await a.commitDomainRecord(...cmd);
    retryDomain = `replayed=${r.receipt.replayed}`;
  } catch (e) {
    retryDomain = `${e.name}: ${e.message.slice(0, 90)}`;
  }
  const bodiesAfterRetry = s.goalBodies();
  const plain = goal(s.sessionKey, 'goal:plain', 'plain');
  await a.commitDomainRecord(...plain);
  const retryPlain = await attempt(() => a.commitDomainRecord(...plain));

  const refs = new RefMapper(s.session.resources);
  const record = await refs.remap(FIXTURES.monitorChainCases[0].revisions[0].monitorRun);
  const ext = [
    { operation: 'commitMonitorRun', commandId: 'monitor-1:1', sessionKey: s.sessionKey, contentDigest: D, expectedSequence: a.committedSequence },
    { domain: 'monitor_run', record },
    { class: 'trusted_entry' },
  ];
  const extFirst = await attempt(() => a.commitExtensionRecord(...ext));
  let retryExt;
  try {
    const r = await a.commitExtensionRecord(...ext);
    retryExt = `replayed=${r.receipt.replayed}`;
  } catch (e) {
    retryExt = `${e.name}: ${e.message.slice(0, 90)}`;
  }
  say('R12', {
    arm: ARM, store: LOCAL ? 'local' : 'http',
    domain: { first, retryWithExpectedSequence: retryDomain, bodiesAfterFirst, bodiesAfterRetry },
    domainRetryWithoutExpectedSequence: retryPlain,
    extension: { first: extFirst, retryWithExpectedSequence: retryExt },
  });
  await attempt(() => s.session.close());
}
say('RESULT', { arm: ARM, store: LOCAL ? 'local' : 'http', done: true });
