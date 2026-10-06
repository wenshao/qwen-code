// PR #13260 S9 (round 3, new) — record phase of the block-level power-loss simulation.
// The migration TARGET filesystem sits on dm-log-writes, so every bio (with FLUSH/FUA flags) reaching the target device
// is logged in order. One storage is populated through the deployed stack, then retire -> W1a fence -> W1b capture ->
// cp -a to the logged filesystem -> prepare -> promote. Marks in the log: copied, prepared, promote-tmp-created (the
// promote JVM is paused for the snapshot), promote-returned (after the SQL commit), end. SQL and bundle snapshots taken
// at prepared / mid (tmp created; promote's first transaction and worker verification already committed) / post.
// ARM=head uses the shipped migration jar for promote; ARM=nofsync uses a negative-control jar whose
// publishMigrationMarker has its four FileChannel.force() calls removed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const ARM = process.env.ARM ?? 'head';
const PROMOTE_JAR = ARM === 'nofsync' ? '/opt/pr13260/nofsync-server-workspace-migration.jar' : M.MIG_JAR;
L.openLog(`s9-record-${ARM}`);
const { say } = L;
const SRC = '/srv/pr13260/src/a';
const IMG = `/var/lib/pr13260-img/pl-${ARM}`; const DEV = 'pr13260-pl'; const MNT = '/srv/pr13260/pl'; const DST = `${MNT}/a`;
const SNAP = `/var/lib/pr13260-img/pl-${ARM}-snap`;
const mark = (m) => L.sh(`dmsetup message ${DEV} 0 mark ${m}`);
const MENV = { extraEnv: { QWEN_HOME: M.homeOf() } };
const dump = (label) => { L.sh(`docker exec pr13260-mysql mysqldump -uroot -prootpw --single-transaction --hex-blob ${L.DB()} 2>/dev/null > ${SNAP}/db-${label}.sql`);
  L.sh(`rm -rf ${SNAP}/bundle-${label} && cp -a ${bundle} ${SNAP}/bundle-${label}`); };
const meta = { arm: ARM, promoteJar: PROMOTE_JAR, db: L.DB(), src: SRC, dst: DST, mnt: MNT, dev: DEV, img: IMG, snap: SNAP };
say(L.hostFacts()); say(`   arm=${ARM} promote jar=${PROMOTE_JAR}`);

await P.rollout(['a', 'b']);
L.seedWs('ws-a1', 'a'); L.seedWs('ws-b1', 'b');
const rig = await L.startRig(`s9-${ARM}`);
const S = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1'); await S.create(L.FILES);
for (const t of ['WRITE notes.txt v1', 'WRITE notes.txt v2', 'WRITE deep/x.txt d1']) { const r = await S.prompt(t); meta[t] = r.promptId; say(`   F ${t}: ${P.term(r)}`); }
meta.session = S.sessionId; meta.workspace = 'ws-a1';
await S.detach(); await rig.stop(); L.svc('stop'); await W.waitLeasesExpired('a');
L.sh(`runuser -u w1crig -- touch ${W.historyRoot()}`); // N1 remedy (single-Session history root)

say('== logged target device');
L.sh(`umount ${MNT} 2>/dev/null; dmsetup remove ${DEV} 2>/dev/null; true`);
L.sh(`rm -rf ${SNAP} ${IMG}-data.img ${IMG}-log.img && mkdir -p ${SNAP} && truncate -s 512M ${IMG}-data.img && truncate -s 1G ${IMG}-log.img`);
const LD = L.sh(`losetup -f --show ${IMG}-data.img`); const LLOG = L.sh(`losetup -f --show ${IMG}-log.img`);
L.sh(`dmsetup create ${DEV} -j 253 -m 214 --table "0 $(blockdev --getsz ${LD}) log-writes ${LD} ${LLOG}"`);
L.sh(`mkfs.ext4 -q -F /dev/mapper/${DEV}`); mark('mkfs');
L.sh(`mkdir -p ${MNT} && mount -o noatime,commit=60 /dev/mapper/${DEV} ${MNT} && chown w1crig:w1crig ${MNT}`);
say(`   ${L.sh(`stat -L -c '/dev/mapper/${DEV} %t:%T' /dev/mapper/${DEV}`)} data=${LD} log=${LLOG} mounted ${MNT} (${L.sh(`findmnt -no OPTIONS ${MNT}`)})`);

const m0 = L.mountRow('a');
const bundle = `/srv/pr13260/bundles/s9-${ARM}`; L.sh(`rm -rf ${bundle}`);
const req = M.migrationRequest({ revision: m0.revision, source: SRC, target: DST, bundle });
const file = M.writeRequest(req, `s9-${ARM}`);
Object.assign(meta, { request: req, file, m0, bundle });
say(`   ${M.migSummary(await M.mig('retire', file, { label: `s9-${ARM}-retire` }))}`);
L.sayMaint(`s9-${ARM}-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC, String(m0.revision), req.fenceOperationId, '--offline-confirmed'], MENV));
W.prepareBundle(`s9-${ARM}`, { sessions: W.members('a').map((m) => m.id) });
await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: m0.revision, bundle }), { label: `s9-${ARM}-capture` });
L.sh(`cp -a ${SRC} ${DST} && sync -f ${MNT}`); mark('copied');
const pr = await M.mig('prepare', file, { label: `s9-${ARM}-prepare` });
L.sh(`sync -f ${MNT}`); mark('prepared'); dump('prepared');
meta.sourceMarker = fs.readFileSync(path.join(SRC, '.qwen-managed-storage.json'), 'utf8');
meta.targetMarkerBefore = fs.readFileSync(path.join(DST, '.qwen-managed-storage.json'), 'utf8');

say('== promote (paused once when its marker temporary appears, for the mid snapshot)');
const cfg = L.env();
const env = { PATH: '/usr/local/bin:/usr/bin:/bin', W1_JDBC_URL: `jdbc:mysql://127.0.0.1:${cfg.DBPORT}/${L.DB()}?allowPublicKeyRetrieval=true&useSSL=false`,
  W1_JDBC_USER: 'root', W1_JDBC_PASSWORD: cfg.DBPASS, ...M.CRED, QWEN_HOME: M.homeOf() };
const args = ['-Duser.timezone=UTC', '-jar', PROMOTE_JAR, 'promote', file, '--offline-confirmed'];
const t0 = Date.now();
const child = spawn('/opt/pr13260/jdk/bin/java', args, { ...L.RUNAS, env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = ''; let stderr = ''; child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
let pausedAt = null;
const watcher = fs.watch(DST, (ev, name) => {
  if (pausedAt === null && String(name).endsWith('.tmp')) {
    process.kill(child.pid, 'SIGSTOP'); pausedAt = Date.now() - t0; watcher.close();
    mark('promote-tmp-created'); dump('mid');
    meta.midRow = M.migRow(req.migrationOperationId); meta.midFence = M.fenceRow('a');
    process.kill(child.pid, 'SIGCONT');
  }
});
const code = await new Promise((r) => child.on('close', r));
mark('promote-returned');
dump('post');
await L.sleep(1500); mark('end');
const lines = stdout.split('\n').filter(Boolean); let json = null; try { json = JSON.parse(lines.at(-1)); } catch { /* refusal */ }
fs.writeFileSync(path.join(L.OUT, `mig-s9-${ARM}-promote.txt`), `$ java ${args.join(' ')}\nexit=${code}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`);
meta.promote = { exit: code, pausedAtMs: pausedAt, ms: Date.now() - t0, state: json?.state, revision: json?.result_json?.mountRevision };
meta.mountAfter = L.mountRow('a'); meta.targetRegistration = L.one(`SELECT target_registration_id FROM managed_workspace_migration WHERE operation_id='${req.migrationOperationId}'`);
meta.targetMarkerAfter = fs.readFileSync(path.join(DST, '.qwen-managed-storage.json'), 'utf8');
meta.prepare = M.migSummary(pr);
say(`   prepare: ${meta.prepare}`);
say(`   promote: exit=${code} ${json?.state} rev=${meta.promote.revision} paused at ${pausedAt} ms (mid row ${meta.midRow?.state}, fence ${meta.midFence ? 'installed' : 'cleared'}) | ${L.mstr(meta.mountAfter)}`);
L.sh(`umount ${MNT} && dmsetup remove ${DEV} && losetup -d ${LD} ${LLOG}`);
fs.writeFileSync(`${SNAP}/meta.json`, JSON.stringify(meta, null, 1));
fs.writeFileSync(`${L.OUT}/s9-record-${ARM}.json`, JSON.stringify(meta, null, 1));
say('S9-RECORD-DONE');
