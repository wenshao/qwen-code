// S2e: detach -> load -> hook turn -> detach -> load -> DELETE, on one Harness (checks reuse of a released hook Runtime Session id).
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, sql, hookLedger, j } from './lib.mjs';
const [WS, L] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head';
const R = new Report(`s2e-reattach-${arm}-${WS}`);
const model = await startModel();
const h = await new Harness({ name: `s2e-${arm}`, modelUrl: model.url, arm }).start();
const leaseOf = () => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${L}'),256)`)[0]?.[0] ?? '<no row>';
try {
  const w = await workspace(L, WS);
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin(WS) });
  for (let i = 1; i <= 3; i++) {
    const n0 = hookLedger().length;
    const p = await s.prompt(script([[call('write_file', { file_path: `r${i}.txt`, content: String(i) })]], `R${i}`));
    R.check(`round ${i}: hook turn completes`, p.terminal?.[0]?.type === 'turn_complete' && hookLedger().length > n0, `${turn(p)} hooks=${hookLedger().length - n0} lease=${leaseOf()}`);
    if (i < 3) {
      const d = await s.detach();
      const l = await s.load();
      R.check(`round ${i}: detach + load`, d.status === 204 && l.status === 200, `detach=${d.status} load=${l.status} ${l.json?.code ?? ''} lease=${leaseOf()}`);
    }
  }
  const del = await s.remove();
  R.check('DELETE frees the lease', del.status === 204 && leaseOf() === '<free>', `delete=${del.status} ${j(del.json ?? '')} lease=${leaseOf()}`);
} finally {
  await h.stop();
  await model.close();
  R.done();
}
