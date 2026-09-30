// S4: whole-host restart with the option on (W0e-3 trusted reboot recovery on, durable workers).
//   PHASE=before : register four storages on four filesystems, run one tool Turn in each, save facts
//   PHASE=after  : (after a real reboot / power cut and a remount) cold load each Session and ask for the next tool Turn
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
const PHASE = process.env.PHASE; const TAG = process.env.TAG ?? PHASE;
L.openLog(`s4-reboot-${TAG}`);
const { say } = L; const R = '/srv/w1a'; const FACTS = `${L.OUT}/s4-facts.json`;
const STS = (process.env.STS ?? 'a l v t').split(' ');
const stat = (st) => { try { const s = fs.statSync(`${R}/${st}`, { bigint: true }); return `dev=${s.dev} ino=${s.ino}`; } catch (e) { return `<${e.code}>`; } };
const fsOf = (st) => L.sh(`findmnt -n -T ${R}/${st} -o SOURCE,FSTYPE | tr -s ' '`);
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
if (PHASE === 'before') {
  for (const s of STS) L.seedWs(`ws-${s}`, s);
  L.svc('stop');
  for (const s of STS) L.sayMaint(`s4-register-${s}`, L.maint(['register', L.TENANT, `st-${s}`, `${R}/${s}`, randomUUID(), '--offline-confirmed']));
  say('  ', L.svc('start').split(' ===')[0]);
  const rig = await L.startRig('s4-before');
  const facts = { boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), sessions: {} };
  for (const s of STS) {
    const S = new L.HSession(rig.h, await L.createSession(`ws-${s}`), `ws-${s}`);
    await S.create(L.FILES);
    const r = await S.prompt('WRITE before.txt written-before-the-restart');
    const m = L.mountRow(s);
    say(`${s}: ${fsOf(s).padEnd(38)} ${stat(s).padEnd(28)} registered dev=${m.device} ino=${m.inode} | Turn: ${r.terminal?.map((t) => t.type).join(',')} | inspect: ${L.inspect(s).out.replace(/operation=.*holder/, 'holder')}`);
    facts.sessions[s] = { id: S.sessionId, stat: stat(s), fs: fsOf(s) };
    await S.detach();
  }
  fs.writeFileSync(FACTS, JSON.stringify(facts, null, 1));
  say(`workers: ${L.workerPids().join(',')}`);
  await rig.stop(); say('S4-BEFORE-DONE');
} else {
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
  const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  say(`boot id ${facts.boot.slice(0, 8)} -> ${boot.slice(0, 8)} (${boot === facts.boot ? 'SAME boot' : 'new boot'}); workers alive: ${L.workerPids().join(',') || 'none'}`);
  const rig = await L.startRig(`s4-${TAG}`);
  let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
  const rows = [];
  for (const s of STS) {
    const f = facts.sessions[s]; const S = new L.HSession(rig.h, f.id, `ws-${s}`);
    const l = await S.load(); let turn = '-'; let ledger = '';
    if (l.status === 200) {
      // The trusted reboot scan runs every 5 s; give a refused first attempt one retry after it.
      for (let i = 0; i < 4; i++) {
        mark = rig.proxy.ledger.length;
        const r = await S.prompt(`WRITE after-${TAG}.txt x`, 60000); turn = r.terminal?.map((t) => t.type).join(',') || '<none>'; ledger = since();
        if (turn === 'turn_complete' || /workspace_unavailable/.test(ledger)) break;
        await L.sleep(6000);
      }
      await S.detach();
    }
    const now = stat(s); const before = fs.existsSync(`${R}/${s}/project/before.txt`);
    const row = { s, fs: fsOf(s), was: f.stat, now, same: now === f.stat, load: l.status, turn, ledger, inspect: L.inspect(s).out.replace(/state=(\w+) revision=(\d+).*holder=\w+ /, 'state=$1 rev=$2 '), before };
    rows.push(row);
    say(`${s}: ${row.fs.padEnd(38)} was ${row.was} now ${row.now} ${row.same ? '(unchanged)' : '(CHANGED)'}`);
    say(`   earlier file present: ${before}; cold load ${l.status}; next tool Turn: ${turn} | ${ledger}`);
    say(`   inspect: ${row.inspect}`);
  }
  fs.writeFileSync(`${L.OUT}/s4-${TAG}.json`, JSON.stringify(rows, null, 1));
  await rig.stop(); say('S4-AFTER-DONE');
}
