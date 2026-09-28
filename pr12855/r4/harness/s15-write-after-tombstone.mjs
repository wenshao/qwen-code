// S15 (D4, outside H0c): after a completed delete, can a new writer acquire
// the Session's journal and commit? H0c must not announce either way.
import { FIXTURES, RefMapper, api, commitMonitor, createPublicSession, javaRows, openLog, openSession, say, sleep, sql } from './lib.mjs';
openLog('s15-write-after-tombstone');
const pub = await createPublicSession({ actor: 'alice' });
const a = await openSession({ sessionId: pub.id, writerId: 'tA', create: true });
const refs = new RefMapper(a.session.resources);
const s0 = FIXTURES.monitorChainCases[0].revisions[0].monitorRun;
await commitMonitor(a.session, a.sessionKey, 'm0', await refs.remap({ ...s0, monitorId: 'm-0' }));
await a.session.close();
const del = await api('DELETE', `/v1/agents/sessions/${pub.id}`, { actor: 'alice', idem: `del-${pub.id}` });
let deleted = false;
for (let i = 0; i < 100 && !deleted; i++) { deleted = sql(`SELECT status FROM managed_agent_session WHERE session_id='${pub.id}'`)[0][0] === 'DELETED'; if (!deleted) await sleep(200); }
const out = { deleteStatus: del.status, deletedBeforeC: deleted, sessionGet: (await api('GET', `/v1/agents/sessions/${pub.id}`, { actor: 'alice' })).status };
try {
  const c = await openSession({ sessionId: pub.id, writerId: 'tC-after-tombstone' });
  out.cOpened = true;
  const refsC = new RefMapper(c.session.resources);
  const r = await commitMonitor(c.session, c.sessionKey, 'c1', await refsC.remap({ ...s0, monitorId: 'c-1' }));
  out.cCommitted = `revision ${r.revision} seq ${r.receipt.firstSequence}`;
  await c.session.close();
} catch (e) { out.cRefused = `${e.name} ${e.status ?? ''} ${e.remoteCode ?? ''}: ${String(e.message).slice(0, 100)}`; }
out.extensionRows = javaRows(pub.id).map((r) => `${r[0]}:${r[2]}`);
out.events = sql(`SELECT GROUP_CONCAT(CONCAT(sequence_id,':',event_type) ORDER BY sequence_id) FROM managed_agent_event WHERE session_id='${pub.id}'`)[0][0];
say('after-tombstone', out);
