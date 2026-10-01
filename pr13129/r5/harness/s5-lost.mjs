// S5 (test plan step 4): lost HTTP reply / partial body -> unknown, no replay; received 500 -> settles;
// lost dispatch acknowledgement + cold reload -> exactly one effect and one success callback.
import { repairLeak, Report, Harness, HSession, startModel, startBrokerProxy, startHookHttp, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, hookRecords, setControl, RUN, j, sleep, sql } from './lib.mjs';
import { STORAGE, HTTP_PORT } from './manifest.mjs';
const R = new Report(`s5-lost-${process.env.ARM ?? 'head'}`);
const model = await startModel(`${RUN}/model-s5.jsonl`);
const web = await startHookHttp(HTTP_PORT);
const proxy = await startBrokerProxy();
let h = await new Harness({ name: 's5', modelUrl: model.url, brokerUrl: proxy.url }).start();
const leaseOf = (l) => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${l}'),256)`)[0]?.[0] ?? '<no row>';
setControl({});
try {
  // (a) received failure response settles
  let w = await workspace(STORAGE['ws-t4'], 'ws-t4');
  R.note('rig repair', String(await repairLeak(STORAGE['ws-t4'])));
  let id = await createWorkspaceSession(w.workspaceId);
  let s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin('ws-t4') });
  web.state.mode['/notify'] = { status: 500, body: { error: 'x' } };
  let op = await s.hookOp('Notification', { message: 'm500', notification_type: 'rig' });
  let n = web.ledger.filter((e) => e.path === '/notify').length;
  R.check('(a) HTTP 500 is a received failure: operation settles, Session stays usable', op.status === 200 && (await s.status()).recoveryBlocked === false, `op=${op.status} ${j(op.json).slice(0, 120)} requests=${n}`);
  // (b) dropped response after the request was received
  web.state.mode['/notify'] = 'drop';
  const t0 = web.ledger.length;
  op = await s.hookOp('Notification', { message: 'mdrop', notification_type: 'rig' });
  const recs = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === 'http-notify');
  const child = recs.at(-1)?.rec;
  R.check('(b) dropped HTTP reply: operation does not report success', op.status !== 200, `op=${op.status} ${j(op.json)} child=${child?.run.state}/${j(child?.run.execution)}`);
  const polls = [];
  for (let i = 0; i < 3; i++) {
    const st = await s.hookStatus(child.hookExecutionId);
    polls.push(`${st.status}:${st.json?.state ?? st.json?.code}/${j(st.json?.execution)}`);
  }
  await sleep(1000);
  R.check('(b) repeated status queries keep it unknown with ONE physical request', web.ledger.length - t0 === 1, `polls=${polls.join(' ')} physical=${web.ledger.length - t0}`);
  const blocked = await s.submit(script([], 'AFTER_UNKNOWN'));
  R.check('(b) new work is blocked', blocked.status === 409, `prompt -> ${blocked.status} ${blocked.json?.code}`);
  const cancel = await s.hookStatus(child.hookExecutionId, true);
  R.note('(b) cancel of the unknown execution', `${cancel.status} ${cancel.json?.state ?? cancel.json?.code}`);
  const det = await s.detach();
  R.note('(b) detach with an unknown Hook outcome', `${det.status} ${det.json?.code ?? ''}; lease=${leaseOf(STORAGE['ws-t4'])}`);
  // does the Workspace stay usable for another Session?
  const other = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  await other.create();
  const po = await other.prompt(script([[call('write_file', { file_path: 'other.txt', content: 'o' })]], 'OTHER'), 60_000);
  R.check('(b) another no-hook Session in the same Workspace can still run a tool turn', po.terminal?.[0]?.type === 'turn_complete', `${turn(po)} lease=${leaseOf(STORAGE['ws-t4'])}`);
  await other.detach();
  // cold reload of the blocked Session: still unknown, no replay
  await h.stop('SIGKILL');
  h = await new Harness({ name: 's5b', modelUrl: model.url, brokerUrl: proxy.url }).start();
  s = new HSession(h, id, storeConnection(h, w.workspaceId));
  let ld;
  for (let i = 0; i < 30; i++) {
    ld = await s.load();
    if (ld.status === 200) break;
    await sleep(5000);
  }
  const st2 = await s.hookStatus(child.hookExecutionId);
  const p2 = await s.submit(script([], 'AFTER_COLD'));
  await sleep(1000);
  R.check('(b) after a cold reload: still unknown, still blocked, still ONE physical request', web.ledger.length - t0 === 1 && p2.status === 409, `load=${ld.status} status=${st2.status}:${st2.json?.state ?? st2.json?.code} prompt=${p2.status} ${p2.json?.code} physical=${web.ledger.length - t0}`);
  // (c) partial body in a fresh Session
  web.state.mode['/notify'] = 'partial';
  id = await createWorkspaceSession(w.workspaceId);
  const s3 = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s3.create({ hookCatalog: pin('ws-t4') });
  const t1 = web.ledger.length;
  op = await s3.hookOp('Notification', { message: 'mpartial', notification_type: 'rig' });
  const c3 = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === 'http-notify').at(-1)?.rec;
  R.check('(c) partial response body stays unknown (not settled)', op.status !== 200 && !c3?.resultRef, `op=${op.status} ${j(op.json)} child=${c3?.run.state}/${j(c3?.run.execution)} physical=${web.ledger.length - t1}`);
  web.state.mode['/notify'] = 'ok';

  // (d) lost dispatch acknowledgement (Harness <- Broker reply of hook-execute dropped), then cold reload
  w = await workspace(STORAGE['ws-t9'], 'ws-t9');
  R.note('rig repair', String(await repairLeak(STORAGE['ws-t9'])));
  id = await createWorkspaceSession(w.workspaceId);
  const s4 = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s4.create({ hookCatalog: pin('ws-t9') });
  const l0 = hookLedger().length;
  let dropped = 0;
  proxy.state.hook = (entry, parsed) => (parsed?.operation?.kind === 'hook-execute' && dropped++ === 0 ? 'drop-reply' : 'forward');
  op = await s4.hookOp('Notification', { message: 'mack', notification_type: 'rig' });
  proxy.state.hook = null;
  R.note('(d) operation with the dispatch acknowledgement dropped', `${op.status} ${j(op.json)} droppedReplies=${dropped}`);
  await h.stop('SIGKILL');
  h = await new Harness({ name: 's5c', modelUrl: model.url, brokerUrl: proxy.url }).start();
  const s5 = new HSession(h, id, storeConnection(h, w.workspaceId));
  for (let i = 0; i < 30; i++) {
    ld = await s5.load();
    if (ld.status === 200) break;
    await sleep(5000);
  }
  const ack = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === 'ack').at(-1)?.rec;
  const st5 = await s5.hookStatus(ack.hookExecutionId);
  const op2 = await s5.hookOp('Notification', { message: 'mack', notification_type: 'rig' }, op.operationId);
  const p5 = await s5.prompt(script([[call('write_file', { file_path: 'after-ack.txt', content: 'a' })]], 'AFTER_ACK'));
  const led = hookLedger().slice(l0).filter((e) => e.name === 'plain' && (e.kind ? e.handlerId === 'ack' : e.session === id));
  R.check('(d) cold reload reconciles with the original owner: settled, ONE physical call, ONE success callback', st5.json?.state === 'settled' && led.filter((e) => !e.kind).length === 1 && led.filter((e) => e.kind === 'onHookSuccess').length === 1, `load=${ld.status} status=${st5.status}:${st5.json?.state}/${j(st5.json?.execution)} replay=${op2.status} calls=${led.filter((e) => !e.kind).length} callbacks=${led.filter((e) => e.kind).length}`);
  R.check('(d) the Session then runs a normal tool turn', p5.terminal?.[0]?.type === 'turn_complete', turn(p5));
  R.note('(d) Broker ledger', proxy.ledger.filter((e) => e.op?.startsWith('hook')).map((e) => `${e.op}->${e.status}`).join(' '));
} finally {
  await h.close();
  await model.close();
  await web.close();
  await proxy.close();
  R.done();
}
