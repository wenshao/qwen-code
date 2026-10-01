// S2d: does loading + DELETE of the Session that owns the leaked hook Runtime Session free the Workspace?  usage: node s2d-delete.mjs <ws> <letter>
import { Report, Harness, HSession, startModel, workspace, storeConnection, sql, j, sleep } from './lib.mjs';
const [WS, L] = process.argv.slice(2);
const arm = process.env.ARM ?? "head";
const R = new Report(`s2d-${process.env.MODE ?? "delete"}-${arm}-${WS}`);
const model = await startModel();
const h = await new Harness({ name: `s2d-${arm}-${WS}`, modelUrl: model.url, arm }).start();
const leaseOf = () => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${L}'),256)`)[0]?.[0] ?? '<no row>';
try {
  const w = await workspace(L, WS);
  const holder = leaseOf();
  const owner = sql(`SELECT DISTINCT session_id FROM qwen_managed_session_extension_record WHERE domain='hook_execution' AND workspace_id='${WS}'`).map((r) => r[0]);
  const byHolder = sql(`SELECT r.session_id FROM qwen_managed_session_extension_record r JOIN qwen_managed_session_resource res ON res.session_scope_key=r.session_scope_key AND res.resource_id=r.record_resource_id WHERE r.domain='hook_execution' AND r.workspace_id='${WS}' AND CAST(res.inline_bytes AS CHAR) LIKE '%${holder}%' LIMIT 1`).map((r) => r[0]);
  R.note('lease holder / owning Session', `${holder} / ${byHolder.join(',')} (sessions with hook records: ${owner.length})`);
  for (const id of byHolder) {
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    let l;
    for (let i = 0; i < 20; i++) {
      l = await s.load();
      if (l.status === 200) break;
      await sleep(5000);
    }
    R.note(`load ${id}`, `${l.status} ${l.json?.code ?? ''}`);
    if (process.env.MODE === "prompt") { const { script, call, turn } = await import("./lib.mjs"); const p = await s.prompt(script([[call("write_file", { file_path: `own-${Date.now()}.txt`, content: "o" })]], "OWN")); R.note("owner prompt", turn(p)); }
    const d = process.env.MODE === "prompt" ? await s.detach() : await s.remove();
    R.note(process.env.MODE === "prompt" ? "detach" : 'DELETE', `${d.status} ${j(d.json ?? '').slice(0, 120)} lease=${leaseOf()}`);
  }
  R.check('Workspace lease freed after deleting the owning Session', leaseOf() === '<free>', leaseOf());
} finally {
  await h.stop();
  await model.close();
  R.done();
}
