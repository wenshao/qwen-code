// S14 (bot R2-5 replay): the Session Store refuses the activation install of a prompt-Hook operation (once / repeatedly).
// Does the Session keep (or restore) its activation, and are later prompts admitted only when they can run?
import { repairLeak, Report, Harness, HSession, startModel, startStoreProxy, workspace, createWorkspaceSession, storeConnection, script, turn, pin, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const arm = process.env.ARM ?? 'head';
const R = new Report(`s14-activation-fault-${arm}`);
const model = await startModel();
const proxy = await startStoreProxy();
let failures = 0;
const seen = [];
proxy.state.hook = (entry, parsed, body) => {
  const text = body.toString();
  if (!text.includes('managed-activation-install')) return 'forward';
  seen.push(entry.url);
  if (failures > 0) {
    failures--;
    return 'fail-503';
  }
  return 'forward';
};
const h = await new Harness({ name: `s14-${arm}`, modelUrl: model.url, arm }).start();
try {
  const w = await workspace(STORAGE[process.env.WS ?? 'ws-act'], process.env.WS ?? 'ws-act');
  await repairLeak(STORAGE[process.env.WS ?? 'ws-act']);
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, { ...storeConnection(h, w.workspaceId), baseUrl: proxy.url });
  await s.create({ hookCatalog: pin(process.env.WS ?? 'ws-act') });
  const warm = await s.prompt(script([], 'WARM'));
  R.note('warm-up turn', `${turn(warm)} activation-install writes seen so far=${seen.length}`);
  for (const [label, n] of [['one failed activation install', 1], ['repeated failures (install and restore)', 50]]) {
    failures = n;
    const s0 = seen.length;
    const op = await s.hookOp('Notification', { message: label, notification_type: 'rig' });
    const blockedInjected = seen.length - s0;
    const st = await s.status();
    const p = await s.prompt(script([], 'AFTER-FAULT'), 60_000);
    failures = 0;
    const p2 = p.terminal?.[0]?.type === 'turn_complete' ? null : await s.prompt(script([], 'AFTER-CLEAR'), 60_000);
    const d = await s.detach();
    const l = await s.load();
    const p3 = await s.prompt(script([], 'AFTER-RELOAD'), 60_000);
    R.note(`${label}: detach + load`, `detach=${d.status} ${d.json?.code ?? ''} load=${l.status} ${l.json?.code ?? ''} ${turn(p3)}`);
    R.note(label, `hookOp=${op.status} ${op.json?.code ?? ''} installs-hit=${blockedInjected} status.recoveryBlocked=${st.recoveryBlocked} next prompt: ${turn(p)}${p2 ? ` | after the fault cleared: ${turn(p2)}` : ''}`);
  }
  await s.detach();
} finally {
  await h.close();
  await model.close();
  await proxy.close();
  R.done();
}
