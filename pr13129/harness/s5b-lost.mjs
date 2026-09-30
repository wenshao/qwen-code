// S5b: (c) partial HTTP body in a clean Workspace; (d) lost dispatch ack + cold reload, then the Session's next tool turn,
// then detach+load as a workaround.  usage: node s5b-lost.mjs <httpWs> <ackWs>
import { repairLeak, Report, Harness, HSession, startModel, startBrokerProxy, startHookHttp, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, hookRecords, setControl, RUN, j, sleep, sql } from './lib.mjs';
import { STORAGE, HTTP_PORT } from './manifest.mjs';
const [HWS, AWS] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head';
const R = new Report(`s5b-lost-${arm}-${AWS}`);
const model = await startModel();
const web = await startHookHttp(HTTP_PORT);
const proxy = await startBrokerProxy();
let h = await new Harness({ name: `s5b-${arm}`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
const leaseOf = (ws) => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${STORAGE[ws]}'),256)`)[0]?.[0] ?? '<no row>';
const loadRetry = async (s) => {
  let ld;
  for (let i = 0; i < 30; i++) {
    ld = await s.load();
    if (ld.status === 200) break;
    await sleep(5000);
  }
  return ld;
};
setControl({});
try {
  if (HWS !== '-') {
    const w = await workspace(STORAGE[HWS], HWS);
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    await s.create({ hookCatalog: pin(HWS) });
    web.state.mode['/notify'] = 'partial';
    const t1 = web.ledger.length;
    const op = await s.hookOp('Notification', { message: 'mpartial', notification_type: 'rig' });
    const c = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === 'http-notify').at(-1)?.rec;
    const st = c && (await s.hookStatus(c.hookExecutionId));
    R.check('(c) partial response body: received once, stays unknown, blocks new work', web.ledger.length - t1 === 1 && op.status !== 200 && !c?.resultRef && (await s.submit(script([], 'X'))).status === 409, `op=${op.status} child=${c?.run.state}/${j(c?.run.execution)} status=${st?.json?.state} physical=${web.ledger.length - t1}`);
    web.state.mode['/notify'] = 'ok';
  }
  const w = await workspace(STORAGE[AWS], AWS);
  const id = await createWorkspaceSession(w.workspaceId);
  const s4 = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s4.create({ hookCatalog: pin(AWS) });
  const l0 = hookLedger().length;
  let dropped = 0;
  proxy.state.hook = (entry, parsed) => (parsed?.operation?.kind === 'hook-execute' && dropped++ === 0 ? 'drop-reply' : 'forward');
  const op = await s4.hookOp('Notification', { message: 'mack', notification_type: 'rig' });
  proxy.state.hook = null;
  R.note('(d) operation with the dispatch acknowledgement dropped', `${op.status} ${j(op.json)} dropped=${dropped}`);
  await h.stop('SIGKILL');
  h = await new Harness({ name: `s5b-${arm}-2`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
  const s5 = new HSession(h, id, storeConnection(h, w.workspaceId));
  const ld = await loadRetry(s5);
  const ack = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === 'ack').at(-1)?.rec;
  const st5 = await s5.hookStatus(ack.hookExecutionId);
  const led = hookLedger().slice(l0).filter((e) => e.name === 'plain');
  R.check('(d) cold reload reconciles: settled, ONE physical call, ONE success callback', st5.json?.state === 'settled' && led.filter((e) => !e.kind).length === 1 && led.filter((e) => e.kind).length === 1, `load=${ld.status} state=${st5.json?.state} calls=${led.filter((e) => !e.kind).length} callbacks=${led.filter((e) => e.kind).length} lease=${leaseOf(AWS)}`);
  let p5 = await s5.prompt(script([[call('write_file', { file_path: 'after-ack.txt', content: 'a' })]], 'AFTER_ACK'));
  R.check('(d) the reconciled Session then runs a normal tool turn', p5.terminal?.[0]?.type === 'turn_complete', `${turn(p5)} lease=${leaseOf(AWS)}`);
  if (p5.terminal?.[0]?.type !== 'turn_complete') {
    const d = await s5.detach();
    const l2 = await s5.load();
    p5 = await s5.prompt(script([[call('write_file', { file_path: 'after-ack2.txt', content: 'a' })]], 'AFTER_ACK2'));
    R.note('(d) workaround: detach + load on the same Harness, then a tool turn', `detach=${d.status} load=${l2.status} ${turn(p5)} lease=${leaseOf(AWS)}`);
  }
} finally {
  await h.close();
  await model.close();
  await web.close();
  await proxy.close();
  R.done();
}
