// S1 (test plan step 1): permission Hooks before PreToolUse, rewritten args need fresh approval, top-level ask always asks,
// before-Hook context reaches the model after the tool and survives recovery without duplication.
import fs from 'node:fs';
import { repairLeak, Report, Harness, HSession, startModel, startActionStoreProxy, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, pin, hookLedger, hookRecords, execSummary, setControl, RUN, sleep, j } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const R = new Report(`s1-permission-${process.env.ARM ?? 'head'}`);
setControl({});
const model = await startModel(`${RUN}/model-s1.jsonl`);
const store = await startActionStoreProxy();
let h = await new Harness({ name: 's1', modelUrl: model.url }).start();
const w = await workspace(STORAGE['ws-t1'], 'ws-t1');
R.note('rig repair of an earlier F1 leak', String(await repairLeak(STORAGE['ws-t1'])));
const exists = (f) => fs.existsSync(`${w.dir}/${f}`);
const readf = (f) => (exists(f) ? fs.readFileSync(`${w.dir}/${f}`, 'utf8') : null);
const names = (from) => hookLedger().slice(from).filter((e) => !e.kind).map((e) => `${e.name}${e.toolInput?.file_path ? '(' + e.toolInput.file_path + ')' : ''}`);

// Drive a prompt; answer each new Action with the next decision in `answers`.
async function drive(s, text, answers = []) {
  const seen = store.actions.length;
  const sub = await s.submit(text);
  if (sub.status !== 202) return { ...sub, terminal: null, asked: [] };
  const asked = [];
  const end = Date.now() + 120_000;
  for (;;) {
    const st = await s.status();
    if (store.actions.length > seen + asked.length) {
      const id = store.actions[seen + asked.length];
      await sleep(300);
      const decision = answers[asked.length] ?? 'allow';
      const r = await s.resolve(id, decision);
      asked.push(`${decision}->${r.status}`);
      continue;
    }
    if (st && !st.hasActivePrompt) break;
    if (Date.now() > end) throw new Error('turn did not finish');
    await sleep(150);
  }
  const events = (await s.transcript()).filter((e) => e.promptId === sub.promptId);
  return { ...sub, events, terminal: events.filter((e) => e.type.startsWith('turn_')), status2: await s.status(), asked };
}

try {
  // --- default approval mode Session
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, { ...storeConnection(h, w.workspaceId), baseUrl: store.url });
  const c = await s.create({ hookCatalog: pin('ws-t1'), approvalMode: 'default', approvalTimeoutMs: 120_000 });
  R.check('create default-approval Session with catalog', c.status === 200, `status=${c.status} approvalMode=${c.json?.approvalMode}`);

  let l0 = hookLedger().length;
  let m0 = model.requests.length;
  let p = await drive(s, script([[call('write_file', { file_path: 'plain.txt', content: 'P1' })]], 'D1'));
  let order = names(l0);
  R.check('1a turn completes, no human Action (PermissionRequest Hook allowed)', p.terminal?.[0]?.type === 'turn_complete' && p.asked.length === 0 && readf('plain.txt') === 'P1', `${turn(p)} asked=${j(p.asked)} file=${readf('plain.txt')}`);
  R.check('1a PermissionRequest Hook ran before PreToolUse', order.indexOf('perm(plain.txt)') >= 0 && order.indexOf('perm(plain.txt)') < order.indexOf('pre(plain.txt)'), order.join(' > '));
  const req = model.requests.slice(m0);
  const after = req.find((q) => q.markers.includes('PRE-CTX:plain.txt'));
  R.check('1a before-Hook context reaches the model only after the tool result', req[0] && !req[0].markers.includes('PRE-CTX:plain.txt') && after && after.toolResults.length > 0, `requests=${req.map((q) => `[tools=${q.toolResults.length} ${q.markers.filter((x) => /PRE|POST|BATCH/.test(x)).join(',')}]`).join(' ')}`);

  // 1b PreToolUse deny
  l0 = hookLedger().length;
  p = await drive(s, script([[call('write_file', { file_path: 'blocked.txt', content: 'NO' })]], 'D2'));
  order = names(l0);
  R.check('1b PreToolUse deny: file not written, refusal reaches model, no PostToolUse for the refused call', p.terminal?.[0]?.type === 'turn_complete' && !exists('blocked.txt') && !order.some((x) => x.startsWith('post(blocked')) && toolTrace(p.events).join(' ').includes('RIG-PRE-DENY'), `${order.join(' > ')} | ${toolTrace(p.events).filter((x) => x.startsWith('result')).join(' ')}`);

  // 1c rewritten arguments -> fresh approval; allow -> only the replacement is written
  l0 = hookLedger().length;
  p = await drive(s, script([[call('write_file', { file_path: 'rewrite-a.txt', content: 'ORIGINAL' })]], 'D3'), ['allow']);
  order = names(l0);
  R.check('1c rewritten args need a fresh approval; only the approved replacement is written', p.terminal?.[0]?.type === 'turn_complete' && p.asked.length === 1 && readf('rewritten-a.txt') === 'REWRITTEN-BY-HOOK' && !exists('rewrite-a.txt'), `asked=${j(p.asked)} rewrite-a=${readf('rewrite-a.txt')} rewritten-a=${readf('rewritten-a.txt')} order=${order.join(' > ')}`);
  // 1c' deny the fresh approval -> nothing written
  p = await drive(s, script([[call('write_file', { file_path: 'rewrite-b.txt', content: 'ORIGINAL' })]], 'D3b'), ['deny']);
  R.check("1c' denying the fresh approval writes neither path", p.terminal?.[0]?.type === 'turn_complete' && p.asked.length === 1 && !exists('rewrite-b.txt') && !exists('rewritten-b.txt'), `asked=${j(p.asked)} ${toolTrace(p.events).filter((x) => x.startsWith('result')).join(' ')}`);

  // 1d PermissionRequest deny -> no PreToolUse, not written
  l0 = hookLedger().length;
  p = await drive(s, script([[call('write_file', { file_path: 'permdeny.txt', content: 'NO' })]], 'D4'));
  order = names(l0);
  R.check('1d PermissionRequest Hook deny: not written, PreToolUse not run', p.terminal?.[0]?.type === 'turn_complete' && !exists('permdeny.txt') && !order.some((x) => x.startsWith('pre(permdeny')) && p.asked.length === 0, `${order.join(' > ')} | ${toolTrace(p.events).filter((x) => x.startsWith('result')).join(' ')}`);

  // --- yolo Session: top-level ask always asks (after detaching s: an attached Hook Session holds the Workspace lease, F1)
  const ds = await s.detach();
  R.note("detach default Session before the yolo Session", String(ds.status));
  const id2 = await createWorkspaceSession(w.workspaceId);
  const y = new HSession(h, id2, { ...storeConnection(h, w.workspaceId), baseUrl: store.url });
  await y.create({ hookCatalog: pin('ws-t1'), approvalMode: 'yolo' });
  l0 = hookLedger().length;
  p = await drive(y, script([[call('write_file', { file_path: 'ask-y.txt', content: 'ASKED' })]], 'D5'), ['allow']);
  order = names(l0);
  R.check('1e yolo + PreToolUse ask -> Action requested; allow -> written; no PermissionRequest Hook in yolo', p.terminal?.[0]?.type === 'turn_complete' && p.asked.length === 1 && readf('ask-y.txt') === 'ASKED' && !order.some((x) => x.startsWith('perm(')), `asked=${j(p.asked)} order=${order.join(' > ')}`);
  p = await drive(y, script([[call('write_file', { file_path: 'ask-z.txt', content: 'ASKED' })]], 'D5b'), ['deny']);
  R.check("1e' yolo + ask, deny -> not written", p.terminal?.[0]?.type === 'turn_complete' && p.asked.length === 1 && !exists('ask-z.txt'), `asked=${j(p.asked)}`);

  // --- recovery without duplication: detach+load, then a cold Harness restart; the next model request carries each context once
  const count = (q, m) => q.markers.filter((x) => x === m).length;
  await y.detach();
  const rl = { load: (await s.load({ approvalMode: 'default' })).status };
  R.check('load again on the same Harness', rl.load === 200, j(rl));
  m0 = model.requests.length;
  p = await drive(s, script([], 'AFTER_RELOAD'));
  let q = model.requests.slice(m0).find((x) => !x.promptHook);
  R.check('after reload: PRE-CTX/POST-CTX of 1a appear exactly once in history', p.terminal?.[0]?.type === 'turn_complete' && q && count(q, 'PRE-CTX:plain.txt') === 1 && count(q, 'POST-CTX:plain.txt') === 1, `pre=${q && count(q, 'PRE-CTX:plain.txt')} post=${q && count(q, 'POST-CTX:plain.txt')} batch=${q && count(q, 'BATCH-CTX')}`);
  await h.stop('SIGKILL');
  h = await new Harness({ name: 's1b', modelUrl: model.url }).start();
  const s2 = new HSession(h, id, { ...storeConnection(h, w.workspaceId), baseUrl: store.url });
  let ld; const tl = Date.now(); for (;;) { ld = await s2.load({ approvalMode: 'default' }); if (ld.status === 200 || Date.now() - tl > 150_000) break; await sleep(5000); }
  R.note('cold load waited for the old writer lease', `${Math.round((Date.now() - tl) / 1000)}s`);
  R.check('cold load on a new Harness (catalog pin omitted -> restored)', ld.status === 200, `status=${ld.status} ${j(ld.json).slice(0, 160)}`);
  const hk = (await s2.hooks()).json;
  m0 = model.requests.length;
  l0 = hookLedger().length;
  p = await drive(s2, script([], 'AFTER_COLD'));
  R.note('first prompt after cold load', turn(p));
  if (p.terminal?.[0]?.type !== 'turn_complete') {
    R.note('F1 hit: rig repair, detach+load, retry', String(await repairLeak(STORAGE['ws-t1'])));
    await s2.detach();
    await s2.load({ approvalMode: 'default' });
    m0 = model.requests.length;
    l0 = hookLedger().length;
    p = await drive(s2, script([], 'AFTER_COLD2'));
  }
  q = model.requests.slice(m0).find((x) => !x.promptHook);
  R.check('after cold load: contexts still exactly once; SessionStart not re-run', p.terminal?.[0]?.type === 'turn_complete' && q && count(q, 'PRE-CTX:plain.txt') === 1 && count(q, 'POST-CTX:plain.txt') === 1 && !names(l0).some((x) => x.startsWith('start')), `pre=${q && count(q, 'PRE-CTX:plain.txt')} post=${q && count(q, 'POST-CTX:plain.txt')} hooks-after=${names(l0).join(' > ')} ${turn(p)} catalog=${hk?.catalog?.catalogId}@${hk?.catalog?.catalogRevision}`);
  const ld2 = await new HSession(h, id2, { ...storeConnection(h, w.workspaceId), baseUrl: store.url }).load({ hookCatalog: pin('ws-t1').catalogRevision && { ...pin('ws-t1'), definitionDigest: 'f'.repeat(64) } });
  R.check('load with a different catalog pin is refused', ld2.status === 409, `status=${ld2.status} ${ld2.json?.code}`);
  const recs = hookRecords(id);
  R.say(`records for Session 1: ${recs.length}; executions=${recs.filter((r) => r.domain === 'hook_execution' && r.rec.ordinal > 0).length}`);
} finally {
  await h.close();
  await model.close();
  await store.close();
  R.done();
}
