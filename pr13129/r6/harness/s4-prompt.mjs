// S4 (test plan step 3): prompt Hooks outside a user turn (Notification), exclusive model ownership, durable usage,
// no user turn; explicit DELETE drains then runs SessionEnd -> SessionDelete; detach runs neither.
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, hookRecords, setControl, RUN, api, j, sleep, sql } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
import { randomUUID } from 'node:crypto';
const R = new Report(`s4-prompt-${process.env.ARM ?? 'head'}`);
const model = await startModel(`${RUN}/model-s4.jsonl`);
const h = await new Harness({ name: 's4', modelUrl: model.url }).start();
const w = await workspace(STORAGE['ws-t3'], 'ws-t3');
R.note('rig repair of an earlier F1 leak', String(await repairLeak(STORAGE['ws-t3'])));
const names = (from) => hookLedger().slice(from).map((e) => `${e.name}${e.kind ? '/' + e.kind : ''}:${e.event ?? ''}`);
setControl({});
try {
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin('ws-t3') });
  const ev0 = (await s.transcript()).length;
  let m0 = model.requests.length;
  const op = await s.hookOp('Notification', { message: 'deploy finished', notification_type: 'rig' });
  const hookReqs = model.requests.slice(m0);
  R.check('Notification operation outside a turn: 200 with aggregated prompt + function context', op.status === 200 && JSON.stringify(op.json).includes('PROMPT-NOTIFY-CTX') && JSON.stringify(op.json).includes('NOTIFY-CTX'), `${op.status} ${j(op.json).slice(0, 260)}`);
  R.check('exactly one model request, flagged as the prompt Hook', hookReqs.length === 1 && hookReqs[0].promptHook, `requests=${hookReqs.length} promptHook=${hookReqs.map((q) => q.promptHook)}`);
  const ev = await s.transcript();
  R.check('no user turn / prompt events were created by the operation', !ev.slice(ev0).some((e) => e.type.startsWith('turn_') || e.type === 'user_message'), `new events=${ev.slice(ev0).map((e) => e.type).join(',') || '<none>'}`);
  const st = await s.status();
  R.note('status after operation', j(st).slice(0, 200));
  // idempotent replay and conflict
  m0 = model.requests.length;
  const replay = await s.hookOp('Notification', { message: 'deploy finished', notification_type: 'rig' }, op.operationId);
  R.check('same operationId + same input replays the saved result, no new model request', replay.status === 200 && j(replay.json) === j(op.json) && model.requests.length === m0, `${replay.status} newModel=${model.requests.length - m0}`);
  const conflict = await s.hookOp('Notification', { message: 'different', notification_type: 'rig' }, op.operationId);
  R.check('same operationId + different input is refused', conflict.status >= 400, `${conflict.status} ${j(conflict.json)}`);
  // exclusive model ownership: slow prompt Hook vs a user prompt
  let release;
  const gate = new Promise((r) => (release = r));
  model.state.hook = async (entry) => {
    if (entry.promptHook) await gate;
  };
  const slowOp = s.hookOp('Notification', { message: 'slow one', notification_type: 'rig' });
  await sleep(1500);
  const during = await s.submit(script([], 'DURING'));
  release();
  const slowRes = await slowOp;
  model.state.hook = null;
  R.check('a user prompt is refused while a prompt Hook operation owns the model', during.status === 409, `prompt during op -> ${during.status} ${during.json?.code}; op -> ${slowRes.status}`);
  // and the reverse: operation during a turn
  let release2;
  const gate2 = new Promise((r) => (release2 = r));
  model.state.hook = async (entry) => {
    if (!entry.promptHook) await gate2;
  };
  const sub = await s.submit(script([], 'TURN'));
  await sleep(1500);
  const opDuring = await s.hookOp('Notification', { message: 'during turn', notification_type: 'rig' });
  release2();
  await s.waitIdle();
  model.state.hook = null;
  R.check('a Hook operation is refused while a user turn is active', sub.status === 202 && opDuring.status === 409, `turn=${sub.status} op during turn -> ${opDuring.status} ${opDuring.json?.code}`);
  // in-turn prompt Hook (UserPromptSubmit) context reaches the main request
  m0 = model.requests.length;
  const p = await s.prompt(script([], 'UPS'));
  const main = model.requests.slice(m0).filter((q) => !q.promptHook);
  R.check('in-turn prompt Hook (UserPromptSubmit) adds its context to the main model request', p.terminal?.[0]?.type === 'turn_complete' && main.some((q) => q.markers.includes('PROMPT-UPS-CTX')), `${turn(p)} hookReqs=${model.requests.slice(m0).filter((q) => q.promptHook).length}`);
  // durable model usage for the hook operation (record kinds in the Store)
  const kinds = sql(`SELECT kind, COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${id}' GROUP BY kind ORDER BY kind`);
  R.note('Store resource kinds for the Session', kinds.map((k) => `${k[0]}=${k[1]}`).join(' '));
  // detach: no lifecycle Hooks; DELETE: SessionEnd then SessionDelete
  const id2 = await createWorkspaceSession(w.workspaceId);
  const d0 = hookLedger().length;
  await s.detach();
  const t = new HSession(h, id2, storeConnection(h, w.workspaceId));
  await t.create({ hookCatalog: pin('ws-t3') });
  await t.prompt(script([], 'T'));
  const dt = await t.detach();
  const afterDetach = names(d0).filter((x) => /lifecycle/.test(x));
  R.check('detach emits neither SessionEnd nor SessionDelete', dt.status === 204 && afterDetach.length === 0, `detach=${dt.status} lifecycle=${afterDetach.join(',') || '<none>'}`);
  const s2 = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s2.load();
  const x0 = hookLedger().length;
  const del = await s2.remove();
  const life = names(x0).filter((x) => /lifecycle:/.test(x));
  R.check('DELETE runs SessionEnd then SessionDelete, once each', del.status === 204 && life.join(',') === 'lifecycle:SessionEnd,lifecycle:SessionDelete', `delete=${del.status} ${life.join(',')}`);
} finally {
  await h.close();
  await model.close();
  R.done();
}
