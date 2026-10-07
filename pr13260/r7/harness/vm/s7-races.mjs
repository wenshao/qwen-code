// PR #13260 S7: concurrent maintenance commands on a PREPARED migration (not covered by any earlier run):
//  st-a promote ‖ promote (free-running) · st-b promote queued before abort · st-c abort queued before promote (then
//  rollback + a new operation that meets the aborted operation's marker in the target) · st-d W1a restore-original
//  during promote. Queue order is forced with a held InnoDB row lock and LOCK WAIT counting.
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's7';
L.openLog(`s7-${TAG}`);
const { say } = L;
const R = { tag: TAG };
const ST = ['a', 'b', 'c', 'd'];
const SRC = (s) => `/srv/w1c-src/${s}`; const DST = (s) => `/srv/w1c-dst/${s}`;
const read = (root, f) => { try { return fs.readFileSync(`${root}/${f}`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
say(L.hostFacts());
await P.rollout(ST);
for (const s of ST) L.seedWs(`ws-${s}1`, s);
const rig = await L.startRig(`s7-${TAG}`);
const S = {};
for (const s of ST) {
  S[s] = new L.HSession(rig.h, await L.createSession(`ws-${s}1`), `ws-${s}1`);
  const c = await S[s].create(L.FILES);
  const t1 = await S[s].prompt('WRITE notes.txt one'); const t2 = await S[s].prompt('WRITE notes.txt two');
  say(`   st-${s} session ${S[s].sessionId.slice(0, 8)} create=${c.status} ${P.term(t1)} ${P.term(t2)}`);
  await S[s].detach();
}
await rig.h.stop(); L.svc('stop');
for (const s of ST) await W.waitLeasesExpired(s);
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);
const need = (r, what) => { if (r.code !== 0) throw new Error(`${what} failed: ${M.migSummary(r)}`); return r; };
const Q = {};
for (const s of ST) {
  const m0 = L.mountRow(s);
  const req = M.migrationRequest({ revision: m0.revision, storage: s, source: SRC(s), target: DST(s), bundle: `/srv/w1c-bundles/${TAG}-${s}` });
  const file = M.writeRequest(req, `${TAG}-${s}`);
  need(await M.mig('retire', file, { label: `${TAG}-${s}-retire`, quiet: true }), 'retire');
  L.maint(['fence', L.TENANT, `st-${s}`, SRC(s), String(m0.revision), req.fenceOperationId, '--offline-confirmed']);
  W.prepareBundle(`${TAG}-${s}`, { storage: s, sessions: W.members(s).map((m) => m.id) });
  need(await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: m0.revision, storage: s, bundle: req.bundleRoot }), { label: `${TAG}-${s}-capture`, quiet: true }), 'capture');
  L.sh(`cp -a ${SRC(s)} ${DST(s)}`);
  need(await M.mig('prepare', file, { label: `${TAG}-${s}-prepare`, quiet: true }), 'prepare');
  Q[s] = { req, file, sourceMarker: M.markerOf(SRC(s)) };
  say(`   st-${s}: ${M.migStr(M.migRow(req.migrationOperationId))} | ${L.mstr(L.mountRow(s))}`);
}
const tenantKey = L.one(`SELECT tenant_key FROM qwen_tool_publication_tenant WHERE tenant_id='${L.TENANT}'`);
const outcome = (s) => {
  const row = M.migRow(Q[s].req.migrationOperationId); const m = L.mountRow(s);
  const tm = M.markerOf(DST(s));
  return { row: `${row.state}/${row.error}`, mount: `${m.state} rev${m.revision} root=${m.root}`, fence: M.fenceRow(s) ? 'installed' : 'cleared',
    targetMarker: tm === Q[s].sourceMarker ? 'source marker' : `target marker reg=${JSON.parse(tm).registrationId.slice(0, 8)}`, tmp: fs.readdirSync(DST(s)).filter((f) => f.includes('.tmp')).length,
    consistent: (row.state === 'COMPLETED' && m.state === 'READY' && m.revision === Q[s].req.mountRevision + 1 && m.root === DST(s) && !M.fenceRow(s))
      || (row.state === 'ABORTED' && m.state === 'FENCED' && m.revision === Q[s].req.mountRevision && m.root === SRC(s) && !M.fenceRow(s)) };
};
const brief = (r) => `exit=${r.code} ${r.code === 0 ? M.migSummary(r).slice(0, 40) : (r.workerLine || r.cause).slice(0, 90)}`;
// wait until a promote has passed its first transaction and its worker is scanning
const scanning = (s, before) => () => { const v = M.migRow(Q[s].req.migrationOperationId).verify; return v !== before && L.one(`SELECT COUNT(*) FROM managed_workspace_recovery_operation WHERE operation_id='${v}'`) === '1'; };

say('== R1 st-a: two promotes started together');
{
  const [p1, p2] = await Promise.all([M.mig('promote', Q.a.file, { label: `${TAG}-a-promote1`, quiet: true }), M.mig('promote', Q.a.file, { label: `${TAG}-a-promote2`, quiet: true })]);
  R.R1 = { p1: brief(p1), p2: brief(p2), ...outcome('a') };
  say(`   promote#1 ${R.R1.p1} | promote#2 ${R.R1.p2}`);
  say(`   -> ${JSON.stringify(outcome('a'))}`);
  if (!['COMPLETED'].includes(M.migRow(Q.a.req.migrationOperationId).state)) { const p3 = await M.mig('promote', Q.a.file, { label: `${TAG}-a-promote3`, quiet: true }); R.R1.retry = brief(p3); R.R1.afterRetry = outcome('a'); say(`   retry: ${R.R1.retry} -> ${JSON.stringify(R.R1.afterRetry)}`); }
}

for (const [s, order] of [['b', 'promote-first'], ['c', 'abort-first']]) {
  say(`== R2 st-${s}: promote and abort queued on the tenant lock, ${order}`);
  const h = M.lockHolder();
  const before = M.migRow(Q[s].req.migrationOperationId).verify; const markerBefore = M.markerOf(DST(s));
  const pp = M.mig('promote', Q[s].file, { label: `${TAG}-${s}-promote`, quiet: true });
  await M.until(scanning(s, before), 'promote scanning');
  await h.lock(tenantKey);
  let ap;
  if (order === 'promote-first') {
    await M.until(() => M.markerOf(DST(s)) !== markerBefore && M.lockWaits() >= 1, 'promote blocked after marker publish');
    ap = M.mig('abort', Q[s].file, { label: `${TAG}-${s}-abort`, quiet: true });
    await M.until(() => M.lockWaits() >= 2, 'abort queued second');
  } else {
    ap = M.mig('abort', Q[s].file, { label: `${TAG}-${s}-abort`, quiet: true });
    await M.until(() => M.lockWaits() >= 1, 'abort queued first');
    await M.until(() => M.markerOf(DST(s)) !== markerBefore && M.lockWaits() >= 2, 'promote queued second after marker publish');
  }
  say(`   queue formed (LOCK WAIT=${M.lockWaits()}, target marker already replaced=${M.markerOf(DST(s)) !== markerBefore}); releasing`);
  h.release();
  const [pr, ar] = await Promise.all([pp, ap]); h.close();
  R[`R2${s}`] = { order, promote: brief(pr), abort: brief(ar), ...outcome(s) };
  say(`   promote ${brief(pr)} | abort ${brief(ar)}`);
  say(`   -> ${JSON.stringify(outcome(s))}`);
}

say('== R3 st-d: W1a restore-original while promote is scanning');
{
  const before = M.migRow(Q.d.req.migrationOperationId).verify;
  const pp = M.mig('promote', Q.d.file, { label: `${TAG}-d-promote`, quiet: true });
  await M.until(scanning('d', before), 'promote scanning');
  const ro = L.maint(['restore-original', L.TENANT, 'st-d', SRC('d'), String(Q.d.req.mountRevision), Q.d.req.fenceOperationId, '--offline-confirmed']);
  const pr = await pp;
  const ro2 = L.maint(['restore-original', L.TENANT, 'st-d', SRC('d'), String(Q.d.req.mountRevision), Q.d.req.fenceOperationId, '--offline-confirmed']);
  R.R3 = { restoreDuringScan: ro.code === 0 ? ro.out : `refused: ${ro.cause}`, promote: brief(pr), restoreAfter: ro2.code === 0 ? ro2.out : `refused: ${ro2.cause}`, ...outcome('d') };
  say(`   restore-original during scan: ${R.R3.restoreDuringScan} | promote ${R.R3.promote} | restore-original after: ${R.R3.restoreAfter}`);
  say(`   -> ${JSON.stringify(outcome('d'))}`);
}

say('== R4 st-c after the aborted race: rollback, then a NEW operation meets the aborted operation\'s marker in the target');
{
  const c = M.migRow(Q.c.req.migrationOperationId).state;
  R.R4 = { abortedState: c };
  if (c === 'ABORTED') {
    const ro = L.maint(['restore-original', L.TENANT, 'st-c', SRC('c'), String(Q.c.req.mountRevision), Q.c.req.fenceOperationId, '--offline-confirmed']);
    R.R4.restore = ro.code === 0 ? 'ok' : ro.cause; R.R4.mountAfterRestore = L.mstr(L.mountRow('c'));
    say(`   W1a restore-original: ${R.R4.restore} | ${R.R4.mountAfterRestore}`);
    say('  ', L.svc(...ST.map((x) => `ROOT_${x}=${L.mountRow(x).root}`), 'start').split('\n').at(-1).slice(0, 160));
    const h = await new L.Harness({ name: `s7-${TAG}-c`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
    S.c.bind(h); const ld = await S.c.load(L.FILES); const t = await S.c.prompt('WRITE after-abort.txt yes');
    R.R4.turnAtSource = `${ld.status} ${P.term(t)} file(source)=${read(`${SRC('c')}/project`, 'after-abort.txt')}`;
    say(`   st-c Turn after rollback: ${R.R4.turnAtSource}`);
    await S.c.detach().catch(() => {}); await h.stop(); L.svc('stop'); await W.waitLeasesExpired('c');
    const m1 = L.mountRow('c');
    const req2 = M.migrationRequest({ revision: m1.revision, storage: 'c', source: SRC('c'), target: DST('c'), bundle: `/srv/w1c-bundles/${TAG}-c2` });
    const f2 = M.writeRequest(req2, `${TAG}-c2`);
    need(await M.mig('retire', f2, { label: `${TAG}-c2-retire`, quiet: true }), 'retire2');
    L.maint(['fence', L.TENANT, 'st-c', SRC('c'), String(m1.revision), req2.fenceOperationId, '--offline-confirmed']);
    W.prepareBundle(`${TAG}-c2`, { storage: 'c', sessions: W.members('c').map((m) => m.id) });
    need(await W.w1b('capture', W.captureRequest({ op: req2.captureOperationId, fence: req2.fenceOperationId, revision: m1.revision, storage: 'c', bundle: req2.bundleRoot }), { label: `${TAG}-c2-capture`, quiet: true }), 'capture2');
    L.sh(`rsync -a --delete --exclude .qwen-managed-storage.json ${SRC('c')}/ ${DST('c')}/`);  // refresh content, keep the aborted op's marker
    const p1 = await M.mig('prepare', f2, { label: `${TAG}-c2-prepare-foreign-marker`, quiet: true });
    R.R4.prepareWithForeignMarker = brief(p1);
    say(`   new op prepare with the aborted operation's marker still in the target: ${R.R4.prepareWithForeignMarker}`);
    L.sh(`cp -a ${SRC('c')}/.qwen-managed-storage.json ${DST('c')}/.qwen-managed-storage.json`);  // operator rebuild of the marker from the source
    const p2 = await M.mig('prepare', f2, { label: `${TAG}-c2-prepare-rebuilt`, quiet: true });
    const p3 = await M.mig('promote', f2, { label: `${TAG}-c2-promote`, quiet: true });
    R.R4.afterRebuild = `prepare ${brief(p2)} | promote ${brief(p3)} | ${L.mstr(L.mountRow('c'))}`;
    say(`   after rebuilding the target marker: ${R.R4.afterRebuild}`);
  }
}
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s7-${TAG}.json`, JSON.stringify(R, null, 1));
say('S7-DONE');
