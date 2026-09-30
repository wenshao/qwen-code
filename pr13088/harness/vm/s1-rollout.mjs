// S1: the README rollout on a real Linux host with MySQL 8.4 and the shipped fat jar.
//   phase 0  option off (upgraded binaries, nothing registered): a file Session and a Shell Session each run a tool Turn
//   phase 1  option on before registration: new work is refused, nothing is enrolled from the directory found at startup
//   phase 2  service stopped: register / retry / conflicting retry / wrong-root typo, from the fat jar (no Maven)
//   phase 3  option on, Spring + Harness restarted: cold load without a tool profile, history, next Turn, no repeated effect
//   phase 4  SIGKILL of Spring, then of Spring + workers: cold load and next Turn again
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s1-rollout');
const { say } = L;
const cat = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return `<${e.code}>`; } };
const lines = (p) => cat(p).split('\n').filter(Boolean).length;
const facts = {};

say(L.hostFacts());
say('service:', L.svc('status').split('\n')[0]);
for (const s of 'abcd') L.seedWs(`ws-${s}`, s);
let rig = await L.startRig('s1');
const broker = () => rig.proxy.ledger;
let mark = 0; const since = () => { const s = L.ledgerStr(broker(), mark); mark = broker().length; return s; };
const SHELL_CALL = 'echo "call $(date +%s.%N)" >> .calls; echo b$(wc -l < .calls) > shell.txt; cat shell.txt; echo warn >&2';

say('== phase 0: option off (VERIFIED=false), nothing registered');
const A = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
const B = new L.HSession(rig.h, await L.createSession('ws-b'), 'ws-b');
say(`file Session A ${A.sessionId} create=${(await A.create(L.FILES)).status}; Shell Session B ${B.sessionId} create=${(await B.create(L.SHELL)).status}`);
let r = await A.prompt('WRITE note.txt v1'); say('A turn 1:', L.turnStr(r)); say('   broker:', since());
r = await B.prompt(L.shell64(SHELL_CALL)); say('B turn 1:', L.turnStr(r)); say('   broker:', since());
say(`   files: a/project/note.txt="${cat('/srv/w1a/a/project/note.txt')}" b/project/shell.txt="${cat('/srv/w1a/b/project/shell.txt').trim()}" .calls=${lines('/srv/w1a/b/project/.calls')}`);
say(`   rename A=${(await A.title('Restored File Workspace')).status} B=${(await B.title('Restored Shell Workspace')).status}; detach A=${(await A.detach()).status} B=${(await B.detach()).status}`);
say('   row a:', L.mstr(L.mountRow('a'))); say('   marker a:', fs.existsSync('/srv/w1a/a/.qwen-managed-storage.json') ? 'present' : 'absent');
facts.modelAfterPhase0 = rig.model.state.calls;

say('== phase 1: option turned on BEFORE registration (VERIFIED=true), Spring and Harness restarted');
say('  ', L.svc('VERIFIED=true', 'restart'));
await rig.restartHarness('s1-p1');
A.bind(rig.h); B.bind(rig.h);
let l = await A.load(); say(`A cold load (no profile): ${l.status} ${JSON.stringify(l.json).slice(0, 120)} ${l.ms} ms`);
const m0 = rig.model.state.calls; mark = broker().length;
r = await A.prompt('WRITE note-unregistered.txt x'); say('A turn on an unregistered mount:', L.turnStr(r)); for (const t of L.toolTrace(r.events)) say('     ', t);
say('   broker:', since());
say(`   model calls +${rig.model.state.calls - m0}; file created: ${fs.existsSync('/srv/w1a/a/project/note-unregistered.txt')}; row a: ${L.mstr(L.mountRow('a'))}; marker: ${fs.existsSync('/srv/w1a/a/.qwen-managed-storage.json') ? 'present' : 'absent'}`);
say('   A status after the refusal:', JSON.stringify(await A.status()));
r = await A.prompt('HISTORY'); say('A text-only turn after the refusal:', L.turnStr(r));
say(`   detach A=${(await A.detach()).status}`);

say('== phase 2: service stopped, register from the shipped fat jar');
say('  ', L.svc('stop') || 'service stopped'); say('   workers still alive (durable local process):', L.workerPids().join(',') || '<none>');
const op = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
say('   inspect a before:', L.inspect('a').out);
L.sayMaint('register-a-without-flag', L.maint(['register', L.TENANT, 'st-a', L.root('a'), op.a]));
L.sayMaint('register-a-bad-uuid', L.maint(['register', L.TENANT, 'st-a', L.root('a'), 'not-a-uuid', '--offline-confirmed']));
L.sayMaint('register-a', L.maint(['register', L.TENANT, 'st-a', L.root('a'), op.a, '--offline-confirmed']));
const rowA = JSON.stringify(L.mountRow('a')); const st1 = fs.statSync('/srv/w1a/a/.qwen-managed-storage.json');
say('   row a:', L.mstr(L.mountRow('a'))); say('   stat root a:', L.statRoot('a'));
say('   marker a:', cat('/srv/w1a/a/.qwen-managed-storage.json'));
say(`   marker mode=${(st1.mode & 0o777).toString(8)} nlink=${st1.nlink} size=${st1.size}; leftovers: ${fs.readdirSync('/srv/w1a/a').filter((n) => n.includes('.tmp')).join(',') || 'none'}`);
L.sayMaint('register-a-retry-same-op', L.maint(['register', L.TENANT, 'st-a', L.root('a'), op.a, '--offline-confirmed']));
const st2 = fs.statSync('/srv/w1a/a/.qwen-managed-storage.json');
say(`   after the retry: row unchanged=${JSON.stringify(L.mountRow('a')) === rowA}; marker inode unchanged=${st1.ino === st2.ino} mtime unchanged=${st1.mtimeMs === st2.mtimeMs}`);
L.sayMaint('register-a-other-op', L.maint(['register', L.TENANT, 'st-a', L.root('a'), randomUUID(), '--offline-confirmed']));
say(`   after the conflicting operation: row unchanged=${JSON.stringify(L.mountRow('a')) === rowA}`);
L.sayMaint('register-b', L.maint(['register', L.TENANT, 'st-b', L.root('b'), op.b, '--offline-confirmed']));
say('   inspect a:', L.inspect('a').out); say('   inspect b:', L.inspect('b').out); say('   inspect c (never registered):', L.inspect('c').out);

say('== phase 3: option on, registered; Spring and Harness restarted (new Harness boot id)');
say('  ', L.svc('VERIFIED=true', 'start'));
const boot0 = rig.h.bootId; await rig.restartHarness('s1-p3'); say(`   Harness boot id ${boot0.slice(0, 8)} -> ${rig.h.bootId.slice(0, 8)}`);
A.bind(rig.h); B.bind(rig.h); mark = broker().length; const m1 = rig.model.state.calls;
l = await A.load(); say(`A cold load (no profile): ${l.status} ${l.ms} ms`);
l = await B.load(); say(`B cold load (no profile): ${l.status} ${l.ms} ms`);
say(`   after both loads: model calls +${rig.model.state.calls - m1}, Broker calls: ${since()}`);
r = await A.prompt('HISTORY'); say('A history turn:', L.turnStr(r));
r = await A.prompt('WRITE note3.txt v3'); say('A next tool Turn:', L.turnStr(r)); say('   broker:', since());
r = await B.prompt('HISTORY'); say('B history turn:', L.turnStr(r));
r = await B.prompt(L.shell64(SHELL_CALL)); say('B next Shell Turn:', L.turnStr(r)); say('   broker:', since());
say(`   files: note.txt="${cat('/srv/w1a/a/project/note.txt')}" note3.txt="${cat('/srv/w1a/a/project/note3.txt')}" shell.txt="${cat('/srv/w1a/b/project/shell.txt').trim()}" .calls=${lines('/srv/w1a/b/project/.calls')} (2 = the first Shell effect was not repeated)`);
const C = new L.HSession(rig.h, await L.createSession('ws-c'), 'ws-c');
say(`Session C on the unregistered storage c: create=${(await C.create(L.FILES)).status}`);
r = await C.prompt('WRITE c.txt x'); say('C tool Turn:', L.turnStr(r)); for (const t of L.toolTrace(r.events)) say('     ', t); say('   broker:', since());
say(`   detach A=${(await A.detach()).status} B=${(await B.detach()).status} C=${(await C.detach()).status}`);

say('== phase 4a: SIGKILL the server (workers survive), restart Spring + Harness');
say(`   workers before: ${L.workerPids().join(',')}`);
say('   kill -9 of the server main PID only:', L.sh('P=$(systemctl show -p MainPID --value qwen-w1a.service); sudo kill -9 $P; sleep 1; echo "pid $P -> $(systemctl is-active qwen-w1a.service || true)"'));
say('  ', L.svc('restart')); await rig.restartHarness('s1-p4a'); A.bind(rig.h); B.bind(rig.h); mark = broker().length;
say(`   workers after the restart: ${L.workerPids().join(',')}`);
l = await A.load(); say(`A cold load: ${l.status} ${l.ms} ms`); l = await B.load(); say(`B cold load: ${l.status} ${l.ms} ms`);
r = await A.prompt('WRITE note4.txt v4'); say('A next tool Turn:', L.turnStr(r)); say('   broker:', since());
r = await B.prompt(L.shell64(SHELL_CALL)); say('B next Shell Turn:', L.turnStr(r)); say('   broker:', since());
say(`   .calls=${lines('/srv/w1a/b/project/.calls')} shell.txt="${cat('/srv/w1a/b/project/shell.txt').trim()}"; detach A=${(await A.detach()).status} B=${(await B.detach()).status}`);

say('== phase 4b: SIGKILL the Harness without detaching, then load in a new Harness');
l = await A.load(); say(`A load: ${l.status}`);
await rig.h.stop('SIGKILL'); rig.h = await new L.Harness({ name: 's1-p4b', modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url }).start(); A.bind(rig.h);
const t0 = Date.now(); let tries = 0;
for (;;) { l = await A.load(); tries += 1; if (l.status === 200 || Date.now() - t0 > 100000) break; if (tries === 1) say(`   first attempt: ${l.status} ${JSON.stringify(l.json).slice(0, 120)}`); await L.sleep(2000); }
say(`A cold load after a Harness SIGKILL: ${l.status} after ${Math.round((Date.now() - t0) / 1000)} s (${tries} attempts; the dead writer's 60 s lease must lapse)`);
r = await A.prompt('WRITE note5.txt v5'); say('A next tool Turn:', L.turnStr(r));
say('   rows:', L.mstr(L.mountRow('a')), '|', L.mstr(L.mountRow('b')));
say('   inspect a:', L.inspect('a').out);
say(`   model calls total ${rig.model.state.calls}; workers ${L.workerPids().join(',')}`);
await A.detach();
fs.writeFileSync(`${L.OUT}/s1-ids.json`, JSON.stringify({ A: A.sessionId, B: B.sessionId, C: C.sessionId, op }, null, 1));
await rig.stop();
say('S1-DONE');
