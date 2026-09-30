// S8: upgrade of a populated MySQL 8.4 deployment from the PR base to the PR head, registration of pre-existing rows,
// and what an old binary does with a fenced storage (the documented rollback hazard).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s8-upgrade');
const { say } = L; const R = '/srv/w1a';
const flyway = () => L.sql(`SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 3`).map((r) => `V${r[0]} ${r[1]}${r[2] === '1' ? '' : ' FAILED'}`).join(' <- ');
const cols = () => L.sql(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${L.DB()}' AND TABLE_NAME='managed_workspace_execution_lease' ORDER BY ORDINAL_POSITION`).map((r) => r[0]).join(', ');
const startLog = () => L.sh(`grep -a -E "Migrating schema|Successfully applied|Schema .* is up to date|Started ManagedAgentServerApplication|more recent than|not resolved locally|Validate failed" /var/log/qwen-w1a/server.log | tail -4 | cut -c1-260 || true`).replace(/\n/g, '\n      ');
say(L.hostFacts()); say('phase 1: base jar + base bundle:', L.svc('status').replace(/\n/g, ' '));
for (const s of 'ab') L.seedWs(`ws-${s}`, s);
let rig = await L.startRig('s8-base', { dist: 'dist-base' });
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const A = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
const B = new L.HSession(rig.h, await L.createSession('ws-b'), 'ws-b');
say(`file Session A create=${(await A.create(L.FILES)).status}; Shell Session B create=${(await B.create(L.SHELL)).status}`);
let r = await A.prompt('WRITE base.txt from-base'); say('A Turn on base:', L.turnStr(r).slice(0, 80));
r = await B.prompt(L.shell64('echo "call" >> .calls; echo from-base')); say('B Turn on base:', L.turnStr(r).slice(0, 80));
say('   flyway:', flyway()); say('   lease columns:', cols());
say('   lease rows:', L.sql(`SELECT LEFT(storage_key,8), IFNULL(holder_key,'-') FROM managed_workspace_execution_lease`).map((x) => x.join(' holder=')).join(' | '));
say(`   workers (started by the base bundle): ${L.workerPids().join(',')}`);
await A.detach(); await B.detach(); await rig.stop();

say('phase 2: binaries swapped to the PR head, option off');
say('  ', L.svc('JAR=head-server.jar', 'DIST=dist-head', 'VERIFIED=false', 'restart').split(' ===')[0]);
say('   server log:\n     ', startLog());
say('   flyway:', flyway()); say('   lease columns:', cols());
say('   row a:', L.mstr(L.mountRow('a')), '| tenant/storage columns:', `${L.mountRow('a').tenant}/${L.mountRow('a').storage}`);
rig = await L.startRig('s8-head'); A.bind(rig.h); B.bind(rig.h); mark = 0;
say(`   cold load without a profile: A=${(await A.load()).status} B=${(await B.load()).status}`);
r = await A.prompt('WRITE head-off.txt x'); say('A next Turn (option off):', L.turnStr(r).slice(0, 80)); say('   broker:', since());
r = await B.prompt(L.shell64('echo "call" >> .calls; echo from-head')); say('B next Turn (option off):', L.turnStr(r).slice(0, 80));
await A.detach(); await B.detach();

say('phase 3: offline registration of the pre-existing rows, then option on');
L.svc('stop');
const op = randomUUID();
L.sayMaint('s8-register-a', L.maint(['register', L.TENANT, 'st-a', `${R}/a`, op, '--offline-confirmed']));
L.sayMaint('s8-register-b', L.maint(['register', L.TENANT, 'st-b', `${R}/b`, randomUUID(), '--offline-confirmed']));
say('   row a:', L.mstr(L.mountRow('a')), '| tenant/storage columns:', `${L.mountRow('a').tenant}/${L.mountRow('a').storage}`);
say('  ', L.svc('VERIFIED=true', 'start').split(' ===')[0]);
say(`   cold load: A=${(await A.load()).status} B=${(await B.load()).status}`); mark = rig.proxy.ledger.length;
r = await A.prompt('WRITE head-on.txt x'); say('A next Turn (option on):', L.turnStr(r).slice(0, 80)); say('   broker:', since());
r = await B.prompt(L.shell64('echo "call" >> .calls; wc -l < .calls')); say('B next Turn (option on):', L.turnStr(r).slice(0, 80));
say(`   files in a/project: ${fs.readdirSync(`${R}/a/project`).join(' ')}; b .calls lines=${fs.readFileSync(`${R}/b/project/.calls`, 'utf8').split('\n').filter(Boolean).length}`);
await A.detach(); await B.detach();

say('phase 4: storage a fenced for maintenance, then the OLD binary (base jar + base bundle) is started on the V21 schema');
L.svc('stop');
const fenceOp = randomUUID();
L.sayMaint('s8-fence-a', L.maint(['fence', L.TENANT, 'st-a', `${R}/a`, '1', fenceOp, '--offline-confirmed']));
say('   row a:', L.mstr(L.mountRow('a')));
await rig.stop();
const started = L.svc('JAR=base-server.jar', 'DIST=dist-base', 'VERIFIED=absent', 'start');
say('  ', started.split('\n').slice(0, 2).join(' / ').slice(0, 300)); say('   server log:\n     ', startLog());
if (/health=200/.test(started)) {
  rig = await L.startRig('s8-rollback', { dist: 'dist-base' }); A.bind(rig.h); mark = 0;
  say(`   base Harness: A load (with profile)=${(await A.load(L.FILES)).status}`);
  r = await A.prompt('WRITE written-while-fenced.txt x'); say('A tool Turn on the FENCED storage, old binary:', L.turnStr(r).slice(0, 80)); say('   broker:', since());
  say(`   written-while-fenced.txt: ${fs.existsSync(`${R}/a/project/written-while-fenced.txt`) ? 'WRITTEN (the old binary ignores the fence columns, as the README warns)' : 'not written'}; row a: ${L.mstr(L.mountRow('a'))}`);
  await A.detach(); await rig.stop();
}
say('phase 5: back to the PR head; the fence is still there; restore-original reopens it');
L.svc('stop');
say('  ', L.svc('JAR=head-server.jar', 'DIST=dist-head', 'VERIFIED=true', 'start').split(' ===')[0]);
rig = await L.startRig('s8-head2'); A.bind(rig.h); mark = 0;
say(`   A load=${(await A.load()).status}`);
r = await A.prompt('WRITE still-fenced.txt x'); say('A tool Turn while fenced (PR head):', L.turnStr(r).slice(0, 60)); say('   broker:', since());
await A.detach(); L.svc('stop');
L.sayMaint('s8-restore-a', L.maint(['restore-original', L.TENANT, 'st-a', `${R}/a`, '1', fenceOp, '--offline-confirmed']));
say('  ', L.svc('start').split(' ===')[0]); say(`   A load=${(await A.load()).status}`); mark = rig.proxy.ledger.length;
r = await A.prompt('WRITE reopened.txt x'); say('A tool Turn after restore-original:', L.turnStr(r).slice(0, 80)); say('   broker:', since()); say('   row a:', L.mstr(L.mountRow('a')));
await A.detach(); await rig.stop(); say('S8-DONE');
