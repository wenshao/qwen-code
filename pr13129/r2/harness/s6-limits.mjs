// S6 (test plan step 5): 17 parallel Hooks on one occurrence vs the 16-active Runtime limit, fail-open and fail-closed.
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, turn, pin, hookLedger, hookRecords, setControl, j } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const R = new Report(process.env.SKIP_FANOUT ? 's6-limits-bounds' : 's6-limits');
const model = await startModel();
const h = await new Harness({ name: 's6', modelUrl: model.url }).start();
try {
  setControl({ slow: { sleepMs: 4000 } });
  for (const WS of process.env.SKIP_FANOUT ? [] : ['ws-t5', 'ws-t5b']) {
    const w = await workspace(STORAGE[WS], WS);
    R.note(`${WS} rig repair`, String(await repairLeak(STORAGE[WS])));
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    await s.create({ hookCatalog: pin(WS) });
    const l0 = hookLedger().length;
    const a = Date.now();
    const op = await s.hookOp('Notification', { message: 'fanout', notification_type: 'rig' }, undefined, { timeoutMs: 120_000 });
    const ms = Date.now() - a;
    const kids = hookRecords(id, 'hook_execution').filter((r) => r.rec.ordinal > 0 && r.rec.eventName === 'Notification');
    const calls = hookLedger().slice(l0).filter((e) => e.name === 'slow' && !e.kind).length;
    const res = kids.map((k) => k.rec.run.state).reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
    R.say(`  ${WS}: op=${op.status} ${ms} ms output=${j(op.json?.output ?? op.json).slice(0, 200)} children=${kids.length} states=${j(res)} physical=${calls}`);
    const status = await s.status();
    const next = await s.submit(script([], 'NEXT'));
    await s.waitIdle();
    R.check(`${WS}: 17 children recorded, 16 executed physically, the refused one has a bounded receipt`, kids.length === 17 && calls === 16, `children=${kids.length} physical=${calls}`);
    if (WS === 'ws-t5') R.check('fail-open: the operation succeeds and the Session accepts the next prompt', op.status === 200 && op.json?.output?.continue !== false && next.status === 202, `op=${op.status} next=${next.status}`);
    else R.check('fail-closed: the refused Hook makes the aggregate blocking; Session still usable', op.status === 200 && (op.json?.output?.continue === false || op.json?.output?.decision === 'block') && next.status === 202, `op=${op.status} output=${j(op.json?.output).slice(0, 160)} next=${next.status} blocked=${status.recoveryBlocked}`);
    await s.detach();
  }
  // Output bounds: one oversized receipt (single Hook, 70 KB) and an oversized aggregate (8 x 10 KB)
  for (const [WS, ctl, label] of [['ws-t9d', { plain: { bigBytes: 70_000 } }, 'individual 70 KB receipt'], ['ws-t6b', { plain: { bigBytes: 10_000 } }, 'aggregate 8 x 10 KB']]) {
    setControl(ctl);
    const w = await workspace(STORAGE[WS], WS);
    R.note(`${WS} rig repair`, String(await repairLeak(STORAGE[WS])));
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    await s.create({ hookCatalog: pin(WS) });
    const l0 = hookLedger().length;
    const op = await s.hookOp('Notification', { message: 'big', notification_type: 'rig' }, undefined, { timeoutMs: 120_000 });
    const kids = hookRecords(id, 'hook_execution').filter((r) => r.rec.eventName === 'Notification');
    const calls = hookLedger().slice(l0).filter((e) => !e.kind && e.session === id).length;
    const out = JSON.stringify(op.json ?? {});
    R.note(`${label}: result`, `op=${op.status} bytes=${out.length} ${out.slice(0, 220)} children=${kids.filter((k) => k.rec.ordinal > 0).map((k) => k.rec.run.state).join(",")} plan=${kids.find((k) => k.rec.ordinal === 0)?.rec.run.state} physical=${calls}`);
    setControl({});
    const next = await s.prompt(script([], 'AFTER_BIG'));
    R.check(`${label}: bounded result (no 60 KB+ payload returned) and the Session continues`, out.length < 61_440 && next.terminal?.[0]?.type === 'turn_complete', `resultBytes=${out.length} next=${next.terminal?.[0]?.type}`);
    const replay = await s.hookOp('Notification', { message: 'big', notification_type: 'rig' }, op.operationId);
    R.check(`${label}: replaying the operation returns the saved result without re-running Hooks`, hookLedger().slice(l0).filter((e) => !e.kind && e.session === id).length === calls && j(replay.json) === j(op.json), `replay=${replay.status} physical=${hookLedger().slice(l0).filter((e) => !e.kind && e.session === id).length}`);
    await s.detach();
  }
} finally {
  setControl({});
  await h.close();
  await model.close();
  R.done();
}
