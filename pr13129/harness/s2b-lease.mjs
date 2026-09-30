// S2b: Workspace execution lease with an attached Hook Session (idle), across a Harness restart, and a Spring restart check.
// usage: DB=hk ARM=head node s2b-lease.mjs <workspace> <letter> <hooks:yes|no> <restart:SIGTERM|SIGKILL|none>
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, sql, j, sleep, RUN } from './lib.mjs';
const [WS, LETTER, HOOKS, RESTART] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head';
const R = new Report(`s2b-lease-${arm}-${WS}-${HOOKS}-${RESTART}`);
const model = await startModel();
let h = await new Harness({ name: `s2b-${arm}-${WS}`, modelUrl: model.url, arm }).start();
const w = await workspace(LETTER, WS);
const key = sql(`SELECT storage_key FROM managed_workspace_execution_lease`).map((r) => r[0]);
const lease = () => {
  const rows = sql(`SELECT l.runtime_session_id FROM managed_workspace_execution_lease l`);
  return rows.map((r) => r[0]).filter((x) => x !== 'NULL').join(',') || '<free>';
};
const leaseOf = () => {
  // storage key for this letter = sha256(tenant \0 st-letter)
  const rows = sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${LETTER}'),256)`);
  return rows[0]?.[0] ?? '<no row>';
};
const conn = () => storeConnection(h, w.workspaceId);
const mk = async (hooks) => {
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, conn());
  const c = await s.create(hooks ? { hookCatalog: pin(WS) } : {});
  if (c.status !== 200) throw new Error(`create ${c.status} ${j(c.json)}`);
  return s;
};
const tool = (s, tag, ms = 60_000) => s.prompt(script([[call('write_file', { file_path: `${tag}-${Date.now()}.txt`, content: tag })]], `${tag}_DONE`), ms);
try {
  R.note('lease before', leaseOf());
  const A = await mk(HOOKS === 'yes');
  const pa = await tool(A, 'A1');
  R.check(`A (hooks=${HOOKS}) turn 1 completes`, pa.terminal?.[0]?.type === 'turn_complete', turn(pa));
  await sleep(300);
  const holderIdle = leaseOf();
  R.note('lease holder while A is attached and idle', holderIdle);
  const B = await mk(false);
  const pb = await tool(B, 'B1');
  R.check('B (no hooks, same Workspace) completes a tool turn while A is attached+idle', pb.terminal?.[0]?.type === 'turn_complete', turn(pb));
  R.note('lease after B', leaseOf());
  const pa2 = await tool(A, 'A2');
  R.check('A turn 2 completes', pa2.terminal?.[0]?.type === 'turn_complete', turn(pa2));
  if (RESTART !== 'none') {
    await h.stop(RESTART);
    R.note(`Harness stopped with ${RESTART}`, `lease=${leaseOf()}`);
    h = await new Harness({ name: `s2b-${arm}-${WS}-2`, modelUrl: model.url, arm }).start();
    const A2 = new HSession(h, A.sessionId, conn());
    let l; const t0=Date.now(); for(;;){ l = await A2.load(); if (l.status===200 || Date.now()-t0>150000) break; await sleep(5000);} R.note("load retried until writer lease lapsed", `${Math.round((Date.now()-t0)/1000)}s`);
    R.check('new Harness loads A', l.status === 200, `status=${l.status} ${l.json?.code ?? ''} lease=${leaseOf()}`);
    const pa3 = await tool(A2, 'A3');
    R.check('A turn after cold load completes', pa3.terminal?.[0]?.type === 'turn_complete', `${turn(pa3)} lease=${leaseOf()}`);
    const d = await A2.detach();
    R.note('A detached on the new Harness', `status=${d.status} ${d.json?.code ?? ''} lease=${leaseOf()}`);
    const B2 = await mk(false);
    const pb2 = await tool(B2, 'B2');
    R.check('a fresh no-hook Session in the Workspace completes a tool turn after A was detached', pb2.terminal?.[0]?.type === 'turn_complete', `${turn(pb2)} lease=${leaseOf()}`);
    await B2.detach();
  } else {
    const d = await A.detach();
    R.note('A detached', `status=${d.status} lease=${leaseOf()}`);
    const pb2 = await tool(B, 'B2');
    R.check('B turn after A detached', pb2.terminal?.[0]?.type === 'turn_complete', `${turn(pb2)} lease=${leaseOf()}`);
  }
  R.note('final lease', leaseOf());
} finally {
  await h.stop();
  await model.close();
  R.done();
}
