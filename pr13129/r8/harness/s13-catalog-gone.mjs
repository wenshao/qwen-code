// S13 (bot R1-7 replay): the Session's Tool Runtime worker is replaced (SIGKILL) while the deployment manifest no longer
// contains the Session's pinned catalog. The next PreToolUse execute gets a definite Runtime refusal. Settled or unknown?
// Run alone (worker identification by PID diff).  usage: DB=<db> ARM=<arm> node s13-catalog-gone.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, pin, hookRecords, workerPids, sql, j, sleep, RIG, RUN, NODE } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const arm = process.env.ARM ?? 'head';
const R = new Report(`s13-catalog-gone-${arm}`);
const model = await startModel();
const h = await new Harness({ name: `s13-${arm}`, modelUrl: model.url, arm }).start();
const leaseOf = () => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${STORAGE['ws-dr']}'),256)`)[0]?.[0] ?? '<no row>';
const manifest = (drop) => execFileSync(NODE, [`${RIG}/probe/manifest.mjs`], { env: { ...process.env, DROP_CAT: drop ? 'ws-dr' : '' }, encoding: 'utf8' }).trim();
const write = (s, f) => s.prompt(script([[call('write_file', { file_path: f, content: 'x' })]], `W-${f}`), 120_000);
try {
  const w = await workspace(STORAGE['ws-dr'], 'ws-dr');
  R.note('rig repair', String(await repairLeak(STORAGE['ws-dr'])));
  const pinned = pin('ws-dr');
  const before = new Set(workerPids());
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pinned });
  const p1 = await write(s, 'dr-1.txt');
  const mine = workerPids().filter((p) => !before.has(p));
  R.check('turn 1 with the catalog present completes', p1.terminal?.[0]?.type === 'turn_complete' && fs.existsSync(`${w.dir}/dr-1.txt`), `${turn(p1)} new workers=${j(mine)}`);
  R.note('deployment manifest rewritten without cat-dr', manifest(true));
  for (const pid of mine) process.kill(pid, 'SIGKILL');
  await sleep(2000);
  const p2 = await write(s, 'dr-2.txt');
  const rec = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === 'dr-pre').at(-1)?.rec;
  const st = await s.status();
  R.note('turn 2 after the worker was replaced (catalog gone)', `${turn(p2)} written=${fs.existsSync(`${w.dir}/dr-2.txt`)} hook=${rec?.run.state}/${j(rec?.run.execution)} recoveryBlocked=${st.recoveryBlocked} lease=${leaseOf()} ${toolTrace(p2.events).filter((x) => x.startsWith('result')).join(' ').slice(0, 120)}`);
  const p3 = await write(s, 'dr-3.txt');
  R.check('the Session still runs the next tool turn (a definite refusal should settle under the fail policy)', p3.terminal?.[0]?.type === 'turn_complete', `${turn(p3)} lease=${leaseOf()}`);
  const d = await s.detach();
  R.note('detach', `${d.status} ${d.json?.code ?? ''} lease=${leaseOf()}`);
} finally {
  R.note('manifest restored', manifest(false));
  await h.close();
  await model.close();
  R.done();
}
