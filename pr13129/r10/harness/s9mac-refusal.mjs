// S9-mac: managed command Hook without cgroup delegation (macOS): refused before any effect, not_started_proven,
// the blocked occurrence can be closed by cancellation, and the Session continues.
import fs from 'node:fs';
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookRecords, setControl, RUN, j } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const WS = process.env.WS ?? 'ws-t8';
const HOOK = process.env.HOOK ?? (WS === 'ws-t8' ? 'cmd-ups' : 'hv-ups');
const P = (tag) => (process.env.TOOL ? script([[call('write_file', { file_path: `${tag}.txt`, content: tag })]], tag) : script([], tag));
const R = new Report(`s9mac-refusal-${WS}-${process.env.ARM ?? 'head'}`);
const MARK = `${RUN}/cmd-ran.marker`;
fs.rmSync(MARK, { force: true });
setControl({});
const model = await startModel();
const h = await new Harness({ name: `s9mac-${WS}`, modelUrl: model.url, arm: process.env.ARM ?? 'head' }).start();
try {
  const w = await workspace(STORAGE[WS], WS);
  R.note('rig repair', String(await repairLeak(STORAGE[WS])));
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin(WS) });
  const p = await s.prompt(P('AFTER_CMD'));
  const rec = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === HOOK)?.rec;
  R.check('command Hook refused before any effect (marker file not created)', !fs.existsSync(MARK), `turn: ${turn(p)} record=${rec?.run.state}/${j(rec?.run.execution)}`);
  const st = await s.status();
  const next = await s.submit(P('NEXT'));
  R.note('Session after the refusal', `status.recoveryBlocked=${st.recoveryBlocked} next prompt -> ${next.status} ${next.json?.code ?? ''}`);
  if (next.status === 202) await s.waitIdle();
  if (rec) {
    const c = await s.hookStatus(rec.hookExecutionId, true);
    const after = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === HOOK)?.rec;
    R.note('cancel of the blocked execution', `${c.status} ${c.json?.state ?? c.json?.code} -> record ${after?.run.state}/${j(after?.run.execution)}`);
    const p2 = await s.prompt(P('AFTER_CANCEL'));
    R.check('after cancelling the blocked occurrence the Session accepts work again', p2.terminal?.[0]?.type === 'turn_complete' || p2.status === 202, `${turn(p2)}`);
  }
  const d = await s.detach();
  const l = await s.load();
  const p3 = await s.prompt(P('AFTER_RELOAD'));
  R.check('after cancel + detach + load the Session accepts work again', p3.terminal?.[0]?.type === 'turn_complete', `detach=${d.status} ${d.json?.code ?? ''} load=${l.status} ${l.json?.code ?? ''} ${turn(p3)}`);
  const p4 = await s.prompt(P('AGAIN'));
  const again = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === HOOK);
  R.note('next prompt after recovery', `${turn(p4)} cmd-ups records=${again.length} states=${again.map((r) => r.rec.run.state + '/' + r.rec.run.execution).join(',')}`);
  const plans = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === '__plan__');
  R.note('plan markers', plans.map((r) => `${r.rec.eventName}:${r.rec.run.state}/${j(r.rec.run.execution)} result=${Boolean(r.rec.resultRef)}`).join(' '));
  for (const pl of plans.filter((r) => !r.rec.resultRef)) {
    const c2 = await s.hookStatus(pl.rec.hookExecutionId, true);
    R.note(`cancel plan marker ${pl.rec.eventName}`, `${c2.status} ${c2.json?.state ?? c2.json?.code}`);
  }
  const p5 = await s.prompt(P('AFTER_PLAN_CANCEL'));
  R.check('after also cancelling the plan marker the Session accepts work', p5.terminal?.[0]?.type === 'turn_complete', turn(p5));
  R.note('turn status', j(await s.status()));
  const cx = await s.cancel();
  const d2 = await s.detach();
  const l2 = await s.load();
  const p6 = await s.prompt(P('AFTER_SESSION_CANCEL'));
  R.check('after /cancel + detach + load the Session accepts work', p6.terminal?.[0]?.type === 'turn_complete', `cancel=${cx.status} ${cx.json?.code ?? ''} detach=${d2.status} load=${l2.status} ${l2.json?.recoveryRequired ?? ''} ${turn(p6)}`);
  R.check('marker still absent at the end', !fs.existsSync(MARK));
} finally {
  await h.close();
  await model.close();
  R.done();
}
