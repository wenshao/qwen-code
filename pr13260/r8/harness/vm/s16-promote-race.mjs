// PR #13260 S16 (round-2 review R2-4/R2-5 at 5120e58a, on the real stack): two `promote` processes for the same migration.
// Per trial storage (a, c, d): retire → W1a fence → capture → copy → prepare, then promote A; as soon as A's verification
// attempt is VERIFYING (its worker is running), promote B starts. Recorded: both outcomes, how many --workspace-recovery-worker
// processes ran at once, and what the final row / inspect() report as lastErrorCode.
// Sequential control on b: promote with QWEN_HOME unset (refused, error recorded), then canonical promote.
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's16';
L.openLog(`s16-${TAG}`);
const { say } = L;
const R = { tag: TAG, server: L.env().JAR, migJar: M.MIG_JAR, trials: [] };
const ST = ['a', 'b', 'c', 'd'];
const SRC = (s) => `/srv/w1c-src/${s}`; const DST = (s) => `/srv/w1c-dst/${s}`;
say(L.hostFacts()); say(`   server ${L.env().JAR} | migration jar ${M.MIG_JAR}`);
await P.rollout(ST);
for (const s of ST) L.seedWs(`ws-${s}1`, s);
const rig = await L.startRig(`s16-${TAG}`);
for (const s of ST) {
  const h = new L.HSession(rig.h, await L.createSession(`ws-${s}1`), `ws-${s}1`);
  say(`   st-${s} create=${(await h.create(L.FILES)).status} ${P.term(await h.prompt('WRITE notes.txt one'))} ${P.term(await h.prompt('WRITE notes.txt two'))}`);
  await h.detach();
}
await rig.h.stop(); for (const s of ST) await W.waitLeasesExpired(s);
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);  // N1
const row = (id) => { const r = L.sql(`SELECT state, IFNULL(last_error_code,'-'), IFNULL(verify_operation_id,'-') FROM managed_workspace_migration WHERE operation_id='${id}'`)[0]; return { state: r[0], error: r[1], attempt: r[2] }; };
const attemptState = (id) => L.one(`SELECT r.state FROM managed_workspace_recovery_operation r JOIN managed_workspace_migration m ON r.operation_id = m.verify_operation_id WHERE m.operation_id='${id}'`) ?? '-';
const workers = () => { let n = 0; for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0'); if (c.includes('--workspace-recovery-worker') && /node$/.test(c[0])) n++; } catch { /* gone */ } } return n; };
async function prepared(s) {
  const req = M.migrationRequest({ revision: L.mountRow(s).revision, storage: s, source: SRC(s), target: DST(s), bundle: `/srv/w1c-bundles/${TAG}-${s}` });
  const file = M.writeRequest(req, `${TAG}-${s}`);
  await M.mig('retire', file, { label: `${TAG}-${s}-retire`, quiet: true });
  L.maint(['fence', L.TENANT, `st-${s}`, SRC(s), String(req.mountRevision), req.fenceOperationId, '--offline-confirmed']);
  W.prepareBundle(`${TAG}-${s}`, { storage: s, sessions: W.members(s).map((m) => m.id) });
  await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: req.mountRevision, storage: s, bundle: req.bundleRoot }), { label: `${TAG}-${s}-capture`, quiet: true });
  L.sh(`cp -a ${SRC(s)} ${DST(s)}`);
  const p = await M.mig('prepare', file, { label: `${TAG}-${s}-prepare`, quiet: true });
  say(`   st-${s} prepared: ${M.migSummary(p).slice(0, 40)}`);
  return { req, file };
}
const lastErr = (r) => (r.json ? String(r.json.lastErrorCode) : `exit=${r.code} ${(r.workerLine || r.cause || '').slice(0, 60)}`);

say('== concurrent promote: B starts while A\'s verification worker runs');
for (const s of ['a', 'c', 'd']) {
  const { req, file } = await prepared(s);
  let peak = 0; const poll = setInterval(() => { try { peak = Math.max(peak, workers()); } catch { /* busy */ } }, 100);
  const t0 = Date.now();
  const pa = M.mig('promote', file, { label: `${TAG}-${s}-promote-A`, quiet: true });
  await M.until(() => attemptState(req.migrationOperationId) === 'VERIFYING', 'A verifying');
  const bStart = Date.now() - t0;
  const pb = M.mig('promote', file, { label: `${TAG}-${s}-promote-B`, quiet: true });
  const [a, b] = await Promise.all([pa, pb]); clearInterval(poll);
  const ins = await M.mig('inspect', file, { label: `${TAG}-${s}-inspect`, quiet: true });
  const fin = row(req.migrationOperationId);
  const t = { storage: `st-${s}`, bStartedAfterMs: bStart, A: { exit: a.code, ms: a.ms, out: a.code === 0 ? M.migSummary(a).slice(0, 60) : (a.workerLine || a.cause).slice(0, 90) },
    B: { exit: b.code, ms: b.ms, out: b.code === 0 ? M.migSummary(b).slice(0, 60) : (b.workerLine || b.cause).slice(0, 90) },
    peakConcurrentWorkers: peak, finalRow: fin, inspectLastErrorCode: ins.json?.lastErrorCode ?? null, inspectState: ins.json?.state, mount: L.mstr(L.mountRow(s)) };
  R.trials.push(t);
  say(`   st-${s}: B started ${bStart} ms after A | A exit=${t.A.exit} ${t.A.ms} ms ${t.A.out} | B exit=${t.B.exit} ${t.B.ms} ms ${t.B.out}`);
  say(`      peak concurrent verification workers=${peak} | final row state=${fin.state} last_error_code=${fin.error} | inspect: state=${t.inspectState} lastErrorCode=${t.inspectLastErrorCode} | ${t.mount}`);
}

say('== sequential control: promote refused (QWEN_HOME unset), then canonical promote');
{
  const { req, file } = await prepared('b');
  const r1 = await M.mig('promote', file, { label: `${TAG}-b-promote-unset`, home: null, quiet: true });
  const mid = row(req.migrationOperationId);
  const r2 = await M.mig('promote', file, { label: `${TAG}-b-promote-canonical`, quiet: true });
  const fin = row(req.migrationOperationId);
  R.sequential = { refused: (r1.workerLine || r1.cause).slice(0, 80), rowAfterRefusal: mid, promote: M.migSummary(r2).slice(0, 60), finalRow: fin };
  say(`   st-b refused: ${R.sequential.refused} → row state=${mid.state} last_error_code=${mid.error} | canonical: ${R.sequential.promote} → row state=${fin.state} last_error_code=${fin.error}`);
}
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s16-${TAG}.json`, JSON.stringify(R, null, 1));
say('S16-DONE');
