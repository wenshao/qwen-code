// Smoke: one producer_lost Shell turn, then a second Session on the same Workspace.
import * as L from './lib.mjs';
const { d } = L;
L.openLog('smoke');
L.seedWs('a');
const rig = await L.startHarness('smoke');
try {
const A = await L.shellSession(rig.h, 'ws-a');
L.say(`Session A ${A.sessionId} create=${A.createStatus}`);
let r = await A.prompt('ESCAPE');
L.say('A turn 1:', L.turnSummary(r));
const b = L.binding(A.sessionId);
L.say(L.bstr(b)); L.say(L.hstr(L.holder('a')));
for (const e of L.executions(b.id)) L.say('  execution', e.join(' | '));
const m0 = L.markerLines('a'); await L.sleep(3000); L.say(`escaped-marker lines ${m0} -> ${L.markerLines('a')} in 3 s; escaped pids ${L.escapedPids().join(',')}; worker pids ${L.workerPids().join(',')}`);
for (const p of [...L.escapedPids(), ...L.workerPids()]) L.say(`  pid ${p}`, JSON.stringify(L.procIds(p)));
const B = await L.shellSession(rig.h, 'ws-a');
r = await B.prompt('HELLO bob');
L.say('B turn 1:', L.turnSummary(r));
r = await A.prompt('HELLO alice');
L.say('A turn 2:', L.turnSummary(r));
L.say('shell calls:', JSON.stringify(L.shellCalls('a')));
L.say('registrations:', JSON.stringify(L.registrations()).slice(0, 600));
} finally { await rig.stop(); }
