// S11 (bot R1-6 / R2-14 replay): a user cancels a turn while a Hook is running (UserPromptSubmit, PreToolUse,
// PostToolUse, Stop). Is the turn cancelled cleanly, and does the Session run the next turn?
import fs from 'node:fs';
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, hookRecords, setControl, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const arm = process.env.ARM ?? 'head';
const R = new Report(`s11-cancel-${arm}`);
const model = await startModel();
const h = await new Harness({ name: `s11-${arm}`, modelUrl: model.url, arm }).start();
try {
  for (const [stage, name, WS] of [['UserPromptSubmit', 'cxUps', 'ws-cx1'], ['PreToolUse', 'cxPre', 'ws-cx2'], ['PostToolUse', 'cxPost', 'ws-cx3'], ['Stop', 'cxStop', 'ws-cx4']]) {
    const w = await workspace(STORAGE[WS], WS);
    setControl({ [name]: { sleepMs: 8000 } });
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    await s.create({ hookCatalog: pin(WS) });
    const f = `cx-${stage}-${Date.now()}.txt`;
    const l0 = hookLedger().length;
    const sub = await s.submit(script([[call('write_file', { file_path: f, content: 'x' })]], `CX-${stage}`));
    for (let i = 0; i < 200 && !hookLedger().slice(l0).some((e) => e.name === name && e.session === id && !e.kind); i++) await sleep(100);
    await sleep(500);
    const c = await s.cancel();
    const st = await s.waitIdle(120_000);
    const events = (await s.transcript()).filter((e) => e.promptId === sub.promptId);
    const term = events.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}${e.data?.stopReason ? `(${e.data.stopReason})` : ''}`).join(',') || '<none>';
    const rec = hookRecords(id, 'hook_execution').filter((r) => r.rec.eventName === stage && r.rec.ordinal > 0).at(-1)?.rec;
    setControl({});
    const next = await s.prompt(script([], `NEXT-${stage}`), 60_000);
    R.check(`${stage}: cancel mid-Hook, then the Session runs the next turn`, next.terminal?.[0]?.type === 'turn_complete', `cancel=${c.status} terminal=${term} recoveryBlocked=${st.recoveryBlocked} hook=${rec?.run.state}/${j(rec?.run.execution)} written=${fs.existsSync(`${w.dir}/${f}`)} next=${turn(next)}`);
    if (next.terminal?.[0]?.type !== 'turn_complete') {
      const d = await s.detach();
      const l = await s.load();
      const again = await s.prompt(script([], `AGAIN-${stage}`), 60_000);
      const other = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
      await other.create();
      const po = await other.prompt(script([[call('write_file', { file_path: `other-${Date.now()}.txt`, content: 'o' })]], 'OTHER'), 60_000);
      await other.detach();
      R.note(`${stage}: another Session in the same Workspace`, turn(po));
      R.note(`${stage}: after detach + load`, `detach=${d.status} load=${l.status} ${l.json?.recoveryRequired ? 'recoveryRequired' : ''} ${turn(again)}`);
    }
    await s.detach();
  }
} finally {
  setControl({});
  await h.close();
  await model.close();
  R.done();
}
