// S8: a writer in tenant B commits a Stage H record under the Session ID of
// tenant A's public Session. The announce step must not touch A's stream.
import { FIXTURES, RefMapper, allEvents, api, commitMonitor, createPublicSession, openLog, openSession, say } from './lib.mjs';
const PORT = Number(process.env.PORT);
openLog(`s8-tenant-${process.env.ARM}`);
const pub = await createPublicSession({ tenant: 't-a', actor: 'alice', port: PORT });
const before = (await allEvents(pub.id, { tenant: 't-a', port: PORT })).map((e) => e.type);
const { session, sessionKey } = await openSession({ sessionId: pub.id, writerId: 'tenant-b-writer', create: true, tenant: 't-b', port: PORT });
const refs = new RefMapper(session.resources);
const body = await refs.remap(FIXTURES.monitorChainCases[0].revisions[0].monitorRun);
await commitMonitor(session, sessionKey, 'b:1', body);
await session.close();
const after = await allEvents(pub.id, { tenant: 't-a', port: PORT });
const tasksA = await api('GET', `/v1/agents/sessions/${pub.id}/tasks`, { tenant: 't-a', actor: 'alice', port: PORT });
say(process.env.ARM, {
  tenantA_eventsBefore: before,
  tenantA_eventsAfter: after.map((e) => e.type + (e.data?.taskId ? `(${e.data.taskId.slice(0, 13)}…)` : '')),
  tenantA_tasks: tasksA.json.data.length,
});
