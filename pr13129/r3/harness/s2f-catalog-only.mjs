// S2f: catalog-only acquisition window. A Hook Session registers a catalog revision (ensureReady acquires the hook
// Runtime Session) but never executes a Hook; the Harness is SIGKILLed. Can a new Harness (ARM2) recover the Workspace?
// usage: DB=<db> ARM=<first> ARM2=<second> node s2f-catalog-only.mjs <ws>
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, sql, hookRecords, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head';
const arm2 = process.env.ARM2 ?? arm;
const R = new Report(`s2f-catalog-only-${arm}-to-${arm2}-${WS}`);
const model = await startModel();
const leaseOf = () => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${STORAGE[WS]}'),256)`)[0]?.[0] ?? '<no row>';
let h = await new Harness({ name: `s2f-${arm}-${WS}`, modelUrl: model.url, arm }).start();
const w = await workspace(STORAGE[WS], WS);
const tool = (s, tag) => s.prompt(script([[call('write_file', { file_path: `${tag}-${Date.now()}.txt`, content: tag })]], `${tag}_DONE`), 60_000);
try {
  const id = await createWorkspaceSession(w.workspaceId);
  const A = new HSession(h, id, storeConnection(h, w.workspaceId));
  await A.create({ hookCatalog: pin(WS, 1) });
  const reg = await A.register(Number(process.env.EXPECTED ?? 0), pin(WS, 2));
  const recs = hookRecords(id);
  R.note('catalog registration only', `register=${reg.status} ${reg.json?.code ?? ''} records: registrations=${recs.filter((r) => r.domain === 'hook_registration').length} executions=${recs.filter((r) => r.domain === 'hook_execution').length} lease=${leaseOf()}`);
  await h.stop('SIGKILL');
  R.note('Harness SIGKILLed', `lease=${leaseOf()}`);
  h = await new Harness({ name: `s2f-${arm2}-${WS}-2`, modelUrl: model.url, arm: arm2 }).start();
  const A2 = new HSession(h, id, storeConnection(h, w.workspaceId));
  let l;
  for (let i = 0; i < 30; i++) {
    l = await A2.load();
    if (l.status === 200) break;
    await sleep(5000);
  }
  const p = await tool(A2, 'A');
  R.check(`${arm2}: reloaded Session runs a tool turn`, p.terminal?.[0]?.type === 'turn_complete', `load=${l.status} ${turn(p)} lease=${leaseOf()}`);
  const d = await A2.detach();
  const B = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  await B.create();
  const pb = await tool(B, 'B');
  R.check(`${arm2}: after detaching A, a plain Session runs a tool turn`, pb.terminal?.[0]?.type === 'turn_complete', `detach=${d.status} ${turn(pb)} lease=${leaseOf()}`);
  await B.detach();
} finally {
  await h.close();
  await model.close();
  R.done();
}
