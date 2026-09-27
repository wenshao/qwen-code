// S12 (new head): task times with a writer whose clock runs behind, and a
// run that blocks before it starts. TS view == Java row, times monotonic.
import { FIXTURES, RefMapper, sql, api, commitMonitor, createPublicSession, javaRows, openLog, openSession, projection, say, tsViewAsRow } from './lib.mjs';
openLog(process.env.WT ? "new-s12-skew" : "s12-skew");
const BODY = projection.MANAGED_EXTENSION_RECORD_BODIES.monitor_run;
const pub = await createPublicSession({ actor: 'alice' });
const sessionId = pub.id;
const a = await openSession({ sessionId, writerId: 'skew-a', create: true });
const refs = new RefMapper(a.session.resources);
const revs = await Promise.all(FIXTURES.monitorChainCases[0].revisions.map((r) => refs.remap(r.monitorRun)));
await commitMonitor(a.session, a.sessionKey, 'm1:1', revs[0]);
await commitMonitor(a.session, a.sessionKey, 'm1:2', revs[1]);
// monitor-2 blocks while dispatching, before any start
await commitMonitor(a.session, a.sessionKey, 'm2:1', { ...revs[0], monitorId: 'monitor-2' });
await commitMonitor(a.session, a.sessionKey, 'm2:2', { ...revs[1], monitorId: 'monitor-2' });
const blocked = { ...revs[1], monitorId: 'monitor-2', run: { ...revs[1].run, state: 'recovery_blocked', reason: 'runtime_lost', execution: 'outcome_unknown' } };
let blockedOk; try { BODY.parse(blocked); blockedOk = BODY.isSuccessor({ ...revs[1], monitorId: 'monitor-2' }, blocked); } catch (e) { blockedOk = e.message.slice(0, 80); }
if (blockedOk === true) await commitMonitor(a.session, a.sessionKey, 'm2:3', blocked);
// hand over, pre-committing B's refs through A so Java holds them
await a.session.close();
const b = await openSession({ sessionId, writerId: 'skew-b' });
const held = new Set(sql(`SELECT resource_id FROM qwen_managed_session_resource WHERE session_id='${sessionId}'`).map((r) => r[0]));
const refsB = new RefMapper(b.session.resources);
for (const [k, p] of refs.map) { const ref = await p; if (held.has(ref.resourceId)) refsB.map.set(k, Promise.resolve(ref)); }
const revsB = await Promise.all(FIXTURES.monitorChainCases[0].revisions.map((r) => refsB.remap(r.monitorRun)));
const skew = 60_000;
const real = b.session.authority.now;
b.session.authority.now = () => real() - skew;
const created = b.session.authority.extensionRecord('monitor_run', 'monitor-1').task.createdAt;
for (let i = 2; i < 8; i++) {
  try { await commitMonitor(b.session, b.sessionKey, `m1:${i + 1}`, revsB[i]); } catch (e) { say('b-commit-error', `${i + 1}: ${e.message.slice(0, 120)}`); break; }
}
const rows = javaRows(sessionId);
const rec1 = b.session.authority.extensionRecord('monitor_run', 'monitor-1');
const rec2 = b.session.authority.extensionRecord('monitor_run', 'monitor-2');
const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
await b.session.close();
say('skew', {
  writerBClockBehindMs: skew,
  monitor1: { ts: tsViewAsRow(rec1), java: rows.find((r) => r[0] === 'monitor-1').slice(0, 10), createdByA: created },
  monitor1Monotonic: rec1.task.startedAt >= rec1.task.createdAt && rec1.task.settledAt >= rec1.task.startedAt,
  monitor1TimesClamped: { startedAtEqualsCreated: rec1.task.startedAt === rec1.task.createdAt, settledAtEqualsStarted: rec1.task.settledAt === rec1.task.startedAt },
  blockedBeforeStartAccepted: blockedOk,
  monitor2: { ts: tsViewAsRow(rec2), java: rows.find((r) => r[0] === 'monitor-2').slice(0, 10) },
  publicTasks: list.json.data.map((t) => ({ state: t.state, created_at: t.created_at, started_at: t.started_at ?? null, settled_at: t.settled_at ?? null })),
});
