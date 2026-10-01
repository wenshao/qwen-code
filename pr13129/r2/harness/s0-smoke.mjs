// S0 smoke: one Hosted Workspace Session with the ws-t1 catalog, one write_file turn.
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, startActionStoreProxy, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, pin, hookLedger, hookRecords, execSummary, setControl, RUN, one, j } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const R = new Report('s0-smoke');
setControl({});
const model = await startModel(`${RUN}/model-s0.jsonl`);
const store = await startActionStoreProxy();
const h = await new Harness({ name: 's0', modelUrl: model.url }).start();
R.say(`harness boot=${h.bootId} mysql=${one('SELECT VERSION()')}`);
try {
  const w = await workspace(STORAGE['ws-t1'], 'ws-t1');
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, { ...storeConnection(h, w.workspaceId), baseUrl: store.url });
  const c = await s.create({ hookCatalog: pin('ws-t1') });
  R.check('create with hookCatalog', c.status === 200, `status=${c.status} ${j(c.json).slice(0, 200)}`);
  const before = (await s.hooks()).json;
  R.note('GET hooks before first use', j(before).slice(0, 200));
  const l0 = hookLedger().length;
  const p = await s.prompt(script([[call('write_file', { file_path: 'smoke.txt', content: 'hello' })]], 'SMOKE_DONE'));
  R.check('turn completes', p.terminal?.[0]?.type === 'turn_complete', turn(p));
  R.say('  trace: ' + toolTrace(p.events).join(' | '));
  const led = hookLedger().slice(l0);
  R.say('  ledger: ' + led.map((e) => `${e.name}:${e.event}${e.kind ? '/' + e.kind : ''}`).join(' '));
  R.say('  file: ' + (fs.existsSync(`${w.dir}/smoke.txt`) ? fs.readFileSync(`${w.dir}/smoke.txt`, 'utf8') : '<missing>'));
  const recs = hookRecords(id);
  R.say(`  records: ${recs.length} ` + recs.map((r) => (r.domain === 'hook_registration' ? `REG(${r.rec.catalogId}@${r.rec.catalogRevision})` : execSummary(r))).join(' ; '));
  R.say('  model markers per request: ' + model.requests.map((q) => `[${q.markers.join(',')}]`).join(' '));
  const after = (await s.hooks()).json;
  R.note('GET hooks after', j(after).slice(0, 400));
} finally {
  await h.stop();
  await model.close();
  await store.close();
  R.done();
}
