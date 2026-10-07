// PR #13260 S13 (R1-1 at 5120e58a): the W2 cwd settlement probe after a COMPLETED migration, against REAL faults on the
// retained file-history volume. QWEN_HOME (/var/lib/qwen-w1c/home-<db>) is its own ext4 on a device-mapper target over a
// loop image, so the fault hits only the history root (the migrated Workspace root is on /srv/w1c-dst).
//  A control cwd change
//  B transient EIO: fresh remount (the history-root dentry is not cached), then the dm table is swapped to `error`: the probe's
//    statx of $QWEN_HOME/file-history fails with EIO from ext4. Healed after ~12 s by swapping back to `linear` (same dev/ino/birth).
//  C cwd change after the heal
//  D history volume unmounted for ~12 s (ENOENT), then mounted again
//  E history root replaced by a symlink to the same directory (structural), restored after the operation settles
//  F a Turn + undo through the cold-loaded Session (history volume writable after the faults)
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's13';
L.openLog(`s13-${TAG}`);
const { say } = L;
const R = { tag: TAG, server: L.env().JAR, dist: L.env().DIST, migJar: M.MIG_JAR, arms: {} };
const SRC = '/srv/w1c-src/a'; const DST = '/srv/w1c-dst/a';
const QH = M.homeOf(); const HIST = W.historyRoot(); const DM = 'w1c-qh'; const IMG = '/var/lib/w1c-img/qh.img';
const MO = '-o errors=continue,noatime';
const abort = (why) => { say(`ABORT: ${why}`); R.abort = why; fs.writeFileSync(`${L.OUT}/s13-${TAG}.json`, JSON.stringify(R, null, 1)); process.exit(3); };

// ---- the history volume
const [LOOP, SECT] = L.sh(`set -e
  if mountpoint -q ${QH}; then sudo umount ${QH}; fi
  sudo dmsetup remove ${DM} 2>/dev/null || true
  for l in $(losetup -j ${IMG} -O NAME -n); do sudo losetup -d $l; done
  sudo rm -f ${IMG}; sudo truncate -s 1G ${IMG}
  LD=$(sudo losetup -f --show ${IMG}); S=$(sudo blockdev --getsz $LD)
  sudo dmsetup create ${DM} --table "0 $S linear $LD 0"
  sudo mkfs.ext4 -q -F -b 4096 -I 256 -E lazy_itable_init=0,lazy_journal_init=0 /dev/mapper/${DM}
  sudo mkdir -p ${QH}; sudo mount ${MO} /dev/mapper/${DM} ${QH}
  sudo rmdir ${QH}/lost+found; sudo chown wenshao:wenshao ${QH}
  echo "$LD $S"`).split(' ');
const LINEAR = `0 ${SECT} linear ${LOOP} 0`; const ERROR = `0 ${SECT} error`;
const table = (t) => L.sh(`sudo dmsetup suspend --nolockfs --noflush ${DM} && sudo dmsetup load ${DM} --table "${t}" && sudo dmsetup resume ${DM} && sudo dmsetup table ${DM} | cut -d' ' -f3`);
const holders = () => L.sh(`sudo fuser -m ${QH} 2>&1 | sed 's#^[^:]*:##' | xargs`);
const statHist = () => L.sh(`stat -c 'ino=%i dev=%d birth=%W mtime=%Y' ${HIST} 2>&1 || true`);
const kernel = (since) => L.sh(`sudo dmesg --since '${since}' 2>/dev/null | grep -E 'EXT4-fs (error|warning).*dm-|Buffer I/O error on dev dm-' | tail -3 || true`);
say(L.hostFacts());
say(`   server ${L.env().JAR} dist ${L.env().DIST} | migration jar ${M.MIG_JAR}`);
say(`   QWEN_HOME ${QH} on /dev/mapper/${DM} (${L.sh(`findmnt -no FSTYPE,OPTIONS ${QH}`)}) over ${LOOP}; Workspace target ${DST} on ${M.fsOf('/srv/w1c-dst')}`);
R.volume = { qwenHome: QH, device: `/dev/mapper/${DM}`, loop: LOOP, sectors: Number(SECT), mount: L.sh(`findmnt -no SOURCE,FSTYPE,OPTIONS ${QH}`) };

// ---- one storage, one Files Session with history, migrated to another filesystem
await P.rollout(['a']);
L.seedWs('ws-a1', 'a'); for (const d of ['sub', 'sub2', 'sub3']) fs.mkdirSync(`${SRC}/project/${d}`, { recursive: true });
const rig = await L.startRig(`s13-${TAG}`);
const S = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1');
say(`   st-a ${S.sessionId.slice(0, 8)} create=${(await S.create(L.FILES)).status} ${P.term(await S.prompt('WRITE notes.txt one'))} ${P.term(await S.prompt('WRITE notes.txt two'))}`);
await S.detach(); await rig.h.stop(); await W.waitLeasesExpired('a');
if (!fs.existsSync(`${HIST}/${S.sessionId}`)) abort(`no retained history at ${HIST}/${S.sessionId}`);
L.sh(`touch -d '+1 second' ${HIST}`);  // N1
say(`   history root before migration: ${statHist()} | ${L.sh(`ls ${HIST}/${S.sessionId} | wc -l`)} backup files`);
const req = M.migrationRequest({ revision: L.mountRow('a').revision, storage: 'a', source: SRC, target: DST, bundle: `/srv/w1c-bundles/${TAG}-a` });
const file = M.writeRequest(req, `${TAG}-a`);
const rt = await M.mig('retire', file, { label: `${TAG}-retire` }); if (rt.code !== 0) abort('retire failed');
L.sayMaint(`${TAG}-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC, String(req.mountRevision), req.fenceOperationId, '--offline-confirmed']));
W.prepareBundle(`${TAG}-a`, { storage: 'a', sessions: W.members('a').map((m) => m.id) });
await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: req.mountRevision, bundle: req.bundleRoot }), { label: `${TAG}-capture` });
L.sh(`cp -a ${SRC} ${DST}`);
const pp = await M.mig('prepare', file, { label: `${TAG}-prepare` }); const pq = await M.mig('promote', file, { label: `${TAG}-promote` });
if (pq.json?.state !== 'COMPLETED') abort(`promote did not complete: ${M.migSummary(pq)}`);
R.migration = { prepare: M.migSummary(pp), promote: M.migSummary(pq), history: L.one(`SELECT history_identity_json FROM managed_workspace_migration WHERE operation_id='${req.migrationOperationId}'`) };
say(`   recorded history identity: ${R.migration.history}`);
say('  ', L.svc(`ROOT_a=${DST}`, 'QHOME=default', 'restart').split('\n').at(-1).slice(0, 200));
for (let i = 0; i < 300; i++) { const hr = await fetch('http://127.0.0.1:8288/actuator/health').catch(() => null); if (hr?.ok) break; await L.sleep(1000); }

// ---- cwd change with an operation timeline from the database
const ctx = () => { const r = L.sql(`SELECT IFNULL(cwd_relative,'-'), IFNULL(context_revision,'-') FROM managed_agent_session WHERE session_id='${S.sessionId}'`)[0]; return { cwd: r[0], rev: Number(r[1]) }; };
const opRow = (op) => { const r = L.sql(`SELECT state, delivery_state, attempt_count, IFNULL(error_code,'-') FROM managed_agent_operation WHERE operation_id='${op}'`)[0]; return r ? { state: r[0], delivery: r[1], attempts: Number(r[2]), error: r[3] } : null; };
const done = (o) => o && ['COMPLETED', 'FAILED'].includes(String(o.state).toUpperCase());
const logLines = (op) => L.sh(`grep -a '${op}' /var/log/qwen-w1c/server.log | grep -aE 'cwd change (probe deferred|refused|failed after)' || true`).split('\n').filter(Boolean);
async function cwdArm(name, target, { fault, heal, faultMs = 12000, healCapMs = 45000, maxMs = 240000 } = {}) {
  const before = ctx(); const since = L.sh('date "+%Y-%m-%d %H:%M:%S"');
  if (fault) { const f = await fault(); say(`   [${name}] fault: ${f}`); }
  const t0 = Date.now();
  const r = await L.api('POST', `/v1/agents/sessions/${S.sessionId}/cwd`, { cwd_relative: target, expected_context_revision: before.rev }, { key: randomUUID() });
  const op = r.json?.id ?? r.json?.operation_id;
  const timeline = []; let last = ''; let healedAt = null; let o = null;
  while (op && Date.now() - t0 < maxMs) {
    o = opRow(op); const k = o ? `${o.state}/${o.delivery}/attempts=${o.attempts}/${o.error}` : 'none';
    if (k !== last) { timeline.push(`${Date.now() - t0}ms ${k}`); last = k; }
    const el = Date.now() - t0;
    if (heal && healedAt === null && (done(o) || (el >= faultMs && (o?.attempts ?? 0) >= 2) || el >= healCapMs)) { const h = await heal(); healedAt = Date.now() - t0; timeline.push(`${healedAt}ms HEALED (${h})`); }
    if (done(o) && (!heal || healedAt !== null)) break;
    await L.sleep(250);
  }
  if (heal && healedAt === null) { await heal(); healedAt = Date.now() - t0; }
  const after = ctx(); const lines = op ? logLines(op) : [];
  const out = { name, target, admit: `${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''}`, operation: o, settledMs: done(o) ? Number(timeline.filter((x) => /COMPLETED|FAILED/.test(x)).at(0)?.split('ms')[0]) : null,
    healedMs: healedAt, binding: `${before.cwd}@${before.rev} → ${after.cwd}@${after.rev}`, timeline,
    log: { deferred: lines.filter((l) => l.includes('probe deferred')).length, refused: lines.filter((l) => l.includes(' refused ')).length, budget: lines.filter((l) => l.includes('failed after')).length, first: (lines[0] ?? '').replace(/^.*?(Managed Session)/, '$1').slice(0, 260) },
    kernel: fault ? kernel(since) : '' };
  R.arms[name] = out;
  say(`   [${name}] cwd → ${target}: admit=${out.admit} final=${o ? `${o.state} attempts=${o.attempts} error=${o.error}` : '-'} settled@${out.settledMs ?? '-'}ms${heal ? ` healed@${healedAt}ms` : ''} binding ${out.binding}`);
  say(`      timeline: ${timeline.join(' | ')}`);
  say(`      server.log: deferred×${out.log.deferred} refused×${out.log.refused} budget×${out.log.budget} first: ${out.log.first}`);
  if (out.kernel) say(`      kernel: ${out.kernel.replace(/\n/g, ' | ')}`);
  return out;
}

say('== A control');
await cwdArm('A-control', 'project/sub');

say('== B transient EIO on the history volume');
await cwdArm('B-eio', 'project/sub2', {
  fault: async () => {
    const hs = holders(); if (hs) abort(`history volume busy (${hs}); a remount would keep the dentry cache`);
    L.sh(`sudo umount ${QH} && sudo mount ${MO} /dev/mapper/${DM} ${QH} && sync`);
    const t = table(ERROR); const st = statHist();
    if (!/Input\/output error/.test(st)) { table(LINEAR); abort(`fault not effective: ${st}`); }
    R.eioCheck = st; return `remounted, table=${t}, stat → ${st}`;
  },
  heal: async () => `table=${table(LINEAR)} stat → ${statHist()}`,
});

say('== C after the heal');
await cwdArm('C-after-heal', 'project/sub3');

say('== D history volume unmounted (ENOENT), mounted again after ~12 s');
await cwdArm('D-unmounted', 'project/sub', {
  fault: async () => { const hs = holders(); if (hs) abort(`history volume busy (${hs})`); L.sh(`sudo umount ${QH}`); return `unmounted; stat → ${statHist()}`; },
  heal: async () => { L.sh(`sudo mount ${MO} /dev/mapper/${DM} ${QH}`); return `mounted; stat → ${statHist()}`; },
});

say('== E history root replaced by a symlink to the same directory (structural)');
await cwdArm('E-symlink', 'project/sub', {
  fault: async () => { L.sh(`mv ${HIST} ${HIST}.real && ln -s file-history.real ${HIST}`); return `${L.sh(`ls -ld ${HIST} | awk '{print $1, $9, $10, $11}'`)}`; },
  heal: async () => { L.sh(`rm ${HIST} && mv ${HIST}.real ${HIST}`); return `restored; stat → ${statHist()}`; },
  faultMs: Infinity, healCapMs: Infinity, maxMs: 300000,
});
say(`   history root after all faults: ${statHist()} | mount ${L.sh(`findmnt -no OPTIONS ${QH}`)}`);

say('== F Turn + undo through the cold-loaded Session');
const h = await new L.Harness({ name: `s13-${TAG}-after`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
S.bind(h); const ld = await S.load(L.FILES); const n0 = fs.readdirSync(`${HIST}/${S.sessionId}`).length;
const t = await S.prompt('WRITE where.txt after-faults');
const cwdNow = ctx().cwd; const wrote = (() => { try { return fs.readFileSync(`${DST}/${cwdNow}/where.txt`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } })();
const rw = await h.json(`/session/${S.sessionId}/files/rewind`, { promptId: t.promptId, requestId: randomUUID() }, { clientId: S.clientId });
const gone = !fs.existsSync(`${DST}/${cwdNow}/where.txt`);
R.turn = { load: ld.status, turn: P.term(t), cwd: cwdNow, wrote, historyFiles: `${n0} → ${fs.readdirSync(`${HIST}/${S.sessionId}`).length}`, rewind: `${rw.status}${rw.json?.code ? ` ${rw.json.code}` : ''}`, removedByUndo: gone };
say(`   load=${ld.status} ${R.turn.turn} cwd=${cwdNow} where.txt=${wrote} history files ${R.turn.historyFiles} | undo ${R.turn.rewind} removed=${gone}`);
await S.detach().catch(() => {}); await h.stop(); await rig.stop(); L.svc('stop');
L.sh(`sudo umount ${QH} && sudo dmsetup remove ${DM} && sudo losetup -d ${LOOP} && echo cleaned`);
L.sh(`cp /var/log/qwen-w1c/server.log ${L.OUT}/server-s13-${TAG}.log`);
R.causes = Object.fromEntries(Object.entries(R.arms).map(([k, a]) => [k, L.sh(`grep -aE 'Caused by|FileSystemException|IOException' ${L.OUT}/server-s13-${TAG}.log | grep -aE 'Input/output|file-history|not canonical|birth' | sort | uniq -c | head -5 || true`)]).slice(0, 1));
fs.writeFileSync(`${L.OUT}/s13-${TAG}.json`, JSON.stringify(R, null, 1));
say(`   causes in server.log: ${JSON.stringify(R.causes)}`);
say('S13-DONE');
