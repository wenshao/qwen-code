// S7: upgrade main (V13) -> PR (V14) on one MariaDB database with live
// Sessions, then roll back to main. Phases are driven by the PHASE variable;
// the shell restarts the jar between phases.
import fs from 'node:fs';
import {
  FIXTURES, RefMapper, api, commitMonitor, createPublicSession, openLog, openSession, say, sql,
} from './lib.mjs';

const PHASE = process.env.PHASE;
const PORT = 18856;
const STATE = `${process.env.RIG_OUT}/s7-state.json`;
openLog(`${process.env.WT ? 'new-' : ''}s7-upgrade-${PHASE}`);
const meta = async (session, sessionKey, id) =>
  session.authority.commitDomainRecord(
    { operation: 'setMetadata', commandId: id, sessionKey, contentDigest: Buffer.from(id).toString('hex').padEnd(64, '0').slice(0, 64) },
    { domain: 'session_metadata', content: { title: id } },
    { class: 'trusted_entry' },
  );
const flyway = () => sql('SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 2', 'upg');

if (PHASE === 'main-before') {
  const pub = await createPublicSession({ actor: 'alice', port: PORT });
  const { session, sessionKey } = await openSession({ sessionId: pub.id, writerId: 'upg-a', create: true, port: PORT });
  for (let i = 1; i <= 3; i++) await meta(session, sessionKey, `meta-${i}`);
  await session.close();
  const t = await api('GET', `/v1/agents/sessions/${pub.id}/tasks`, { actor: 'alice', port: PORT });
  say('main', { flyway: flyway(), session: pub.id, capabilities: pub.capabilities, tasksRoute: [t.status, t.json?.error?.code] });
  fs.writeFileSync(STATE, JSON.stringify({ sessionId: pub.id }));
} else if (PHASE === 'pr-after') {
  const { sessionId } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const s = await api('GET', `/v1/agents/sessions/${sessionId}`, { actor: 'alice', port: PORT });
  const t0 = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice', port: PORT });
  const { session, sessionKey } = await openSession({ sessionId, writerId: 'upg-b', port: PORT });
  for (let i = 4; i <= 5; i++) await meta(session, sessionKey, `meta-${i}`);
  const refs = new RefMapper(session.resources);
  const chain = await Promise.all(FIXTURES.monitorChainCases[0].revisions.map((r) => refs.remap(r.monitorRun)));
  for (let i = 0; i < 3; i++) await commitMonitor(session, sessionKey, `m:${i}`, chain[i]);
  await session.close();
  const t1 = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice', port: PORT });
  say('pr', {
    flyway: flyway(),
    oldSessionCapabilities: s.json.capabilities,
    tasksBeforeStageH: t0.json,
    oldSessionCommitsAfterUpgrade: 'meta-4, meta-5 + 3 Stage H revisions committed',
    tasksAfter: t1.json.data.map((x) => `${x.state}/${x.runtime_state ?? '-'}`),
  });
} else if (PHASE === 'main-rollback') {
  const { sessionId } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const s = await api('GET', `/v1/agents/sessions/${sessionId}`, { actor: 'alice', port: PORT });
  let reopened;
  try {
    const { session, sessionKey } = await openSession({ sessionId, writerId: 'upg-c', port: PORT });
    await meta(session, sessionKey, 'meta-6');
    reopened = `reopened; ${session.authority.taskViews().length} task view(s) rebuilt by the PR client; meta-6 committed on main`;
    await session.close();
  } catch (e) {
    reopened = `${e.name}: ${String(e.message).slice(0, 160)}`;
  }
  const t = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice', port: PORT });
  say('main-rollback', { flyway: flyway(), session: [s.status, s.json.capabilities], reopen: reopened, tasksRoute: [t.status, t.json?.error?.code], rowsLeft: sql('SELECT COUNT(*) FROM qwen_managed_session_extension_record', 'upg')[0][0] });
}

if (PHASE === 'main-stageh') {
  // A Stage H revision lands while the old server runs (rolling deploy or
  // rollback window). main stores the journal bytes but writes no row.
  const { sessionId } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const { session, sessionKey } = await openSession({ sessionId, writerId: 'upg-d', port: PORT });
  const refs = new RefMapper(session.resources);
  const prev = session.authority.extensionRecord('monitor_run', 'monitor-1').record;
  const next = { ...prev, observationSequence: 1, lastObservationRef: await refs.remap(FIXTURES.monitorChainCases[0].revisions[3].monitorRun.lastObservationRef) };
  const r = await commitMonitor(session, sessionKey, 'm:3', next);
  await session.close();
  say('main-stageh', { committedOnMain: `revision ${r.revision}`, javaRow: sql(`SELECT revision, task_state FROM qwen_managed_session_extension_record WHERE session_id='${sessionId}'`, 'upg') });
} else if (PHASE === 'pr-again') {
  const { sessionId } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const { session, sessionKey } = await openSession({ sessionId, writerId: 'upg-e', port: PORT });
  const rec = session.authority.extensionRecord('monitor_run', 'monitor-1');
  const refs = new RefMapper(session.resources);
  // the next valid revision per the authority: the Runtime is lost
  const lost = await refs.remap(FIXTURES.monitorChainCases[0].revisions[4].monitorRun);
  const next = { ...lost, startReceiptRef: rec.record.startReceiptRef, lastObservationRef: rec.record.lastObservationRef, commandRef: rec.record.commandRef };
  let result;
  try {
    const r = await commitMonitor(session, sessionKey, 'm:4', next);
    result = `committed revision ${r.revision}`;
  } catch (e) {
    result = `${e.name} ${e.status ?? ''} ${e.remoteCode ?? ''}: ${String(e.message).slice(0, 160)}`;
  }
  await session.close().catch(() => {});
  const t = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice', port: PORT });
  say('pr-again', { authorityRevision: rec.revision, tsAcceptsNext: (await import('./lib.mjs')).projection.MANAGED_EXTENSION_RECORD_BODIES.monitor_run.isSuccessor(rec.record, next), commitNextOnPr: result, javaRow: sql(`SELECT revision, task_state FROM qwen_managed_session_extension_record WHERE session_id='${sessionId}'`, 'upg'), publicTask: t.json.data.map((x) => x.state) });
}
