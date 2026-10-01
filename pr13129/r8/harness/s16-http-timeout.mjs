// S16: HTTP Hook timeouts are in seconds. PreToolUse HTTP Hook with timeout 15 s: (a) server never replies, no cancel;
// (b) server never replies, user cancels after the request arrived; (c) server replies after 5 s (control).
import fs from 'node:fs';
import { startHookHttp, repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, hookRecords, pin, sql, j, sleep } from './lib.mjs';
import { STORAGE, HTTP_PORT } from './manifest.mjs';
const arm = process.env.ARM ?? 'head';
const R = new Report(`s16-http-timeout-${arm}${process.env.S16_WS ? '-fresh' : ''}`);
const web = await startHookHttp(HTTP_PORT);
web.state.mode['/hang1'] = 'hang';
web.state.mode['/hang2'] = 'hang';
web.state.mode['/slow5'] = { delayMs: 5000 };
const model = await startModel();
const h = await new Harness({ name: `s16-${arm}`, modelUrl: model.url, arm }).start();
try {
  const [W1, W2] = (process.env.S16_WS ?? 'ws-hto1,ws-hto2').split(',');
  for (const [WS, label, doCancel] of [[W1, 'server never replies, no cancel', false], [W2, 'server never replies, user cancels', true], ['ws-hto3', 'server replies after 5 s (control)', false]]) {
    const w = await workspace(STORAGE[WS], WS);
    await repairLeak(STORAGE[WS]);
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    await s.create({ hookCatalog: pin(WS) });
    const f = `t-${Date.now()}.txt`;
    const h0 = web.ledger.length;
    const t0 = Date.now();
    const sub = await s.submit(script([[call('write_file', { file_path: f, content: 'x' })]], `T-${WS}`));
    for (let i = 0; i < 300 && web.ledger.length === h0; i++) await sleep(100);
    const tReq = Date.now() - t0;
    let cancelAt = null;
    if (doCancel) {
      await sleep(2000);
      cancelAt = Date.now() - t0;
      await s.cancel();
    }
    const st = await s.waitIdle(180_000);
    const idleAt = Date.now() - t0;
    const events = (await s.transcript()).filter((e) => e.promptId === sub.promptId);
    const term = events.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}${e.data?.stopReason ? `(${e.data.stopReason})` : ''}`).join(',') || '<none>';
    const rec = hookRecords(id, 'hook_execution').filter((r) => r.rec.eventName === 'PreToolUse' && r.rec.ordinal > 0).at(-1)?.rec;
    const next = await s.prompt(script([], 'NEXT'), 60_000);
    R.note(label, `request at ${tReq} ms${cancelAt ? `, cancel at ${cancelAt} ms` : ''}, idle at ${idleAt} ms; terminal=${term} hook=${rec?.run.state}/${j(rec?.run.execution)} written=${fs.existsSync(`${w.dir}/${f}`)} recoveryBlocked=${st.recoveryBlocked} next=${turn(next)} httpRequests=${web.ledger.length - h0}`);
    if (next.terminal?.[0]?.type !== 'turn_complete') {
      const d = await s.detach();
      const other = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
      await other.create();
      const po = await other.prompt(script([[call('write_file', { file_path: `other-${Date.now()}.txt`, content: 'o' })]], `OTHER-${WS}`), 60_000);
      await other.detach();
      R.note(`${label}: detach, then another Session (no Hooks) in the same Workspace`, `detach=${d.status} other=${turn(po)}`);
    } else await s.detach();
  }
} finally {
  await h.close();
  await model.close();
  await web.close();
  R.done();
}
