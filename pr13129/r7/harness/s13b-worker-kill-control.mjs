// S13b control: same worker SIGKILL on a plain (no Hook) Session. Run alone.
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, workerPids, sql, j, sleep } from './lib.mjs';
const arm = process.env.ARM ?? 'head';
const [WS, L] = process.argv.slice(2);
const R = new Report(`s13b-worker-kill-control-${arm}`);
const model = await startModel();
const h = await new Harness({ name: `s13b-${arm}`, modelUrl: model.url, arm }).start();
const leaseOf = () => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${L}'),256)`)[0]?.[0] ?? '<no row>';
const write = (s, f) => s.prompt(script([[call('write_file', { file_path: f, content: 'x' })]], `W-${f}`), 120_000);
try {
  const w = await workspace(L, WS);
  const before = new Set(workerPids());
  const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  await s.create();
  const p1 = await write(s, `k1-${Date.now()}.txt`);
  const mine = workerPids().filter((p) => !before.has(p));
  R.note('turn 1', `${turn(p1)} new workers=${j(mine)}`);
  for (const pid of mine) process.kill(pid, 'SIGKILL');
  await sleep(2000);
  const p2 = await write(s, `k2-${Date.now()}.txt`);
  const p3 = await write(s, `k3-${Date.now()}.txt`);
  R.note('turns 2 and 3 after the worker was killed', `${turn(p2)} | ${turn(p3)} lease=${leaseOf()}`);
  const d = await s.detach();
  const o = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  await o.create();
  const po = await write(o, `k4-${Date.now()}.txt`);
  R.note('detach, then a new Session in the Workspace', `detach=${d.status} ${d.json?.code ?? ''} new=${turn(po)} lease=${leaseOf()}`);
  await o.detach();
} finally {
  await h.close();
  await model.close();
  R.done();
}
