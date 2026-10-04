// R4: a bypass writer plants an envelope-shaped body in a domain that has
// had a Stage H body all along (monitor_run). The authority's own checks run
// on the real record; only the published bytes are swapped, as a buggy or
// hostile writer would. Then the arm's normal dist reopens the Session.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  ARM, FIXTURES, RefMapper, SP, attempt, command, enableMonitorRun,
  journalTx, openLog, openSession, resourceCounts, say,
} from './lib.mjs';

const LOCAL = process.env.LOCAL === '1';
openLog(`r4-${ARM}-${LOCAL ? 'local' : 'http'}`);
enableMonitorRun();
const sessionId = randomUUID();
const runtimeBaseDir = fs.mkdtempSync(`${SP}/rig/tmp/r4-`);
const { session, sessionKey } = await openSession({
  sessionId,
  writerId: `r4w-${ARM}-${sessionId.slice(0, 8)}`,
  create: true,
  local: LOCAL,
  runtimeBaseDir,
});
const authority = session.authority;
const refs = new RefMapper(session.resources);
const chain = FIXTURES.monitorChainCases[0].revisions;
const first = await refs.remap(chain[0].monitorRun);
const firstReceipt = await authority.commitExtensionRecord(
  command(sessionKey, 'monitor:1', first, 'commitMonitorRun'),
  { domain: 'monitor_run', record: first },
  { class: 'trusted_entry' },
);
const viewsAfterFirst = authority.taskViews().map((v) => `${v.state}/${v.runtimeState}`);

// Swap the second revision's published bytes for the envelope shape.
const publish = session.resources.publish.bind(session.resources);
session.resources.publish = async (kind, bytes) =>
  kind === 'managed-monitor_run'
    ? publish(
        kind,
        Buffer.from(
          JSON.stringify({
            operationId: 'monitor:2',
            revision: 2,
            previousRecordRef: firstReceipt.recordRef,
            monitorId: 'monitor-1',
          }),
          'utf8',
        ),
      )
    : publish(kind, bytes);
const second = await refs.remap(chain[1].monitorRun);
const planted = await attempt(() =>
  authority.commitExtensionRecord(
    command(sessionKey, 'monitor:2', second, 'commitMonitorRun'),
    { domain: 'monitor_run', record: second },
    { class: 'trusted_entry' },
  ),
);
const viewsWriter = authority.taskViews().map((v) => `${v.state}/${v.runtimeState}`);
say('plant', {
  store: LOCAL ? 'local' : 'http',
  planted,
  writerViews: viewsWriter,
  viewsAfterFirst,
  tx: LOCAL ? null : journalTx(sessionId),
  resources: LOCAL ? null : resourceCounts(sessionId),
});
await attempt(() => session.close());

let after = null;
const reopened = await attempt(async () => {
  const opened = await openSession({
    sessionId,
    writerId: `r4r-${ARM}-${randomUUID().slice(0, 8)}`,
    local: LOCAL,
    runtimeBaseDir,
  });
  after = {
    views: opened.session.authority.taskViews().map((v) => `${v.state}/${v.runtimeState}`),
    revision: opened.session.authority.extensionRecord('monitor_run', 'monitor-1')?.revision ?? null,
  };
  await opened.session.close();
});
say('reopen', { outcome: reopened === 'committed' ? 'opened' : reopened, after });
say('RESULT', {
  arm: ARM,
  store: LOCAL ? 'local' : 'http',
  planted,
  reopen: reopened === 'committed' ? 'opened' : reopened,
  after,
});
