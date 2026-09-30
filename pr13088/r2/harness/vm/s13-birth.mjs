// S13: the birth-time identity added at c21efbdf (SQL column mount_birth_time, marker v2).
//   (1) how a freshly prepared root looks to the guard (birth time vs mtime)
//   (2) registering such a root, and what the operator is told
//   (3) an unchanged registered root across ordinary mtime changes
//   (4) mtime made equal to the birth time after registration
//   (5) file systems with and without a birth time
//   (6) marker v2 and the SQL row: birth time precision, host id derivation
// Storages: a b c d = directories on the ext4 root disk; l n v t = s13-mounts.sh.
import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s13-birth');
const { say, sh } = L; const R = '/srv/w1a'; const MARK = '.qwen-managed-storage.json';
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
const times = (p) => { const [w, y] = sh(`stat -c '%w|%y' ${p}`).split('|'); return { birth: w, mtime: y, equal: w === y }; };
const show = (x, ref) => (x.slice(0, 10) === ref.slice(0, 10) ? x.slice(11, 29) : x.slice(0, 29));
const tstr = (p) => { const t = times(p); return `birth=${t.birth.slice(11, 29)} mtime=${show(t.mtime, t.birth)} ${t.equal ? '(EQUAL)' : '(differ)'}`; };
const reg = (st, op, label) => L.sayMaint(label, L.maint(['register', L.TENANT, `st-${st}`, `${R}/${st}`, op, '--offline-confirmed']));
const insp = (st) => L.inspect(st).out.replace(/operation=\S+ completed=\S+ /, '');
const term = (r) => r.terminal?.map((t) => t.type).join(',') || '<none>';
L.svc('stop');

say('== (1) a root prepared the usual way: `mkdir -p <root>/project`, 40 fresh roots');
let equal = 0; const N = 40;
for (let i = 0; i < N; i++) { const p = `${R}/probe-${i}`; sh(`rm -rf ${p}; mkdir -p ${p}/project`); if (times(p).equal) equal++; }
say(`   birth time == mtime (nanosecond strings from stat) in ${equal} of ${N}; first: ${tstr(`${R}/probe-0`)}`);
let eq2 = 0;
for (let i = 0; i < N; i++) { const p = `${R}/probe-${i}`; sh(`rm -rf ${p}; mkdir ${p}; sleep 0.02; mkdir ${p}/project`); if (times(p).equal) eq2++; }
say(`   with 20 ms between creating the root and its first child: ${eq2} of ${N}`);
sh(`rm -rf ${R}/probe-*`);
say(`   kernel timestamp granularity: CONFIG_HZ=${sh("grep -E '^CONFIG_HZ=' /boot/config-$(uname -r) | cut -d= -f2")}`);

say('== (2) registering a freshly prepared root (storage d)');
sh(`rm -rf ${R}/d; mkdir -p ${R}/d/project`); say(`   d: ${tstr(`${R}/d`)}`);
const opD = randomUUID();
const r1 = reg('d', opD, 's13-register-fresh');
say(`   stderr says: ${(r1.stderr.trim().split('\n').find((l) => /Exception|Error/.test(l)) ?? r1.stderr.trim().split('\n')[0] ?? '').slice(0, 220)}`);
say(`   SQL row after the refusal: ${L.mstr(L.mountRow('d'))}; marker ${fs.existsSync(`${R}/d/${MARK}`) ? 'present' : 'absent'}`);
say(`   inspect: ${insp('d')}`);
sh(`sleep 0.02; touch ${R}/d`); say(`   after \`touch <root>\` (the README advice): ${tstr(`${R}/d`)}`);
reg('d', opD, 's13-register-after-touch');
say(`   inspect: ${insp('d')}`);

say('== (3) a registered root across ordinary mtime changes (storage a)');
sh(`rm -rf ${R}/a; mkdir -p ${R}/a/project; sleep 0.02; touch ${R}/a`);
reg('a', randomUUID(), 's13-register-a');
L.seedWs('ws-a', 'a');
say('  ', L.svc('start').split(' ===')[0]);
const rig = await L.startRig('s13');
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const S = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a'); await S.create(L.FILES);
let r = await S.prompt('WRITE one.txt 1'); say(`   Turn 1: ${term(r)} | ${tstr(`${R}/a`)}`);
for (const [what, cmd] of [['create a file in the root', `echo x > ${R}/a/new-at-root.txt`], ['delete it', `rm ${R}/a/new-at-root.txt`], ['touch the root', `touch ${R}/a`],
  ['chmod the root (ctime only)', `chmod 755 ${R}/a`], ['mkdir + rmdir in the root', `mkdir ${R}/a/tmpdir && rmdir ${R}/a/tmpdir`], ['set mtime one year back', `touch -d '1 year ago' ${R}/a`]]) {
  sh(`sleep 0.01; ${cmd}`); mark = rig.proxy.ledger.length;
  r = await S.prompt('WRITE one.txt 1');
  say(`   ${what.padEnd(30)} -> ${tstr(`${R}/a`)} | inspect ${insp('a').replace(/state=ready revision=1 holder=\w+ /, '')} | next Turn ${term(r)}`);
}

say('== (4) mtime made equal to the birth time after registration (storage a)');
sh(`touch -d "$(stat -c %w ${R}/a)" ${R}/a`); say(`   \`touch -d "$(stat -c %w root)" root\`: ${tstr(`${R}/a`)}`);
say(`   inspect: ${insp('a')}`);
mark = rig.proxy.ledger.length; const m0 = rig.model.state.calls;
r = await S.prompt('WRITE two.txt 2'); say(`   next Turn: ${term(r)} | ${since()} | file written: ${fs.existsSync(`${R}/a/project/two.txt`)}`);
say('   the same from inside a Shell Turn is possible only when the root is reachable; recover by changing the mtime again:');
sh(`touch ${R}/a`); say(`   \`touch root\`: ${tstr(`${R}/a`)} | inspect: ${insp('a')}`);
r = await S.prompt('WRITE two.txt 2'); say(`   next Turn: ${term(r)} | ${since()} | file written: ${fs.existsSync(`${R}/a/project/two.txt`)}`);
await S.detach(); await rig.stop(); L.svc('stop');

say('== (5) file systems');
for (const st of ['a', 'l', 'n', 't', 'v']) {
  const p = `${R}/${st}`;
  const fsT = sh(`findmnt -n -T ${p} -o FSTYPE`);
  const statx = sh(`stat -c '%w' ${p}`);
  const java = sh(`cd /tmp && /opt/qwen/jdk/bin/java ${L.RIG}/vm/Btime.java ${p} | sed 's/^[^:]*: //'`);
  let res = '(registered in step 3)';
  if (st !== 'a') { const x = L.maint(['register', L.TENANT, `st-${st}`, p, randomUUID(), '--offline-confirmed']); res = x.code === 0 ? 'register OK' : `register REFUSED (${x.cause})`; }
  say(`   ${st}: ${fsT.padEnd(9)} statx birth=${statx === '-' ? '<none>' : statx.slice(0, 29)} | JDK ${java} | ${res} | inspect: ${insp(st)}`);
}

say('== (6) marker v2 and the SQL row (storage a)');
const marker = JSON.parse(fs.readFileSync(`${R}/a/${MARK}`, 'utf8'));
const machine = fs.readFileSync('/etc/machine-id', 'utf8').trim();
const hmac = createHmac('sha256', machine).update('Qwen-Code/verified-workspace/v2').digest('hex');
say(`   marker keys: ${Object.keys(marker).join(', ')}; version=${marker.version}`);
say(`   marker birthTime=${marker.birthTime}  statx birth=${sh(`stat -c %w ${R}/a`)}`);
const row = L.sql(`SELECT mount_birth_time, mount_host_id, mount_device, mount_inode FROM managed_workspace_execution_lease WHERE storage_key=${L.storageKey('a')}`)[0];
say(`   SQL mount_birth_time=${row[0]} (equal to the marker: ${row[0] === marker.birthTime})`);
say(`   hostId=${marker.hostId.slice(0, 16)}… (${marker.hostId.length} hex) == HMAC-SHA256(key=machine-id, "Qwen-Code/verified-workspace/v2"): ${marker.hostId === hmac}; raw machine-id present in marker: ${JSON.stringify(marker).includes(machine)}; in SQL row: ${row.join(' ').includes(machine)}`);
say('S13-DONE');
