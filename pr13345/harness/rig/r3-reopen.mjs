// R3: reopen a Session whose journal holds goal_state envelopes after a later
// slice registered a goal_state body (Decision 7's "bodies added later").
//   PHASE=write  : today's dist of the arm writes 3 envelopes + a monitor
//                  chain of 2 revisions, then closes.
//   PHASE=reopen : DIST=<arm>/dist-future reopens the same Session.
// LOCAL=1 runs both phases on the local journal + resource files instead of
// the HTTP store, sharing one runtimeBaseDir.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  ARM, CORE, FIXTURES, RefMapper, SP, attempt, command, enableMonitorRun,
  journalTx, openLog, openSession, resourceCounts, say,
} from './lib.mjs';

const PHASE = process.env.PHASE;
const LOCAL = process.env.LOCAL === '1';
const STATE = `${SP}/rig/out/r3-${ARM}-${LOCAL ? 'local' : 'http'}.json`;
openLog(`r3-${ARM}-${LOCAL ? 'local' : 'http'}-${PHASE}`);
say('dist', CORE.replace(SP, '$S'));
enableMonitorRun();

if (PHASE === 'write') {
  const sessionId = randomUUID();
  const runtimeBaseDir = fs.mkdtempSync(`${SP}/rig/tmp/r3-`);
  const { session, sessionKey } = await openSession({
    sessionId,
    writerId: `r3w-${ARM}-${sessionId.slice(0, 8)}`,
    create: true,
    local: LOCAL,
    runtimeBaseDir,
  });
  const authority = session.authority;
  for (let i = 1; i <= 3; i += 1) {
    const content = { goalId: 'goal-1', title: `pre-body ${i}` };
    const receipt = await authority.commitDomainRecord(
      command(sessionKey, `goal:${i}`, content, 'setGoal'),
      { domain: 'goal_state', content },
      { class: 'trusted_entry' },
    );
    say('envelope', { revision: receipt.revision, kind: receipt.recordRef.kind });
  }
  const refs = new RefMapper(session.resources);
  const chain = FIXTURES.monitorChainCases[0].revisions;
  for (let i = 0; i < 2; i += 1) {
    const record = await refs.remap(chain[i].monitorRun);
    await authority.commitExtensionRecord(
      command(sessionKey, `monitor:${i + 1}`, record, 'commitMonitorRun'),
      { domain: 'monitor_run', record },
      { class: 'trusted_entry' },
    );
  }
  const views = authority.taskViews().map((v) => `${v.kind}:${v.state}/${v.runtimeState}`);
  say('written', {
    views,
    tx: LOCAL ? null : journalTx(sessionId),
    resources: LOCAL ? null : resourceCounts(sessionId),
  });
  await session.close();
  fs.writeFileSync(STATE, JSON.stringify({ sessionId, runtimeBaseDir, views }));
} else if (PHASE === 'reopen') {
  const { sessionId, runtimeBaseDir, views } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  let reads = 0;
  const fetchFn = async (url, init) => {
    if ((init?.method ?? 'GET') === 'GET' && /\/resources\//.test(String(url))) reads += 1;
    return fetch(url, init);
  };
  let outcome;
  let after = null;
  let goalRecord = null;
  const result = await attempt(async () => {
    const opened = await openSession({
      sessionId,
      writerId: `r3r-${ARM}-${randomUUID().slice(0, 8)}`,
      local: LOCAL,
      runtimeBaseDir,
      ...(LOCAL ? {} : { fetchFn }),
    });
    after = opened.session.authority
      .taskViews()
      .map((v) => `${v.kind}:${v.state}/${v.runtimeState}`);
    goalRecord = opened.session.authority.extensionRecord('goal_state', 'goal-1') ?? null;
    await opened.session.close();
  });
  outcome = result === 'committed' ? 'opened' : result;
  say('reopen', {
    outcome,
    viewsBefore: views,
    viewsAfter: after,
    goalStateMaterialized: goalRecord !== null,
    resourceGets: LOCAL ? null : reads,
  });
  say('RESULT', { arm: ARM, store: LOCAL ? 'local' : 'http', outcome, viewsAfter: after });
} else {
  throw new Error('PHASE=write|reopen');
}
