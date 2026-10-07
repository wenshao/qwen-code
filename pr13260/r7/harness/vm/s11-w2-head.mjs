// PR #13260 S11 (head eda1f543, W2 merged in): W2 cwd change vs W1c's storage fence on the exact head, public HTTP,
// Spring admitting throughout.
//  st-a: cwd change after retire / after the W1a fence (+ close sibling, + st-b control), then finish the migration and
//        change cwd after promotion with QWEN_HOME unset (probe gate) and canonical.
//  st-c: cwd change queued BEFORE retire on the placement-guard lock;  st-d: retire queued BEFORE the cwd change.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's11';
L.openLog(`s11-${TAG}`);
const { say } = L;
const R = { tag: TAG };
const ST = ['a', 'b', 'c', 'd'];
const SRC = (s) => `/srv/w1c-src/${s}`; const DST = (s) => `/srv/w1c-dst/${s}`;
const read = (root, f) => { try { return fs.readFileSync(`${root}/${f}`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
const ctx = (sid) => { const r = L.sql(`SELECT IFNULL(cwd_relative,'-'), IFNULL(context_revision,'-') FROM managed_agent_session WHERE session_id='${sid}'`)[0]; return { cwd: r[0], rev: Number(r[1]) }; };
const opCount = (sid) => Number(L.one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='CWD_CHANGE'`));
async function cwdStart(sid, target) {
  const before = ctx(sid);
  return { before, ops: opCount(sid), p: L.api('POST', `/v1/agents/sessions/${sid}/cwd`, { cwd_relative: target, expected_context_revision: before.rev }, { key: randomUUID() }) };
}
async function cwdFinish(sid, started, label) {
  const r = await started.p;
  const op = r.json?.id ?? r.json?.operation_id;
  let st = r.json?.status; let g = null;
  for (let i = 0; i < 80 && op && !['completed', 'failed'].includes(String(st)); i++) { await L.sleep(250); g = await L.api('GET', `/v1/agents/sessions/${sid}/operations/${op}`); st = g.json?.status; }
  const after = ctx(sid);
  const out = { label, admit: `${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''}`, operation: op ? `${st}${g?.json?.failure_code ? ` (${g.json.failure_code})` : ''}` : '-',
    binding: `${started.before.cwd}@${started.before.rev} → ${after.cwd}@${after.rev}`, newOps: opCount(sid) - started.ops };
  say(`   ${label.padEnd(60)} admit=${out.admit} op=${out.operation} binding ${out.binding} new cwd ops=${out.newOps}`);
  return out;
}
const cwdChange = async (sid, target, label) => cwdFinish(sid, await cwdStart(sid, target), label);

say(L.hostFacts()); say(`   server ${L.env().JAR} dist ${L.env().DIST}`);
await P.rollout(ST);
for (const s of ST) { L.seedWs(`ws-${s}1`, s); for (const d of ['sub', 'sub2']) fs.mkdirSync(`${SRC(s)}/project/${d}`, { recursive: true }); }
const rig = await L.startRig(`s11-${TAG}`);
const S = {};
for (const s of ST) {
  S[s] = new L.HSession(rig.h, await L.createSession(`ws-${s}1`), `ws-${s}1`);
  say(`   st-${s} ${S[s].sessionId.slice(0, 8)} create=${(await S[s].create(L.FILES)).status} ${P.term(await S[s].prompt('WRITE notes.txt one'))} ${P.term(await S[s].prompt('WRITE notes.txt two'))}`);
  await S[s].detach();
}
await rig.h.stop(); for (const s of ST) await W.waitLeasesExpired(s);
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);  // N1
const req = {}; const file = {};
for (const s of ST) { req[s] = M.migrationRequest({ revision: L.mountRow(s).revision, storage: s, source: SRC(s), target: DST(s), bundle: `/srv/w1c-bundles/${TAG}-${s}` }); file[s] = M.writeRequest(req[s], `${TAG}-${s}`); }

say('== A st-a: cwd change at each maintenance step (Spring admitting)');
await M.mig('retire', file.a, { label: `${TAG}-a-retire` });
R.A = { afterRetire: await cwdChange(S.a.sessionId, 'project/sub', '(a) st-a cwd after retire (fence up, W1a READY)') };
R.A.otherStorage = await cwdChange(S.b.sessionId, 'project/sub', 'control: st-b cwd while st-a is fenced');
R.A.sibling = await P.lifecycle(S.a.sessionId, 'close'); say(`   W1c sibling close on st-a: ${R.A.sibling}`);
L.sayMaint(`${TAG}-a-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC('a'), String(req.a.mountRevision), req.a.fenceOperationId, '--offline-confirmed']));
R.A.afterW1a = await cwdChange(S.a.sessionId, 'project/sub2', '(b) st-a cwd after the W1a fence');

say('== B lock-queued races on the tenant placement-guard row');
const guardKey = L.one(`SELECT tenant_key FROM qwen_runtime_placement_guard WHERE tenant_id='${L.TENANT}'`);
for (const [s, order] of [['c', 'cwd-first'], ['d', 'retire-first']]) {
  const x = M.rowLockHolder('qwen_runtime_placement_guard', 'tenant_key', guardKey); await x.lock();
  let started; let rp;
  if (order === 'cwd-first') {
    started = await cwdStart(S[s].sessionId, 'project/sub'); await M.until(() => M.lockWaits() >= 1, 'cwd queued');
    rp = M.mig('retire', file[s], { label: `${TAG}-${s}-retire`, quiet: true }); await M.until(() => M.lockWaits() >= 2, 'retire queued');
  } else {
    rp = M.mig('retire', file[s], { label: `${TAG}-${s}-retire`, quiet: true }); await M.until(() => M.lockWaits() >= 1, 'retire queued');
    started = await cwdStart(S[s].sessionId, 'project/sub'); await M.until(() => M.lockWaits() >= 2, 'cwd queued');
  }
  x.release();
  const [cw, rr] = await Promise.all([cwdFinish(S[s].sessionId, started, `(${order}) st-${s} cwd`), rp]); x.close();
  R[`race_${s}`] = { order, cwd: cw, retire: rr.code === 0 ? M.migSummary(rr).slice(0, 30) : (rr.workerLine || rr.cause).slice(0, 90), fence: M.fenceRow(s) ? 'installed' : 'none' };
  say(`   (${order}) st-${s} retire: ${R[`race_${s}`].retire} | storage fence ${R[`race_${s}`].fence}`);
}

say('== C finish st-a; after promotion change cwd with QWEN_HOME unset, then canonical');
W.prepareBundle(`${TAG}-a`, { storage: 'a', sessions: W.members('a').map((m) => m.id) });
await W.w1b('capture', W.captureRequest({ op: req.a.captureOperationId, fence: req.a.fenceOperationId, revision: req.a.mountRevision, bundle: req.a.bundleRoot }), { label: `${TAG}-a-capture` });
L.sh(`cp -a ${SRC('a')} ${DST('a')}`);
await M.mig('prepare', file.a, { label: `${TAG}-a-prepare` });
const q = await M.mig('promote', file.a, { label: `${TAG}-a-promote` });
R.C = { promote: M.migSummary(q), mount: L.mstr(L.mountRow('a')) };
for (const qh of ['unset', 'default']) {
  say('  ', L.svc(`ROOT_a=${DST('a')}`, `QHOME=${qh}`, 'restart').split('\n').at(-1).slice(0, 160));
  for (let i = 0; i < 300; i++) { const hr = await fetch('http://127.0.0.1:8288/actuator/health').catch(() => null); if (hr?.ok) break; await L.sleep(1000); }
  R.C[qh] = await cwdChange(S.a.sessionId, qh === 'unset' ? 'project/sub' : 'project/sub2', `after promotion, QWEN_HOME=${qh}: st-a cwd`);
}
const h = await new L.Harness({ name: `s11-${TAG}-after`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
S.a.bind(h); const ld = await S.a.load(L.FILES); const t = await S.a.prompt('WRITE where.txt after');
R.C.turn = { load: ld.status, turn: P.term(t), files: { 'project/sub2/where.txt': read(`${DST('a')}/project/sub2`, 'where.txt'), 'project/where.txt': read(`${DST('a')}/project`, 'where.txt') } };
say(`   Turn after the canonical cwd change: load=${ld.status} ${R.C.turn.turn} files=${JSON.stringify(R.C.turn.files)}`);
await S.a.detach().catch(() => {}); await h.stop(); await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s11-${TAG}.json`, JSON.stringify(R, null, 1));
say('S11-DONE');
