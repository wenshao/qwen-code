// S12 (bot R1-1 / R2-3 / R1-2 replay): DELETE with a SessionEnd Hook that fails (throws), is refused before effect
// (missing handler revision), or has an unknown outcome (HTTP reply dropped); plus SessionDelete input.
import { repairLeak, Report, Harness, HSession, startModel, startHookHttp, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, hookRecords, setControl, sql, j } from './lib.mjs';
import { STORAGE, HTTP_PORT } from './manifest.mjs';
const arm = process.env.ARM ?? 'head';
const R = new Report(`s12-lifecycle-${arm}`);
const model = await startModel();
const web = await startHookHttp(HTTP_PORT);
web.state.mode['/end'] = 'drop';
const h = await new Harness({ name: `s12-${arm}`, modelUrl: model.url, arm }).start();
const leaseOf = (ws) => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${STORAGE[ws]}'),256)`)[0]?.[0] ?? '<no row>';
setControl({});
try {
  for (const [ws, label] of [['ws-life4', 'SessionEnd succeeds'], ['ws-life1', 'SessionEnd throws'], ['ws-life2', 'SessionEnd refused before effect (missing handler revision)'], ['ws-life3', 'SessionEnd HTTP reply dropped (unknown)']]) {
    const w = await workspace(STORAGE[ws], ws);
    await repairLeak(STORAGE[ws]);
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    await s.create({ hookCatalog: pin(ws) });
    await s.prompt(script([[call('write_file', { file_path: `life-${Date.now()}.txt`, content: 'x' })]], 'LIFE'));
    const l0 = hookLedger().length;
    const w0 = web.ledger.length;
    const d1 = await s.remove();
    const d2 = await s.remove();
    const d3 = await s.remove();
    const httpReqs = web.ledger.length - w0;
    const st = await s.h.json(`/session/${id}/status`, undefined, { clientId: s.clientId });
    const del = hookLedger().slice(l0).filter((e) => e.session === id && e.event === 'SessionDelete');
    const end = hookRecords(id, 'hook_execution').filter((r) => r.rec.eventName === 'SessionEnd' && r.rec.ordinal > 0).at(-1)?.rec;
    const other = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
    await other.create();
    const po = await other.prompt(script([[call('write_file', { file_path: `other-${Date.now()}.txt`, content: 'o' })]], 'OTHER'), 60_000);
    await other.detach();
    R.note(`${label}`, `DELETE=${d1.status} ${d1.json?.code ?? ''} retry=${d2.status} ${d2.json?.code ?? ''} retry2=${d3.status} ${d3.json?.code ?? ''} sessionEndHttpRequests=${httpReqs} status-after=${st.status} SessionEnd=${end?.run.state}/${j(end?.run.execution)} SessionDelete runs=${del.length} deleted_session_id=${del[0]?.deletedSessionId === id ? 'matches' : j(del[0]?.deletedSessionId)} lease=${leaseOf(ws)} otherSession=${turn(po).split(' ')[1]}`);
  }
} finally {
  await h.close();
  await model.close();
  await web.close();
  R.done();
}
