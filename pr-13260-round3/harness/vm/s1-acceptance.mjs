// PR #13260 S1: the production acceptance the PR lists as pending, on a real Linux host:
// stop -> retire (durable workers still running) -> W1a fence -> W1b capture -> external copy to ANOTHER filesystem ->
// prepare -> promote -> deployment remap + restart -> fresh file Turn -> undo (new and pre-migration prompts).
// Everything goes through the packaged artifacts: Spring fat jar (embedded Broker, durable local workers), the bundled CLI
// as Hosted Harness/worker, the workspace-bundle and workspace-migration jars, MySQL 8.4.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's1';
L.openLog(`s1-${TAG}`);
const { say } = L;
const R = { tag: TAG };
const SRC = '/srv/pr13260/src/a'; const DST = process.env.DST ?? '/srv/pr13260/dst/a';
say(L.hostFacts());
say(`   source ${SRC} on ${M.fsOf('/srv/pr13260/src')} | target ${DST} on ${M.fsOf(DST.split('/').slice(0, 4).join('/'))} | history ${W.historyRoot()} on ${M.fsOf('/var/lib/pr13260')}`);
say(`   server jar=${L.env().JAR} dist=${L.env().DIST} | migration jar=${M.MIG_JAR} | bundle jar=${W.BUNDLE_JAR} | db=${L.DB()}`);

// ---- rollout + population (Files-profile Sessions only: W1c refuses any other profile)
await P.rollout(['a', 'b']);
L.seedWs('ws-a1', 'a'); L.seedWs('ws-a2', 'a'); L.seedWs('ws-b1', 'b');
fs.mkdirSync(`${SRC}/project2`, { recursive: true }); L.chownRig(`${SRC}/project2`);
const rig = await L.startRig(`s1-${TAG}`);
const S = {}; const PR = {};
const read = (root, f) => { try { return fs.readFileSync(`${root}/${f}`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
const open = async (name, ws, cwd = 'project') => {
  const s = new L.HSession(rig.h, await L.createSession(ws, cwd), ws); const c = await s.create(L.FILES);
  say(`   ${name} ${s.sessionId} (${ws}/${cwd}) create=${c.status}${c.status !== 200 ? ` ${JSON.stringify(c.json).slice(0, 160)}` : ''}`);
  S[name] = s; return s;
};
const run = async (name, label, text) => { const r = await S[name].prompt(text); PR[label] = r.promptId; say(`     ${name} ${label} ${text}: ${P.term(r)}`); return r; };
const rewind = async (name, label, h = rig.h) => {
  const r = await h.json(`/session/${S[name].sessionId}/files/rewind`, { promptId: PR[label], requestId: randomUUID() }, { clientId: S[name].clientId });
  return `${r.status}${r.json?.code ? ` ${r.json.code}` : ''} filesChanged=${JSON.stringify(r.json?.filesChanged)} conflict=${r.json?.conflict}`;
};
say('== populate st-a (two Workspaces) and st-b');
await open('F1', 'ws-a1');
await run('F1', 'f1', 'WRITE notes.txt v1'); await run('F1', 'f2', 'WRITE notes.txt v2'); await run('F1', 'f3', 'WRITE deep/x.txt deep1'); await run('F1', 'f4', 'READ notes.txt');
await open('U', 'ws-a1');
await run('U', 'u1', 'WRITE undo.txt first'); await run('U', 'u2', 'WRITE undo.txt second');
say(`     U rewind u2 (pre-migration undo receipt): ${await rewind('U', 'u2')} -> undo.txt=${read(`${SRC}/project`, 'undo.txt')}`);
await open('F2', 'ws-a2', 'project2'); await run('F2', 'x1', 'WRITE other.txt x1'); await run('F2', 'x2', 'WRITE other.txt x2');
await open('F3', 'ws-a1'); await run('F3', 'c1', 'WRITE closed.txt c1');
await open('D1', 'ws-a1'); await run('D1', 'd1', 'WRITE del.txt d1');
await open('B1', 'ws-b1'); await run('B1', 'b1', 'WRITE b.txt b1');
for (const s of Object.values(S)) await s.detach();
R.lifecycle = [await P.lifecycle(S.F2.sessionId, 'close'), await P.lifecycle(S.F2.sessionId, 'archive'), await P.lifecycle(S.F3.sessionId, 'close'), await P.lifecycle(S.D1.sessionId, 'close'), await P.lifecycle(S.D1.sessionId, 'delete')];
say('   lifecycle F2', R.lifecycle[0], '+', R.lifecycle[1], '| F3', R.lifecycle[2], '| D1', R.lifecycle[3], '+', R.lifecycle[4]);
say(`   statuses: ${L.sql(`SELECT session_id, status FROM managed_agent_session WHERE tenant_id='${L.TENANT}' ORDER BY session_id`).map((r) => `${Object.entries(S).find(([, v]) => v.sessionId === r[0])?.[0]}=${r[1]}`).join(' ')}`);
R.sessions = Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.sessionId]));
const wk0 = M.workers();
say(`   durable workers alive before maintenance: ${wk0.length} [${wk0.map((w) => `${w.pid}@${w.cwd}`).join(', ')}]`);
say(`   st-a placements: ${M.placementStr(M.placements('a'))}`);
say(`   st-b placements: ${M.placementStr(M.placements('b'))}`);
const pa0 = M.placements('a').filter((p) => p.alive);

// ---- offline boundary: Harness + Spring stopped; durable workers deliberately LEFT RUNNING (old placements)
await rig.h.stop(); say('   Harness stopped');
say('  ', L.svc('stop') || 'service stopped (KillMode=process: durable workers survive)');
say(`   writer leases lapsed after ${await W.waitLeasesExpired('a')} ms; workers still alive: ${wk0.filter((w) => M.alive(w.pid)).length}/${wk0.length}`);
P.memberTable('a');
const m0 = L.mountRow('a');
say(`   ${L.mstr(m0)} root=${m0.root}`);
const A0 = W.authoritySnapshot(`${TAG}-before`);
const src0 = W.treeDigest(SRC); const hist0 = W.treeDigest(W.historyRoot()); const srcMarker0 = M.markerOf(SRC);
const bundle = `/srv/pr13260/bundles/${TAG}`; L.sh(`rm -rf ${bundle}`);
const req = M.migrationRequest({ revision: m0.revision, source: SRC, target: DST, bundle });
const file = M.writeRequest(req, `${TAG}`);
R.request = req;
say(`   request ${file}: migration=${req.migrationOperationId.slice(0, 8)} fence=${req.fenceOperationId.slice(0, 8)} capture=${req.captureOperationId.slice(0, 8)} revision=${req.mountRevision}`);

say('== 1 retire (old placements still running)');
const r1 = await M.mig('retire', file, { label: `${TAG}-retire` });
const goneA = pa0.map((p) => ({ ...p, alive: M.alive(p.pid) }));
say(`   st-a workers alive before retire: ${pa0.length}; after retire: ${goneA.filter((p) => p.alive).length} (${goneA.map((p) => `${p.pid}:${p.alive ? 'ALIVE' : 'gone'}`).join(' ')})`);
say(`   st-a placements: ${M.placementStr(M.placements('a'))}`);
say(`   st-b placements (unrelated storage, must survive): ${M.placementStr(M.placements('b'))}`);
say(`   st-a bindings: ${M.bindingStr(M.bindings('a'))} | st-b bindings: ${M.bindingStr(M.bindings('b'))} | fence=${M.fenceRow('a')?.slice(0, 8)} | ${M.migStr(M.migRow(req.migrationOperationId))}`);
const r1b = await M.mig('retire', file, { label: `${TAG}-retire-replay`, quiet: true });
say(`   retire replay: exit=${r1b.code} identical stdout=${r1b.stdout === r1.stdout}`);
R.retire = { exit: r1.code, workersBefore: pa0.length, workersAliveAfter: goneA.filter((p) => p.alive).length, stBAlive: M.placements('b').filter((p) => p.alive).length, bindings: M.bindingStr(M.bindings('a')), fence: M.fenceRow('a') === req.migrationOperationId, replayIdentical: r1b.stdout === r1.stdout };

say('== 2 W1a fence + W1b capture (operator bundle copy)');
L.sayMaint(`${TAG}-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC, String(m0.revision), req.fenceOperationId, '--offline-confirmed']));
W.prepareBundle(`${TAG}`, { sessions: W.members('a').map((m) => m.id) });
const cap = await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: m0.revision, bundle }), { label: `${TAG}-capture` });
R.capture = W.summary(cap);

say('== 3 external offline copy to the target filesystem (cp -a)');
L.sh(`cp -a ${SRC} ${DST}`);
say(`   source ${M.stat(SRC)} | target ${M.stat(DST)} | target marker == source marker: ${M.markerOf(DST) === srcMarker0}`);

say('== 4 prepare / prepare replay / promote / promote replay');
const p1 = await M.mig('prepare', file, { label: `${TAG}-prepare` });
const p2 = await M.mig('prepare', file, { label: `${TAG}-prepare-replay` });
say(`   prepare replay identical receipt=${p1.stdout === p2.stdout} (${p2.ms} ms vs ${p1.ms} ms)`);
const mPrep = L.mountRow('a');
const q1 = await M.mig('promote', file, { label: `${TAG}-promote` });
const q2 = await M.mig('promote', file, { label: `${TAG}-promote-replay` });
const ins = await M.mig('inspect', file, { label: `${TAG}-inspect` });
const m1 = L.mountRow('a');
say(`   before promote: ${L.mstr(mPrep)}`);
say(`   after promote : ${L.mstr(m1)} root=${m1.root}`);
say(`   promote replay identical receipt=${q1.stdout === q2.stdout}; revision after replay=${L.mountRow('a').revision}; fence row=${M.fenceRow('a') ?? 'cleared'}`);
const A1 = W.authoritySnapshot(`${TAG}-after-promote`);
const changed = W.diffSnapshots(A0, A1);
const src1 = W.treeDigest(SRC); const hist1 = W.treeDigest(W.historyRoot());
say(`   authority tables changed (${changed.length}/${Object.keys(A0.tables).length}): ${changed.join(' ')}`);
say(`   source tree unchanged=${src0 === src1} source marker unchanged=${M.markerOf(SRC) === srcMarker0} history tree unchanged=${hist0 === hist1}`);
say(`   source marker: ${M.markerBrief(SRC)}`);
say(`   target marker: ${M.markerBrief(DST)}`);
R.migration = { prepare: M.migSummary(p1), prepareReplayIdentical: p1.stdout === p2.stdout, promote: M.migSummary(q1), promoteReplayIdentical: q1.stdout === q2.stdout,
  revisionBefore: mPrep.revision, revisionAfter: m1.revision, rootAfter: m1.root, fenceCleared: M.fenceRow('a') === null, changedTables: changed,
  sourceUnchanged: src0 === src1, historyUnchanged: hist0 === hist1, sourceMarkerUnchanged: M.markerOf(SRC) === srcMarker0, inspect: ins.json };

say('== 5 deployment remap + restart (same QWEN_HOME), fresh file work and undo');
say('  ', L.svc(`ROOT_a=${DST}`, 'start').split('\n').at(-1));
const h2 = await new L.Harness({ name: `s1-${TAG}-after`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
rig.h = h2;
const after = {};
for (const n of ['B1', 'F1', 'U']) { S[n].bind(h2); const ld = await S[n].load(L.FILES); after[`${n}.load`] = ld.status; say(`   ${n} cold load=${ld.status}${ld.status !== 200 ? ` ${JSON.stringify(ld.json).slice(0, 200)}` : ''}`); }
const t1 = await run('B1', 'b2', 'WRITE b.txt b2'); after.B1 = P.term(t1);
const t2 = await run('F1', 'f5', 'WRITE notes.txt v3'); after.F1write = P.term(t2);
say(`     notes.txt target=${read(`${DST}/project`, 'notes.txt')} source=${read(`${SRC}/project`, 'notes.txt')}`);
const t3 = await run('F1', 'f6', 'WRITE fresh.txt after-migration');
say(`     fresh.txt target=${read(`${DST}/project`, 'fresh.txt')} source=${read(`${SRC}/project`, 'fresh.txt')}`);
after.undoNew = await rewind('F1', 'f6', h2); say(`     F1 undo f6 (new prompt): ${after.undoNew} -> fresh.txt target=${read(`${DST}/project`, 'fresh.txt')}`);
after.undoV3 = await rewind('F1', 'f5', h2); say(`     F1 undo f5 (new prompt): ${after.undoV3} -> notes.txt target=${read(`${DST}/project`, 'notes.txt')}`);
after.undoHist = await rewind('F1', 'f2', h2); say(`     F1 undo f2 (PRE-migration prompt, retained backup): ${after.undoHist} -> notes.txt target=${read(`${DST}/project`, 'notes.txt')} source=${read(`${SRC}/project`, 'notes.txt')}`);
after.undoU1 = await rewind('U', 'u1', h2); say(`     U undo u1 (PRE-migration prompt that created undo.txt): ${after.undoU1} -> undo.txt target=${read(`${DST}/project`, 'undo.txt')} source=${read(`${SRC}/project`, 'undo.txt')}`);
const t4 = await run('F1', 'f7', 'READ notes.txt'); after.read = P.term(t4);
for (const s of Object.values(S)) await s.detach().catch(() => {});
const nb = M.bindings('a');
after.newBindings = nb.filter((b) => b.cwd.startsWith(DST)).length; after.oldBindings = nb.filter((b) => b.cwd.startsWith(SRC)).length;
say(`   st-a bindings now: ${nb.map((b) => `${b.state}@${b.cwd}`).join(' | ')}`);
say(`   source tree still unchanged after post-migration work: ${W.treeDigest(SRC) === src0}`);
after.sourceUntouched = W.treeDigest(SRC) === src0;
after.files = { notes: read(`${DST}/project`, 'notes.txt'), fresh: read(`${DST}/project`, 'fresh.txt'), undo: read(`${DST}/project`, 'undo.txt'), deep: read(`${DST}/project`, 'deep/x.txt') };
R.after = after;

say('== 6 legacy Runtime status / cancel / release after migration (saved pre-migration ownership)');
// Pre-migration Runtime Sessions and executions: rows whose canonical cwd is under the OLD source root.
const oldRs = L.sql(`SELECT runtime_session_id, harness_session_id, binding_id, runtime_generation, session_state, canonical_cwd FROM qwen_runtime_session WHERE tenant_id='${L.TENANT}' AND (canonical_cwd='${SRC}' OR canonical_cwd LIKE '${SRC}/%') ORDER BY runtime_session_id`)
  .map((r) => ({ rs: r[0], hs: r[1], binding: r[2], gen: r[3], state: r[4], cwd: r[5] }));
const oldEx = L.sql(`SELECT e.execution_call_id, e.runtime_session_id, e.harness_session_id, e.execution_state FROM qwen_tool_execution e JOIN qwen_runtime_binding b ON b.binding_id=e.binding_id WHERE b.tenant_id='${L.TENANT}' AND (b.canonical_cwd='${SRC}' OR b.canonical_cwd LIKE '${SRC}/%') ORDER BY e.execution_call_id`)
  .map((r) => ({ call: r[0], rs: r[1], hs: r[2], state: r[3] }));
const rowsDigest = () => W.sha(JSON.stringify([
  L.sql(`SELECT runtime_session_id, session_state, record_version, binding_id, runtime_generation FROM qwen_runtime_session WHERE (canonical_cwd='${SRC}' OR canonical_cwd LIKE '${SRC}/%') ORDER BY runtime_session_id`),
  L.sql(`SELECT e.execution_call_id, e.execution_state FROM qwen_tool_execution e JOIN qwen_runtime_binding b ON b.binding_id=e.binding_id WHERE (b.canonical_cwd='${SRC}' OR b.canonical_cwd LIKE '${SRC}/%') ORDER BY e.execution_call_id`),
  L.sql(`SELECT binding_id, binding_state, runtime_generation FROM qwen_runtime_binding WHERE (canonical_cwd='${SRC}' OR canonical_cwd LIKE '${SRC}/%') ORDER BY binding_id`)])).slice(0, 16);
const workersAtSrc = () => M.workers().filter((w) => w.cwd.startsWith(SRC)).length;
say(`   pre-migration rows: ${oldRs.length} Runtime Sessions [${[...new Set(oldRs.map((r) => r.state))].join(',')}], ${oldEx.length} executions [${[...new Set(oldEx.map((e) => e.state))].join(',')}]`);
const BH = { Authorization: `Bearer ${L.BROKER_TOKEN}`, 'Content-Type': 'application/json' };
const broker = async (method, route, body) => {
  try {
    const r = await fetch(`${L.BROKER_ORIGIN}/internal/runtime-broker/v1${route}`, { method, headers: BH, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; }
    return { status: r.status, json: j };
  } catch (e) { return { status: 0, json: { error: String(e) } }; }
};
const brief = (r) => `${r.status}${r.json?.code ? ` ${r.json.code}` : ''}${r.json?.released !== undefined ? ` released=${r.json.released}` : ''}${r.json?.execution?.state ? ` state=${r.json.execution.state}` : r.json?.state ? ` state=${r.json.state}` : ''}`;
const d0 = rowsDigest(); const w0 = workersAtSrc(); const srcBefore = W.treeDigest(SRC);
const legacy = { release: [], status: [], cancel: [], controls: {} };
for (const r of oldRs) {
  const res = await broker('POST', `/tool-sessions/${encodeURIComponent(r.rs)}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: r.hs });
  legacy.release.push({ rs: r.rs.slice(0, 8), before: r.state, res: brief(res), body: res.json });
}
for (const e of oldEx) {
  const q = new URLSearchParams({ requestId: randomUUID(), harnessSessionId: e.hs, runtimeSessionId: e.rs });
  const st = await broker('GET', `/executions/${encodeURIComponent(e.call)}?${q}`);
  legacy.status.push({ call: e.call.slice(0, 12), before: e.state, res: brief(st), body: st.json });
  const cx = await broker('POST', `/executions/${encodeURIComponent(e.call)}:cancel`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: e.hs, runtimeSessionId: e.rs });
  legacy.cancel.push({ call: e.call.slice(0, 12), before: e.state, res: brief(cx), body: cx.json });
}
// Controls: the same calls with an unknown Runtime Session / a mismatched Harness Session must not resolve.
if (oldRs[0]) {
  legacy.controls.unknownRuntime = brief(await broker('POST', `/tool-sessions/${randomUUID()}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: oldRs[0].hs }));
  const other = oldRs.find((x) => x.hs !== oldRs[0].hs);
  if (other) legacy.controls.otherHarness = brief(await broker('POST', `/tool-sessions/${encodeURIComponent(oldRs[0].rs)}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: other.hs }));
}
if (oldEx[0]) {
  const q = new URLSearchParams({ requestId: randomUUID(), harnessSessionId: oldEx[0].hs, runtimeSessionId: randomUUID() });
  legacy.controls.execWrongRuntime = brief(await broker('GET', `/executions/${encodeURIComponent(oldEx[0].call)}?${q}`));
}
const tally = (xs) => Object.entries(xs.reduce((a, x) => { a[x.res] = (a[x.res] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none';
say(`   release (${legacy.release.length}): ${tally(legacy.release)}`);
say(`   execution status (${legacy.status.length}): ${tally(legacy.status)}`);
say(`   execution cancel (${legacy.cancel.length}): ${tally(legacy.cancel)}`);
say(`   controls: ${JSON.stringify(legacy.controls)}`);
legacy.rowsUnchanged = d0 === rowsDigest(); legacy.workersAtSrcBefore = w0; legacy.workersAtSrcAfter = workersAtSrc(); legacy.sourceUnchanged = srcBefore === W.treeDigest(SRC);
say(`   pre-migration Runtime/execution/binding rows unchanged=${legacy.rowsUnchanged}; workers at source before/after=${w0}/${legacy.workersAtSrcAfter}; source tree unchanged=${legacy.sourceUnchanged}`);
// The live, post-migration Session still works after the legacy calls.
S.F1.bind(h2); const rl = await S.F1.load(L.FILES); legacy.reload = rl.status;
const t5 = await run('F1', 'f8', 'WRITE after-legacy.txt ok'); legacy.liveTurnAfter = P.term(t5);
say(`     after-legacy.txt target=${read(`${DST}/project`, 'after-legacy.txt')} source=${read(`${SRC}/project`, 'after-legacy.txt')}`);
R.legacy = legacy;
await rig.stop();
L.svc('stop');
fs.writeFileSync(`${L.OUT}/s1-${TAG}.json`, JSON.stringify(R, null, 1));
say('S1-DONE');
