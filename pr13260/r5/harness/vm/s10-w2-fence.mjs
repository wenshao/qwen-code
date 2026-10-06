// PR #13260 S10: main's W2 (#13247, controlled cwd change) composed with W1c on a trial merge (W1c renumbered V47-V49).
// W2's begin/complete/probe paths were written without W1c's storage fence. With Spring admitting (the operator mistake
// the fence exists for): request a cwd change (a) after retire (storage fence installed, W1a mount still READY) and
// (b) after the W1a fence; controls: a W1c-gated sibling (close) on the same Session, and a cwd change on an unrelated
// storage. Then finish the migration and use the Session.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's10';
L.openLog(`s10-${TAG}`);
const { say } = L;
const R = { tag: TAG };
const SRC = '/srv/w1c-src/a'; const DST = '/srv/w1c-dst/a';
const read = (root, f) => { try { return fs.readFileSync(`${root}/${f}`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
const ctx = (sid) => { const r = L.sql(`SELECT IFNULL(cwd_relative,'-'), IFNULL(context_revision,'-') FROM managed_agent_session WHERE session_id='${sid}'`)[0]; return { cwd: r[0], rev: Number(r[1]) }; };
async function cwdChange(sid, target, label) {
  const before = ctx(sid);
  const r = await L.api('POST', `/v1/agents/sessions/${sid}/cwd`, { cwd_relative: target, expected_context_revision: before.rev }, { key: randomUUID() });
  const op = r.json?.operation_id ?? r.json?.id ?? r.json?.operationId;
  let st = r.json?.state ?? r.json?.status; let g = null;
  for (let i = 0; i < 80 && op && !['completed', 'failed', 'COMPLETED', 'FAILED'].includes(String(st)); i++) {
    await L.sleep(250); g = await L.api('GET', `/v1/agents/sessions/${sid}/operations/${op}`); st = g.json?.state ?? g.json?.status;
  }
  const after = ctx(sid);
  const out = { label, admit: `${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''}`, operation: op ? `${st}${g?.json?.failure_code ?? g?.json?.error_code ?? g?.json?.error?.code ? ` (${g.json.failure_code ?? g.json.error_code ?? g.json.error?.code})` : ''}` : '-',
    binding: `${before.cwd}@${before.rev} → ${after.cwd}@${after.rev}`, changed: after.rev !== before.rev };
  say(`   ${label.padEnd(58)} admit=${out.admit} op=${out.operation} binding ${out.binding}`);
  return out;
}
say(L.hostFacts()); say(`   server ${L.env().JAR} dist ${L.env().DIST}`);
await P.rollout(['a', 'b']);
L.seedWs('ws-a1', 'a'); L.seedWs('ws-b1', 'b');
for (const d of ['sub', 'sub2']) { fs.mkdirSync(`${SRC}/project/${d}`, { recursive: true }); fs.mkdirSync(`/srv/w1c-src/b/project/${d}`, { recursive: true }); }
const rig = await L.startRig(`s10-${TAG}`);
const S = {};
for (const [n, ws] of [['F1', 'ws-a1'], ['B1', 'ws-b1']]) {
  S[n] = new L.HSession(rig.h, await L.createSession(ws), ws);
  say(`   ${n} ${S[n].sessionId.slice(0, 8)} create=${(await S[n].create(L.FILES)).status} ${P.term(await S[n].prompt('WRITE notes.txt one'))} ${P.term(await S[n].prompt('WRITE notes.txt two'))} ctx=${JSON.stringify(ctx(S[n].sessionId))}`);
  await S[n].detach();
}
R.control0 = await cwdChange(S.B1.sessionId, 'project/sub', 'control: st-b cwd change, no maintenance');
await rig.h.stop(); await W.waitLeasesExpired('a'); await W.waitLeasesExpired('b');
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);
const m0 = L.mountRow('a');
const req = M.migrationRequest({ revision: m0.revision, source: SRC, target: DST, bundle: `/srv/w1c-bundles/${TAG}` });
const file = M.writeRequest(req, TAG);
say('== Spring keeps admitting; retire installs the storage fence');
const rt = await M.mig('retire', file, { label: `${TAG}-retire` });
say(`   fence=${M.fenceRow('a') ? 'installed' : 'none'} | ${L.mstr(L.mountRow('a'))}`);
R.afterRetire = {};
R.afterRetire.w2 = await cwdChange(S.F1.sessionId, 'project/sub', '(a) W2 cwd change on st-a after retire (fence up)');
R.afterRetire.otherStorage = await cwdChange(S.B1.sessionId, 'project/sub2', 'control: st-b cwd change while st-a is fenced');
R.afterRetire.sibling = await P.lifecycle(S.F1.sessionId, 'close');
say(`   W1c-gated sibling on the same Session (close): ${R.afterRetire.sibling}`);
await W.waitLeasesExpired('a');
L.sayMaint(`${TAG}-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC, String(m0.revision), req.fenceOperationId, '--offline-confirmed']));
R.afterW1a = await cwdChange(S.F1.sessionId, 'project/sub2', '(b) W2 cwd change on st-a after the W1a fence');
say('== finish the migration');
W.prepareBundle(TAG, { sessions: W.members('a').map((m) => m.id) });
const cap = await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: m0.revision, bundle: req.bundleRoot }), { label: `${TAG}-capture` });
L.sh(`cp -a ${SRC} ${DST}`);
const p = await M.mig('prepare', file, { label: `${TAG}-prepare` });
const q = await M.mig('promote', file, { label: `${TAG}-promote` });
R.migration = { retire: M.migSummary(rt), capture: W.summary(cap), prepare: M.migSummary(p), promote: M.migSummary(q), mount: L.mstr(L.mountRow('a')), f1: ctx(S.F1.sessionId) };
say(`   ${L.mstr(L.mountRow('a'))} | F1 binding now ${JSON.stringify(R.migration.f1)}`);
if (q.code === 0) {
  say('  ', L.svc(`ROOT_a=${DST}`, 'restart').split('\n').at(-1).slice(0, 140));
  const h = await new L.Harness({ name: `s10-${TAG}-after`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
  S.F1.bind(h); const ld = await S.F1.load(L.FILES); const t = await S.F1.prompt('WRITE where.txt after');
  R.after = { load: ld.status, turn: P.term(t), file: { 'project/where.txt': read(`${DST}/project`, 'where.txt'), 'project/sub/where.txt': read(`${DST}/project/sub`, 'where.txt') } };
  say(`   after migration: load=${ld.status} turn=${R.after.turn} files=${JSON.stringify(R.after.file)}`);
  await S.F1.detach().catch(() => {}); await h.stop();
}
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s10-${TAG}.json`, JSON.stringify(R, null, 1));
say('S10-DONE');
