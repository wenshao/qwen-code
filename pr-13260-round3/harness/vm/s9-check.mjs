// PR #13260 S9 (round 3, new) — crash-state phase of the block-level power-loss simulation.
// For each prefix of the dm-log-writes log between the `prepared` and `end` marks, rebuild the target device as it would
// be after a power cut at that point (replay onto a zero image), mount it through a dm-linear device with the SAME
// major:minor as the logged device (so st_dev, the recorded identity, is unchanged), and inspect the marker/temporary.
// At every FLUSH/FUA point additionally restore the SQL + bundle snapshot that matches that point in time and run the
// operator's plain retry (`promote` with the shipped jar), then check the recovery invariants and fsck.
// The "commit" check: at the last FLUSH/FUA before the `promote-returned` mark, with the POST snapshot (SQL already
// COMPLETED), the target marker must already be the migration marker; otherwise a power cut right after the SQL commit
// leaves the storage pointing at a target whose marker never became durable.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const ARM = process.env.ARM ?? 'head';
const E2E = (process.env.E2E ?? '').split(',').filter(Boolean); // which crash-state labels get a full Spring/Harness pass
L.openLog(`s9-check-${ARM}`);
const { say } = L;
const meta = JSON.parse(fs.readFileSync(`/var/lib/pr13260-img/pl-${ARM}-snap/meta.json`, 'utf8'));
const { img: IMG, snap: SNAP, mnt: MNT, dst: DST, dev: DEV } = meta;
const PL = '/root/verify/pr13260/rig/pl';
const IDX = `${SNAP}/index.json`;
L.sh(`python3 ${PL}/replay.py index ${IMG}-log.img ${IDX}`);
const idx = JSON.parse(fs.readFileSync(IDX, 'utf8')).entries;
const at = (m) => idx.find((e) => e.mark === m)?.i;
const P0 = at('prepared'); const PT = at('promote-tmp-created'); const P1 = at('promote-returned'); const PE = at('end');
const isFlush = (e) => (e.flags & 3) !== 0;
say(`   log entries=${idx.length} marks: prepared@${P0} promote-tmp-created@${PT} promote-returned@${P1} end@${PE}; flush/fua in (prepared,end]: ${idx.filter((e) => e.i > P0 && e.i <= PE && isFlush(e)).length}`);

// Self-check of the replayer: all entries reproduce the recorded device byte for byte.
L.sh(`rm -f ${SNAP}/full.img && truncate -s 512M ${SNAP}/full.img && python3 ${PL}/replay.py apply ${IMG}-log.img ${IDX} ${SNAP}/full.img 0 ${idx.length - 1}`);
const selfCheck = L.sh(`sha256sum ${IMG}-data.img ${SNAP}/full.img | cut -c1-64 | uniq | wc -l`) === '1';
say(`   replayer self-check (all entries == recorded device): ${selfCheck}`); L.sh(`rm -f ${SNAP}/full.img`);
const lastFlushBefore = (m) => [...idx].reverse().find((e) => e.i < m && isFlush(e))?.i;
const kCommit = lastFlushBefore(P1);
const B = Math.min(P0, kCommit);
say(`   last FLUSH/FUA before promote-returned: entry ${kCommit}; data-carrying entries between it and promote-returned: ${idx.filter((e) => e.i > kCommit && e.i < P1 && e.data !== null).length}`);
L.sh(`rm -f ${SNAP}/base.img && truncate -s 512M ${SNAP}/base.img && python3 ${PL}/replay.py apply ${IMG}-log.img ${IDX} ${SNAP}/base.img 0 ${B}`);

const expectedReg = meta.targetRegistration; const sourceReg = JSON.parse(meta.sourceMarker).registrationId;
const markerFile = path.join(DST, '.qwen-managed-storage.json');
const expectedMarker = meta.targetMarkerAfter; // bytes the operation publishes
function classifyMarker() {
  let raw; try { raw = fs.readFileSync(markerFile, 'utf8'); } catch (e) { return `missing(${e.code})`; }
  try { const m = JSON.parse(raw); return m.registrationId === expectedReg ? (raw === expectedMarker ? 'NEW' : 'NEW?bytes') : m.registrationId === sourceReg ? 'OLD' : `other(${m.registrationId})`; }
  catch { return `TORN(${raw.length}b)`; }
}
function classifyTmp() {
  let names; try { names = fs.readdirSync(DST).filter((n) => n.endsWith('.tmp')); } catch { return 'no-root'; }
  if (!names.length) return 'none';
  return names.map((n) => { const b = fs.readFileSync(path.join(DST, n)); return b.length === 0 ? 'empty' : b.toString() === expectedMarker ? 'complete' : expectedMarker.startsWith(b.toString()) ? `prefix(${b.length})` : `foreign(${b.length})`; }).join('+');
}
let loopDev = null;
function mountState(k) {
  L.sh(`cp --sparse=always ${SNAP}/base.img ${SNAP}/state.img`);
  if (k > B) L.sh(`python3 ${PL}/replay.py apply ${IMG}-log.img ${IDX} ${SNAP}/state.img ${B + 1} ${k}`);
  loopDev = L.sh(`losetup -f --show ${SNAP}/state.img`);
  L.sh(`dmsetup create ${DEV} -j 253 -m 214 --table "0 $(blockdev --getsz ${loopDev}) linear ${loopDev} 0"`);
  L.sh(`mkdir -p ${MNT} && mount -o noatime /dev/mapper/${DEV} ${MNT}`); // mount = ext4 journal recovery, as after the reboot
}
function unmountState() {
  L.sh(`umount ${MNT}`);
  const fsck = (() => { try { L.sh(`e2fsck -fn /dev/mapper/${DEV} >/dev/null 2>&1`); return 'clean'; } catch { return 'ERRORS'; } })();
  L.sh(`dmsetup remove ${DEV} && losetup -d ${loopDev}`); loopDev = null;
  return fsck;
}
// The retained history volume is not on the power-cut device; keep its contents (not its root inode) at the recorded
// state so a full-stack pass in one case cannot leak new backups into the next case's verification.
L.sh(`rm -rf ${SNAP}/history && cp -a ${W.historyRoot()} ${SNAP}/history`);
function restore(label) {
  L.sh(`rsync -a --delete ${SNAP}/history/ ${W.historyRoot()}/`);
  const db = L.DB();
  L.sh(`docker exec pr13260-mysql mysql -uroot -prootpw -e "DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}" 2>/dev/null`);
  L.sh(`docker exec -i pr13260-mysql mysql -uroot -prootpw ${db} < ${SNAP}/db-${label}.sql 2>/dev/null`);
  L.sh(`rm -rf ${meta.bundle} && cp -a ${SNAP}/bundle-${label} ${meta.bundle}`);
}
const killWorkers = () => { for (const w of M.workers()) { try { process.kill(w.pid, 'SIGKILL'); } catch { /* gone */ } } };

const R = { arm: ARM, selfCheck, marks: { prepared: P0, tmp: PT, returned: P1, end: PE }, prefixes: [], retries: [] };
say('== every prefix in [prepared, end]: marker / temporary as seen after the power cut + journal recovery');
for (let k = B; k <= PE; k++) {
  const e = idx[k]; if (e.mark && k !== P0) continue;
  mountState(k); const mk = classifyMarker(); const tmp = classifyTmp(); const fsck = unmountState();
  R.prefixes.push({ k, flush: isFlush(e), mark: e.mark ?? null, marker: mk, tmp, fsck });
}
const tally = (xs, f) => Object.entries(xs.reduce((a, x) => { const key = f(x); a[key] = (a[key] ?? 0) + 1; return a; }, {})).map(([a, b]) => `${a}×${b}`).join(' ');
say(`   prefixes=${R.prefixes.length}: marker {${tally(R.prefixes, (x) => x.marker)}} tmp {${tally(R.prefixes, (x) => x.tmp)}} fsck {${tally(R.prefixes, (x) => x.fsck)}}`);
const atCommit = R.prefixes.find((x) => x.k === kCommit);
say(`   COMMIT POINT: last FLUSH/FUA before promote-returned is entry ${kCommit}: marker=${atCommit?.marker} tmp=${atCommit?.tmp}`);
R.commitPoint = { k: kCommit, marker: atCommit?.marker, tmp: atCommit?.tmp };

say('== every FLUSH/FUA point: restore the matching SQL + bundle snapshot, run the operator retry (shipped jar)');
const points = [...new Set([P0, kCommit, ...R.prefixes.filter((x) => x.flush).map((x) => x.k)])].sort((a, b) => a - b);
const cases = [];
for (const k of points) {
  if (k < PT && k >= P0) cases.push({ k, db: 'prepared' });
  if (k < P1) cases.push({ k, db: 'mid' });
  if (k === kCommit || k >= P1) cases.push({ k, db: 'post' });
}
const SESSION = meta.session;
const usedAlias = new Set();
for (const c of cases) {
  restore(c.db); killWorkers();
  mountState(c.k);
  const before = { marker: classifyMarker(), tmp: classifyTmp() };
  const label = `s9-${ARM}-k${c.k}-${c.db}`;
  const r = await M.mig('promote', meta.file, { label, quiet: true });
  const row = M.migRow(meta.request.migrationOperationId); const m = L.mountRow('a');
  const after = { marker: classifyMarker(), tmp: classifyTmp() };
  const v = [];
  if (row.state !== 'COMPLETED') v.push(`state ${row.state}`);
  if (m.revision !== meta.m0.revision + 1 || m.root !== DST || m.state !== 'READY') v.push(`mount ${m.state} rev ${m.revision} @ ${m.root}`);
  if (after.marker !== 'NEW') v.push(`marker ${after.marker}`);
  if (after.tmp !== 'none') v.push(`tmp ${after.tmp}`);
  if (M.fenceRow('a')) v.push('fence installed');
  const rec = { ...c, before, retry: r.code === 0 ? `exit=0 ${r.json?.state} rev=${r.json?.result_json?.mountRevision}` : `exit=${r.code} ${(r.workerLine || r.cause).slice(0, 100)}`, after, violations: v };
  const tag = `${c.k}-${c.db}`;
  const alias = c.k === kCommit && c.db === 'post' ? 'commit'
    : c.db === 'mid' && before.marker === 'OLD' && before.tmp === 'complete' && !usedAlias.has('tmpcomplete') ? 'tmpcomplete'
    : c.db === 'mid' && before.marker === 'NEW' && !usedAlias.has('firstnew') ? 'firstnew' : null;
  if (alias) usedAlias.add(alias);
  rec.alias = alias;
  if (E2E.includes(tag) || (alias && E2E.includes(alias))) {
    // The deployment after the "reboot": Spring with the new mapping, a fresh Harness, cold load, a write and undo.
    L.svc(`ROOT_a=${DST}`, 'start');
    const rig = await L.startRig(`s9-${ARM}-${tag}`); const h = rig.h;
    const S = new L.HSession(h, SESSION, meta.workspace); const ld = await S.load(L.FILES);
    const t = ld.status === 200 ? await S.prompt('WRITE after-powerloss.txt ok') : null;
    const written = (() => { try { return fs.readFileSync(path.join(DST, 'project', 'after-powerloss.txt'), 'utf8').trim(); } catch (e) { return `<${e.code}>`; } })();
    const rw = ld.status === 200 ? await h.json(`/session/${SESSION}/files/rewind`, { promptId: meta['WRITE notes.txt v2'], requestId: randomUUID() }, { clientId: S.clientId }) : null;
    const read = (f) => { try { return fs.readFileSync(path.join(DST, 'project', f), 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
    rec.e2e = { load: ld.status, loadCode: ld.json?.code ?? ld.json?.error?.code, turn: t ? P.term(t) : '-', file: written, undoPreMigration: rw ? `${rw.status} filesChanged=${JSON.stringify(rw.json?.filesChanged)}` : '-', notesAfterUndo: read('notes.txt') };
    rec.e2e.w1aInspect = L.maint(['inspect', L.TENANT, 'st-a', DST], { extraEnv: { QWEN_HOME: M.homeOf() } }).out;
    await S.detach().catch(() => {}); await rig.stop(); L.svc('stop'); killWorkers();
  }
  rec.fsck = unmountState();
  R.retries.push(rec);
  say(`   k=${String(c.k).padStart(4)} db=${c.db.padEnd(8)} before: marker=${before.marker} tmp=${before.tmp} | retry ${rec.retry} | after: marker=${after.marker} tmp=${after.tmp} fsck=${rec.fsck} | ${v.length ? `VIOLATIONS: ${v.join('; ')}` : 'ok'}${rec.e2e ? ` | e2e load=${rec.e2e.load}${rec.e2e.loadCode ? `(${rec.e2e.loadCode})` : ''} turn=${rec.e2e.turn} file=${rec.e2e.file} undo=${rec.e2e.undoPreMigration} notes=${rec.e2e.notesAfterUndo} | W1a inspect: ${rec.e2e.w1aInspect}` : ''}`);
}
R.violations = R.retries.reduce((n, x) => n + x.violations.length, 0);
say(`   retries=${R.retries.length} violations=${R.violations} | commit point marker=${R.commitPoint.marker}`);
fs.writeFileSync(`${L.OUT}/s9-check-${ARM}.json`, JSON.stringify(R, null, 1));
say('S9-CHECK-DONE');
