// Smoke: option off; one file-profile Session and one Shell-profile Session each run a tool Turn.
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s0-smoke');
L.say(L.hostFacts());
L.seedWs('ws-a', 'a'); L.seedWs('ws-b', 'b');
const rig = await L.startRig('smoke');
try {
  const A = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
  L.say(`file Session ${A.sessionId} create=${(await A.create(L.FILES)).status}`);
  let r = await A.prompt('WRITE note.txt hello');
  L.say('A turn 1:', L.turnStr(r)); for (const t of L.toolTrace(r.events)) L.say('   ', t);
  L.say('  file:', fs.existsSync('/srv/w1a/a/project/note.txt') ? fs.readFileSync('/srv/w1a/a/project/note.txt', 'utf8') : '<missing>');
  L.say('  broker:', L.ledgerStr(rig.proxy.ledger)); let mark = rig.proxy.ledger.length;
  const B = new L.HSession(rig.h, await L.createSession('ws-b'), 'ws-b');
  L.say(`shell Session ${B.sessionId} create=${(await B.create(L.SHELL)).status}`);
  r = await B.prompt(L.shell64('echo shell-ok > shell.txt; cat shell.txt; pwd'));
  L.say('B turn 1:', L.turnStr(r)); for (const t of L.toolTrace(r.events)) L.say('   ', t);
  L.say('  broker:', L.ledgerStr(rig.proxy.ledger, mark));
  L.say('row a:', L.mstr(L.mountRow('a'))); L.say('row b:', L.mstr(L.mountRow('b')));
  L.say('inspect a:', JSON.stringify(L.inspect('a').out));
  L.say('workers:', L.workerPids().join(','), ' model calls:', rig.model.state.calls);
} finally { await rig.stop(); }
