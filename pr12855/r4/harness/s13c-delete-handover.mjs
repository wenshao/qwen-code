// S13c (D4): writer A commits and releases; DELETE is admitted; writer B takes
// the Session and commits a new Stage H record every few ms until the
// tombstone lands (or B is refused). Invariant: no task.updated after
// session.deleted. Also records whether B could open and commit during the
// deletion at all.
import { FIXTURES, RefMapper, api, commitMonitor, createPublicSession, openLog, openSession, say, sleep, sql } from './lib.mjs';
openLog(`s13c-delete-handover-${process.env.ARM ?? 'x'}`);
const TRIALS = Number(process.env.TRIALS ?? 20);
const out = { trials: 0, violations: 0, bOpened: 0, bOpenRefused: {}, commitsByB: 0, bCommitRefused: {}, announcedByB: 0, deletedWithin30s: 0, hits: [] };
for (let t = 0; t < TRIALS; t++) {
  out.trials++;
  const pub = await createPublicSession({ actor: 'alice' });
  const a = await openSession({ sessionId: pub.id, writerId: `hA-${t}`, create: true });
  const refs = new RefMapper(a.session.resources);
  const start0 = FIXTURES.monitorChainCases[0].revisions[0].monitorRun;
  await commitMonitor(a.session, a.sessionKey, 'm0', await refs.remap({ ...start0, monitorId: 'm-0' }));
  await a.session.close();
  const del = await api('DELETE', `/v1/agents/sessions/${pub.id}`, { actor: 'alice', idem: `del-${pub.id}` });
  let b;
  try { b = await openSession({ sessionId: pub.id, writerId: `hB-${t}` }); out.bOpened++; }
  catch (e) { const k = e.remoteCode ?? e.name; out.bOpenRefused[k] = (out.bOpenRefused[k] ?? 0) + 1; }
  const t0 = Date.now();
  let k = 0, deleted = false, extra = 0;
  const refsB = b ? new RefMapper(b.session.resources) : null;
  while ((!deleted || extra < 5) && Date.now() - t0 < 30000) {
    deleted = sql(`SELECT COUNT(*) FROM managed_agent_event WHERE session_id='${pub.id}' AND event_type='session.deleted'`)[0][0] === '1';
    if (deleted) extra++;
    if (b) {
      k++;
      try { await commitMonitor(b.session, b.sessionKey, `b${k}`, await refsB.remap({ ...start0, monitorId: `b-${k}` })); out.commitsByB++; }
      catch (e) { const c = e.remoteCode ?? e.name; out.bCommitRefused[c] = (out.bCommitRefused[c] ?? 0) + 1; await b.session.close().catch(() => {}); b = null; }
    } else if (!deleted) { await sleep(200); }
    await sleep(3);
  }
  if (b) await b.session.close().catch(() => {});
  for (let i = 0; i < 100 && !deleted; i++) { await sleep(300); deleted = sql(`SELECT COUNT(*) FROM managed_agent_event WHERE session_id='${pub.id}' AND event_type='session.deleted'`)[0][0] === '1'; }
  if (deleted) out.deletedWithin30s++;
  const rows = sql(`SELECT sequence_id, event_type, JSON_VALUE(data_json,'$.taskId') FROM managed_agent_event WHERE session_id='${pub.id}' ORDER BY sequence_id`);
  const delAt = Number(rows.find((r) => r[1] === 'session.deleted')?.[0] ?? Infinity);
  const tasks = rows.filter((r) => r[1] === 'task.updated');
  out.announcedByB += Math.max(0, tasks.length - 1);
  const late = tasks.filter((r) => Number(r[0]) > delAt);
  if (late.length) { out.violations++; if (out.hits.length < 3) out.hits.push(rows.slice(-8).map((r) => `${r[0]}:${r[1]}`)); }
  out.deleteStatus = del.status;
}
say(process.env.ARM ?? 'x', out);
