// S3 (test plan step 2): catalog replacement pins future occurrences only; once Hooks stay consumed after a failed attempt;
// status/cancel never dispatch a replacement effect; registration idempotency and ordering.
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, hookRecords, setControl, RUN, api, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const R = new Report(`s3-catalog-${process.env.ARM ?? 'head'}`);
const model = await startModel(`${RUN}/model-s3.jsonl`);
const h = await new Harness({ name: 's3', modelUrl: model.url }).start();
const w = await workspace(STORAGE['ws-t2'], 'ws-t2');
R.note('rig repair of an earlier F1 leak', String(await repairLeak(STORAGE['ws-t2'])));
const names = (from) => hookLedger().slice(from).filter((e) => !e.kind).map((e) => e.name);
const tool = (s, f) => s.prompt(script([[call('write_file', { file_path: f, content: f })]], `DONE-${f}`));
try {
  setControl({ once: { throw: true } });
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin('ws-t2', 1) });
  let l0 = hookLedger().length;
  let m0 = model.requests.length;
  let p = await tool(s, 'c1.txt');
  R.check('P1 on rev1: h-a (rev1) runs, once Hook attempted and fails, turn still completes (fail-open)', p.terminal?.[0]?.type === 'turn_complete' && names(l0).includes('rev1') && names(l0).includes('once') && model.requests.slice(m0).some((q) => q.markers.includes('REV1-CTX')), `${turn(p)} hooks=${names(l0).join(',')}`);
  const reg = await s.register(1, pin('ws-t2', 2));
  R.check('register rev2 with expectedRevision=1', reg.status === 200, `${reg.status} ${j(reg.json)}`);
  const again = await s.register(1, pin('ws-t2', 2), reg.operationId);
  R.check('retrying the same registration operation is idempotent', again.status === 200, `${again.status} ${j(again.json)}`);
  const stale = await s.register(2, pin('ws-t2', 1));
  R.check('registering the older revision under a new operation is refused', stale.status === 409, `${stale.status} ${j(stale.json)}`);
  const wrong = await s.register(5, pin('ws-t2', 2));
  R.check('expectedRevision mismatch is refused', wrong.status === 409, `${wrong.status} ${j(wrong.json)}`);
  const bogus = await s.register(2, { catalogId: 'cat-t2', catalogRevision: 3, definitionDigest: 'e'.repeat(64) });
  R.check('a catalog revision the Runtime does not have is refused', bogus.status >= 400, `${bogus.status} ${j(bogus.json)}`);
  const cat = (await s.hooks()).json?.catalog;
  R.check('GET hooks reports rev2 without h-a', cat?.catalogRevision === 2 && cat.hooks.some((x) => x.hookId === 'h-b') && !cat.hooks.some((x) => x.hookId === 'h-a'), `rev=${cat?.catalogRevision} hooks=${cat?.hooks.map((x) => x.hookId).join(',')}`);
  const pub = await api('GET', `/v1/agents/sessions/${id}/hook-catalog`);
  R.check('public hook-catalog reports rev2', pub.status === 200 && pub.json.catalogs?.[0]?.catalog_revision === 2, `${pub.status} ${j(pub.json).slice(0, 300)}`);
  setControl({});
  l0 = hookLedger().length;
  m0 = model.requests.length;
  p = await tool(s, 'c2.txt');
  R.check('P2 on rev2: h-b runs, h-a does not, failed once Hook is not retried', p.terminal?.[0]?.type === 'turn_complete' && names(l0).includes('rev2') && !names(l0).includes('rev1') && !names(l0).includes('once'), `${turn(p)} hooks=${names(l0).join(',')}`);
  const recs = hookRecords(id, 'hook_execution').filter((r) => r.rec.ordinal > 0);
  const regs = hookRecords(id, 'hook_registration');
  const regRev = Object.fromEntries(regs.map((r) => [r.rec.registrationId, r.rec.catalogRevision]));
  R.say('  executions: ' + recs.map((r) => `${r.rec.eventName}:${r.rec.hookId}@rev${regRev[r.rec.registrationId]}${r.rec.onceKey ? '(once ' + r.rec.run.state + ')' : ''}`).join(' '));
  R.check('earlier executions stay bound to rev1, later ones to rev2', recs.filter((r) => r.rec.hookId === 'h-a').every((r) => regRev[r.rec.registrationId] === 1) && recs.filter((r) => r.rec.hookId === 'h-b').every((r) => regRev[r.rec.registrationId] === 2), `registrations=${regs.map((r) => `${r.rec.catalogRevision}@seq${r.seq}`).join(',')}`);
  // status and cancel of a settled once execution do not dispatch anything
  const onceRec = recs.find((r) => r.rec.hookId === 'h-once');
  l0 = hookLedger().length;
  const st = await s.hookStatus(onceRec.rec.hookExecutionId);
  const cn = await s.hookStatus(onceRec.rec.hookExecutionId, true);
  const st2 = await s.hookStatus(onceRec.rec.hookExecutionId);
  await sleep(1500);
  R.check('status/cancel/status of the failed once execution dispatch no new effect', st.status === 200 && cn.status === 200 && hookLedger().length === l0, `status=${st.status} ${st.json?.state}/${j(st.json?.execution)} cancel=${cn.status} ${cn.json?.state} after=${st2.json?.state} newLedger=${hookLedger().length - l0}`);
  // reload + cold restart: once stays consumed, rev2 stays effective
  await s.detach();
  await h.stop();
  const h2 = await new Harness({ name: 's3b', modelUrl: model.url }).start();
  const s2 = new HSession(h2, id, storeConnection(h2, w.workspaceId));
  let ld;
  for (let i = 0; i < 30; i++) {
    ld = await s2.load();
    if (ld.status === 200) break;
    await sleep(5000);
  }
  l0 = hookLedger().length;
  p = await tool(s2, 'c3.txt');
  R.check('after detach + new Harness: rev2 still effective, once still consumed', ld.status === 200 && p.terminal?.[0]?.type === 'turn_complete' && names(l0).includes('rev2') && !names(l0).includes('once'), `load=${ld.status} ${turn(p)} hooks=${names(l0).join(',')}`);
  // a fresh Session: once runs exactly once across turns
  const id2 = await createWorkspaceSession(w.workspaceId);
  await s2.detach();
  const t = new HSession(h2, id2, storeConnection(h2, w.workspaceId));
  await t.create({ hookCatalog: pin('ws-t2', 1) });
  l0 = hookLedger().length;
  for (const f of ['o1.txt', 'o2.txt', 'o3.txt']) await tool(t, f);
  R.check('fresh Session: successful once Hook runs exactly once over three turns', names(l0).filter((x) => x === 'once').length === 1, `once=${names(l0).filter((x) => x === 'once').length}`);
  await h2.close();
} finally {
  await h.stop();
  await model.close();
  R.done();
}
