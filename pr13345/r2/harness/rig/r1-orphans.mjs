// R1/R2: a refused commit, retried, against the real store.
// R1 is the envelope path that ships enabled today (commitDomainRecord on
// goal_state); R2 is the Stage H path (commitExtensionRecord on monitor_run,
// enabled in this process only). Counts the resource rows MariaDB holds.
import { randomUUID } from 'node:crypto';
import {
  ARM, FIXTURES, RefMapper, localCounts, attempt, command, enableMonitorRun, journalTx,
  openLog, openSession, resourceCounts, say, sql, TENANT,
} from './lib.mjs';

const RETRIES = Number(process.env.RETRIES ?? 20);
const LOCAL = process.env.LOCAL === '1';
openLog(`r1-orphans-${ARM}-${LOCAL ? 'local' : 'http'}`);
enableMonitorRun();
const sessionId = randomUUID();
const { session, sessionKey, stores, runtimeBaseDir } = await openSession({
  sessionId,
  writerId: `r1-${ARM}-${sessionId.slice(0, 8)}`,
  create: true,
  local: LOCAL,
});
const authority = session.authority;
const kinds = () =>
  LOCAL ? localCounts(runtimeBaseDir, sessionId) : resourceCounts(sessionId);
const staged = () => (LOCAL ? null : stores.resourceStore.staged.size);
say('arm', `${ARM} session=${sessionId}`);
say('store', LOCAL ? 'local resource files' : 'HTTP store -> Spring -> MariaDB');
say('start', { resources: kinds(), tx: journalTx(sessionId) });

// R1: envelope domain, refused actor, retried.
const r1Before = kinds()['managed-goal_state'] ?? 0;
const r1Results = new Map();
for (let i = 1; i <= RETRIES; i += 1) {
  const content = { goalId: 'goal-1', title: `retry ${i}` };
  const actor = i % 2 === 0 ? { class: 'harness' } : { class: 'authority' };
  const r = await attempt(() =>
    authority.commitDomainRecord(
      command(sessionKey, `goal:refused:${i}`, content, 'setGoal'),
      { domain: 'goal_state', content },
      actor,
    ),
  );
  r1Results.set(r, (r1Results.get(r) ?? 0) + 1);
}
const r1After = kinds()['managed-goal_state'] ?? 0;
say('R1 refusals', Object.fromEntries(r1Results));
const r1Staged = staged();
say('R1 goal_state bodies', { before: r1Before, afterRefusals: r1After, leaked: r1After - r1Before, stagedInMemory: r1Staged });
const r1Ok = await attempt(() =>
  authority.commitDomainRecord(
    command(sessionKey, 'goal:ok', { goalId: 'goal-1', title: 'ok' }, 'setGoal'),
    { domain: 'goal_state', content: { goalId: 'goal-1', title: 'ok' } },
    { class: 'trusted_entry' },
  ),
);
say('R1 positive control', { result: r1Ok, bodies: kinds()['managed-goal_state'] ?? 0 });

// R2: Stage H domain, refused actor and refused input, retried.
const refs = new RefMapper(session.resources);
const start = await refs.remap(FIXTURES.monitorChainCases[0].revisions[0].monitorRun);
const r2Before = kinds()['managed-monitor_run'] ?? 0;
const r2Actor = new Map();
for (let i = 1; i <= RETRIES / 2; i += 1) {
  const r = await attempt(() =>
    authority.commitExtensionRecord(
      command(sessionKey, `monitor:actor:${i}`, start, 'commitMonitorRun'),
      { domain: 'monitor_run', record: start },
      { class: 'authority' },
    ),
  );
  r2Actor.set(r, (r2Actor.get(r) ?? 0) + 1);
}
const contentRef = await session.resources.publish(
  'managed-input',
  Buffer.from('{"text":"changed"}', 'utf8'),
);
const admissionRef = await session.resources.publish(
  'managed-admission',
  Buffer.from('{}', 'utf8'),
);
const r2Input = new Map();
for (let i = 1; i <= RETRIES / 2; i += 1) {
  const r = await attempt(() =>
    authority.commitExtensionRecord(
      command(sessionKey, `monitor:input:${i}`, start, 'commitMonitorRun'),
      {
        domain: 'monitor_run',
        record: start,
        input: {
          inputId: '',
          turnId: `monitor:input:${i}`,
          source: 'monitor',
          contentRef,
          deadline: null,
          admissionRef,
          wakeReason: 'input',
        },
      },
      { class: 'trusted_entry' },
    ),
  );
  r2Input.set(r, (r2Input.get(r) ?? 0) + 1);
}
const r2After = kinds()['managed-monitor_run'] ?? 0;
say('R2 actor refusals', Object.fromEntries(r2Actor));
say('R2 input refusals', Object.fromEntries(r2Input));
const r2Staged = staged();
say('R2 monitor_run bodies', { before: r2Before, afterRefusals: r2After, leaked: r2After - r2Before, stagedInMemory: r2Staged });
const r2Ok = await attempt(() =>
  authority.commitExtensionRecord(
    command(sessionKey, 'monitor:ok', start, 'commitMonitorRun'),
    { domain: 'monitor_run', record: start },
    { class: 'trusted_entry' },
  ),
);
say('R2 positive control', {
  result: r2Ok,
  bodies: kinds()['managed-monitor_run'] ?? 0,
  javaRows: LOCAL ? null : Number(sql(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE tenant_id='${TENANT}' AND session_id='${sessionId}'`)[0][0]),
});
say('end', { resources: kinds(), tx: journalTx(sessionId) });
await session.close();
say('RESULT', {
  arm: ARM,
  store: LOCAL ? 'local' : 'http',
  r1Staged,
  r2Staged,
  r1Leaked: r1After - r1Before,
  r2Leaked: r2After - r2Before,
  r1Ok,
  r2Ok,
});
