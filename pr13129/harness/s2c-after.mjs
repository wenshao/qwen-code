// S2c: after-the-fact check: can a fresh no-hook Session in each Workspace run a tool turn? usage: node s2c-after.mjs ws:letter ...
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, sql } from './lib.mjs';
const R = new Report(`s2c-after-${process.env.TAG ?? 'x'}`);
const model = await startModel();
const h = await new Harness({ name: `s2c-${process.env.TAG ?? 'x'}`, modelUrl: model.url }).start();
const leaseOf = (l) => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${l}'),256)`)[0]?.[0] ?? '<no row>';
try {
  for (const arg of process.argv.slice(2)) {
    const [ws, l] = arg.split(':');
    const w = await workspace(l, ws);
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    await s.create();
    const p = await s.prompt(script([[call('write_file', { file_path: `probe-${Date.now()}.txt`, content: 'x' })]], 'X'), 60_000);
    R.check(`${ws}: fresh no-hook Session tool turn`, p.terminal?.[0]?.type === 'turn_complete', `${turn(p)} lease=${leaseOf(l)}`);
    await s.detach();
  }
} finally {
  await h.stop();
  await model.close();
  R.done();
}
