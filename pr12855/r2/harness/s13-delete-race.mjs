// S13: race a view-changing Stage H commit against DELETE of the public
// Session, sweeping the delay; count task.updated events that land after
// session.deleted. A/B: pre-lock jar (2331792cd8) vs 34e32da78c.
import { FIXTURES, RefMapper, api, commitMonitor, createPublicSession, openLog, openSession, say, sleep, sql } from './lib.mjs';
const PORT = Number(process.env.PORT);
const ARM = process.env.ARM;
openLog(`s13-delete-race-${ARM}`);
const PER = Number(process.env.PER ?? 6);
let trials = 0, violations = 0, commitOk = 0, commitErr = {}, deleteStatus = {};
const hits = [];
for (let delay = 0; delay <= 30; delay += 1) {
  for (let k = 0; k < PER; k++) {
    trials++;
    const pub = await createPublicSession({ actor: 'alice', port: PORT });
    const { session, sessionKey } = await openSession({ sessionId: pub.id, writerId: `race-${trials}`, create: true, port: PORT });
    const refs = new RefMapper(session.resources);
    const b = await Promise.all(FIXTURES.monitorChainCases[0].revisions.slice(0, 2).map((r) => refs.remap(r.monitorRun)));
    await commitMonitor(session, sessionKey, 'm:1', b[0]);
    const [c, d] = await Promise.all([
      commitMonitor(session, sessionKey, 'm:2', b[1]).then(() => 'ok', (e) => e.remoteCode ?? e.name),
      sleep(delay).then(() => api('DELETE', `/v1/agents/sessions/${pub.id}`, { actor: 'alice', idem: `del-${pub.id}`, port: PORT })).then((r) => r.status),
    ]);
    if (c === 'ok') commitOk++; else commitErr[c] = (commitErr[c] ?? 0) + 1;
    deleteStatus[d] = (deleteStatus[d] ?? 0) + 1;
    const rows = sql(`SELECT sequence_id, event_type FROM managed_agent_event WHERE session_id='${pub.id}' ORDER BY sequence_id`, process.env.DB);
    const deletedAt = rows.find((r) => r[1] === 'session.deleted')?.[0];
    const late = deletedAt === undefined ? [] : rows.filter((r) => r[1] === 'task.updated' && Number(r[0]) > Number(deletedAt));
    if (late.length) { violations++; if (hits.length < 5) hits.push({ delay, events: rows.map((r) => `${r[0]}:${r[1]}`) }); }
    await session.close().catch(() => {});
  }
}
say(ARM, { trials, violations, commitOk, commitErr, deleteStatus, sampleHits: hits });
