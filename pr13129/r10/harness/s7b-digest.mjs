// S7b: which statements make up the per-operation SELECT cost? performance_schema digests over 3 operations
// on the long S7 Session (~5 200 hook_execution records) vs a fresh Session.   usage: node s7b-digest.mjs <ws> <longSessionId>
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, pin, sql, one, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS, LONG] = process.argv.slice(2);
const R = new Report(`s7b-digest-${WS}`);
const model = await startModel();
const h = await new Harness({ name: 's7b', modelUrl: model.url }).start();
const top = () =>
  sql(`SELECT COUNT_STAR, LEFT(REPLACE(DIGEST_TEXT, '\`', ''), 150) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME=DATABASE() AND DIGEST_TEXT LIKE 'SELECT%' ORDER BY COUNT_STAR DESC LIMIT 4`);
try {
  const w = await workspace(STORAGE[WS], WS);
  for (const [label, mk] of [
    ['fresh Session (0 records)', async () => { const id = await createWorkspaceSession(w.workspaceId); const s = new HSession(h, id, storeConnection(h, w.workspaceId)); await s.create({ hookCatalog: pin(WS) }); await s.hookOp('Notification', { message: 'warm', notification_type: 'rig' }); return s; }],
    [`long Session (${one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${LONG}' AND domain='hook_execution'`)} records)`, async () => { const s = new HSession(h, LONG, storeConnection(h, w.workspaceId)); let l; const t0 = Date.now(); for (let i = 0; i < 30; i++) { const a = Date.now(); l = await s.h.json(`/session/${LONG}/load`, { managedSessionStore: s.connection, toolProfile: s.profile }, { timeoutMs: 900_000 }); R.say(`   load attempt ${i + 1}: ${l.status} ${l.json?.code ?? ""} ${Date.now() - a} ms`); if (l.status === 200) { s.clientId = l.json.clientId; break; } await sleep(5000); } R.say(`   cold load of the long Session: ${Date.now() - t0} ms`); return s; }],
  ]) {
    const s = await mk();
    sql('TRUNCATE TABLE performance_schema.events_statements_summary_by_digest');
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await s.hookOp('Notification', { message: `digest-${i}`, notification_type: 'rig' });
    const ms = Date.now() - t0;
    const rows = top();
    R.say(`== ${label}: 3 operations in ${ms} ms`);
    for (const [n, text] of rows) R.say(`   ${String(n).padStart(7)}  ${text}`);
    await s.detach();
  }
} finally {
  await h.close();
  await model.close();
  R.done();
}
