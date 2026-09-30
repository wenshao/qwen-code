// S12: enforcement points that the unit suite and the two W1a integration gates do not pin (mutation survivors),
// exercised on the real stack at the PR head with the option on.
//   (a) execute: the mount becomes invalid AFTER the claim, between two tool calls of one batch
//   (b) root path: the whole storage is moved to another pathname and the mapping is updated (same device, same inode)
//   (c) host id: the same storage, database and marker seen with another machine-id
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
const TAG = process.env.TAG ?? 'head';
L.openLog(`s12-enforcement-points-${TAG}`);
const { say } = L; const R = '/srv/w1a'; const sh = L.sh; const MARK = '.qwen-managed-storage.json';
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
for (const s of 'ab') L.seedWs(`ws-${s}`, s);
L.svc('stop');
for (const s of 'ab') L.sayMaint(`s12-register-${s}`, L.maint(['register', L.TENANT, `st-${s}`, `${R}/${s}`, randomUUID(), '--offline-confirmed']));
say('  ', L.svc('start').split(' ===')[0]);
const rig = await L.startRig(`s12-${TAG}`);
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const results = (r) => L.toolTrace(r.events).filter((t) => t.startsWith('result')).map((t) => t.replace(/\\n/g, ' ⏎ ').slice(0, 260));
const term = (r) => r.terminal?.map((t) => t.type).join(',') || '<none>';

say('== (a) two Shell calls in one batch: the first moves the marker away, the second writes a file');
const S = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a'); await S.create(L.SHELL);
let r = await S.prompt(L.multi64(`mv ../${MARK} ../marker.keep && echo first-done`, 'echo second > second.txt && echo second-done'));
say(`   Turn: ${term(r)}; broker: ${since()}`);
for (const t of results(r)) say('     ', t);
say(`   second.txt: ${fs.existsSync(`${R}/a/project/second.txt`) ? 'WRITTEN' : 'not written'}; marker: ${fs.existsSync(`${R}/a/${MARK}`) ? 'present' : 'absent'}; row a: ${L.mstr(L.mountRow('a'))}; S status: ${JSON.stringify(await S.status())}`);
sh(`mv ${R}/a/marker.keep ${R}/a/${MARK}`);
r = await S.prompt(L.shell64('echo after-repair')); say(`   marker put back; next Shell Turn: ${term(r)}; broker: ${since()}`);
await S.detach();

if (process.env.ONLY === 'a') { await rig.stop(); say('S12-DONE'); process.exit(0); }
say('== (b) whole storage root renamed and the deployment mapping updated (no W1c relocation exists yet)');
const F = new L.HSession(rig.h, await L.createSession('ws-b'), 'ws-b'); await F.create(L.FILES);
r = await F.prompt('WRITE before-move.txt x'); say(`   before: ${term(r)}; ${L.statRoot('b')}`);
await F.detach(); L.svc('stop');
sh(`sudo mkdir -p /srv/w1a-moved && sudo chown wenshao:wenshao /srv/w1a-moved && mv ${R}/a /srv/w1a-moved/a && mv ${R}/b /srv/w1a-moved/b && mkdir -p /srv/w1a-moved/c/project /srv/w1a-moved/d/project`);
say(`   moved to /srv/w1a-moved: b is now ${sh("stat -c 'dev=%d ino=%i' /srv/w1a-moved/b")} (same device and inode), marker still says root=${JSON.parse(fs.readFileSync(`/srv/w1a-moved/b/${MARK}`, 'utf8')).root}`);
say('  ', L.svc('ROOTBASE=/srv/w1a-moved', 'start').split(' ===')[0]);
say(`   inspect at the new path: ${L.maint(['inspect', L.TENANT, 'st-b', '/srv/w1a-moved/b']).out}`);
let l = await F.load(); mark = rig.proxy.ledger.length;
r = await F.prompt('WRITE after-move.txt x'); say(`   cold load ${l.status}; next tool Turn: ${term(r)}; broker: ${since()}; written: ${fs.existsSync('/srv/w1a-moved/b/project/after-move.txt')}`);
await F.detach(); L.svc('stop');
sh(`mv /srv/w1a-moved/a ${R}/a && mv /srv/w1a-moved/b ${R}/b && sudo rm -rf /srv/w1a-moved`);
say('  ', L.svc('ROOTBASE=/srv/w1a', 'start').split(' ===')[0]);
l = await F.load(); mark = rig.proxy.ledger.length; r = await F.prompt('WRITE back-home.txt x'); say(`   moved back: cold load ${l.status}; next tool Turn: ${term(r)}; broker: ${since()}`);
await F.detach();

say('== (c) the same storage and database inspected with a different machine-id (private mount namespace, nothing else changes)');
fs.writeFileSync('/tmp/w1a-fake-machine-id', '0123456789abcdef0123456789abcdef\n');
const jdbc = `jdbc:mysql://127.0.0.1:${L.env().DBPORT || 3306}/${L.DB()}?allowPublicKeyRetrieval=true&useSSL=false`;
const inNs = (args) => sh(`sudo unshare -m sh -c 'mount --bind /tmp/w1a-fake-machine-id /etc/machine-id; exec sudo -u wenshao env W1_JDBC_URL="${jdbc}" W1_JDBC_USER=root W1_JDBC_PASSWORD=${L.env().DBPASS || 'rootpw'} /opt/qwen/jdk/bin/java -cp ${process.env.MAINT_JAR ?? '/opt/w1a/head-server.jar'} -Dloader.main=${L.MAIN} org.springframework.boot.loader.launch.PropertiesLauncher ${args}' 2>&1 | grep -v "^\\s*at \\|^Exception\\|^WARNING" | tail -1`);
say(`   real machine-id : ${L.inspect('b').out}`);
say(`   other machine-id: ${inNs(`inspect ${L.TENANT} st-b ${R}/b`)}`);
say(`   machine-id on the host afterwards: ${fs.readFileSync('/etc/machine-id', 'utf8').trim()} (unchanged)`);

say('== (d) restore-original on a fenced storage whose root was replaced (marker copied) while fenced');
L.svc('stop');
const fop = randomUUID();
L.sayMaint('s12-fence-a', L.maint(['fence', L.TENANT, 'st-a', `${R}/a`, '1', fop, '--offline-confirmed']));
sh(`mv ${R}/a ${R}/a.prev && mkdir -p ${R}/a/project && cp -p ${R}/a.prev/${MARK} ${R}/a/${MARK}`);
say(`   root replaced: ${sh(`stat -c 'ino=%i' ${R}/a.prev`)} -> ${sh(`stat -c 'ino=%i' ${R}/a`)}; inspect: ${L.inspect('a').out}`);
L.sayMaint('s12-restore-on-replaced-root', L.maint(['restore-original', L.TENANT, 'st-a', `${R}/a`, '1', fop, '--offline-confirmed'])); say('   row a:', L.mstr(L.mountRow('a')));
sh(`rm -rf ${R}/a && mv ${R}/a.prev ${R}/a`);
L.sayMaint('s12-restore-on-original-root', L.maint(['restore-original', L.TENANT, 'st-a', `${R}/a`, '1', fop, '--offline-confirmed'])); say('   row a:', L.mstr(L.mountRow('a')));

say('== (f) register when the root already carries a marker of another registration');
L.seedWs('ws-d', 'd');
sh(`cp -p ${R}/a/${MARK} ${R}/d/${MARK}`);
const dop = randomUUID();
L.sayMaint('s12-register-d-foreign-marker', L.maint(['register', L.TENANT, 'st-d', `${R}/d`, dop, '--offline-confirmed']));
say(`   marker in d still names storage: ${JSON.parse(fs.readFileSync(`${R}/d/${MARK}`, 'utf8')).storageId}; row d: ${L.mstr(L.mountRow('d'))}; inspect: ${L.inspect('d').out}`);
sh(`rm ${R}/d/${MARK}`);
L.sayMaint('s12-register-d-same-op-after-removing-it', L.maint(['register', L.TENANT, 'st-d', `${R}/d`, dop, '--offline-confirmed'])); say('   row d:', L.mstr(L.mountRow('d')));

say('== (e) register while a Turn holds the storage (the operator did not stop the service; option still off)');
L.seedWs('ws-c', 'c');
say('  ', L.svc('VERIFIED=false', 'start').split(' ===')[0]);
const H = new L.HSession(rig.h, await L.createSession('ws-c'), 'ws-c'); await H.create(L.SHELL);
const pending = H.prompt(L.shell64("perl -e 'select(undef,undef,undef,8)'; echo slept"), 60000);
let held = false; for (let k = 0; k < 60 && !held; k++) { held = (L.mountRow('c')?.holder ?? '-') !== '-'; if (!held) await L.sleep(100); }
const cop = randomUUID();
say(`   storage c holder present: ${held}`);
L.sayMaint('s12-register-c-while-held', L.maint(['register', L.TENANT, 'st-c', `${R}/c`, cop, '--offline-confirmed'])); say(`   row c: ${L.mstr(L.mountRow('c'))}; marker: ${fs.existsSync(`${R}/c/${MARK}`) ? 'present' : 'absent'}`);
const pr = await pending; say(`   the Turn finished: ${term(pr)}`);
L.sayMaint('s12-register-c-after-release', L.maint(['register', L.TENANT, 'st-c', `${R}/c`, cop, '--offline-confirmed'])); say(`   row c: ${L.mstr(L.mountRow('c'))}`);
await H.detach();
await rig.stop(); say('S12-DONE');
