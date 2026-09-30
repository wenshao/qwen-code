// S2d: the registered root is deleted and restored from an older backup archive at the same pathname (service stopped).
// The archive contains the marker, because the marker lives in the tree. On ext4 the restored directory can get the
// same inode number back. Does the option-on deployment accept it as the verified original?
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog(`s2d-restore-from-backup${process.env.MAINT_JAR ? '-candidate' : ''}`);
const { say } = L; const R = '/srv/w1a'; const sh = L.sh;
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
const rig = await L.startRig('s2d');
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const ident = (st) => sh(`stat -c 'dev=%d ino=%i birth=%W' ${R}/${st}`);
const toolOut = (r) => { for (const t of L.toolTrace(r.events)) if (t.startsWith('result')) return t.slice(0, 230); return '<no tool result>'; };
const term = (r) => r.terminal?.map((t) => t.type).join(',') || '<none>';

async function scenario(st, label, between) {
  say(`== storage ${st}: ${label}`);
  L.seedWs(`ws-${st}`, st);
  L.svc('stop');
  L.sayMaint(`s2d-register-${st}`, L.maint(['register', L.TENANT, `st-${st}`, `${R}/${st}`, randomUUID(), '--offline-confirmed']));
  say('  ', L.svc('start').split(' ===')[0]);
  const S = new L.HSession(rig.h, await L.createSession(`ws-${st}`), `ws-${st}`); await S.create(L.FILES);
  let r = await S.prompt('WRITE data.txt version-1'); say(`   Turn 1 writes data.txt=version-1: ${term(r)}`);
  await S.detach(); L.svc('stop');
  sh(`tar -cpf ${R}/${st}.backup.tar -C ${R} ${st}`);
  say(`   backup taken (service stopped): ${sh(`tar -tf ${R}/${st}.backup.tar | tr '\\n' ' '`)}`);
  say('  ', L.svc('start').split(' ===')[0]); say(`   load=${(await S.load()).status}`);
  r = await S.prompt('WRITE data.txt version-2'); say(`   Turn 2 overwrites data.txt=version-2: ${term(r)}`);
  r = await S.prompt('WRITE only-after-backup.txt x'); say(`   Turn 3 writes only-after-backup.txt: ${term(r)}`);
  await S.detach(); L.svc('stop');
  const before = ident(st);
  sh(`rm -rf ${R}/${st}`); between?.(); sh(`tar -xpf ${R}/${st}.backup.tar -C ${R}`);
  const after = ident(st);
  const sameIno = before.split(' birth')[0] === after.split(' birth')[0];
  say(`   root deleted and restored from the backup: ${before} -> ${after}  (${sameIno ? 'SAME device and inode number' : 'different inode number'}; birth time ${before.split('birth=')[1] === after.split('birth=')[1] ? 'same' : 'differs'})`);
  say(`   on disk now: data.txt="${fs.readFileSync(`${R}/${st}/project/data.txt`, 'utf8')}", only-after-backup.txt ${fs.existsSync(`${R}/${st}/project/only-after-backup.txt`) ? 'present' : 'ABSENT'}`);
  say(`   inspect: ${L.inspect(st).out}`);
  say('  ', L.svc('start').split(' ===')[0]);
  const l = await S.load(); say(`   cold load: ${l.status}`);
  mark = rig.proxy.ledger.length; const m0 = rig.model.state.calls;
  r = await S.prompt('READ data.txt'); say(`   next Turn reads data.txt: ${term(r)} | ${since()}`); say(`      ${toolOut(r)}`);
  r = await S.prompt('WRITE after-restore.txt x'); say(`   next Turn writes a file: ${term(r)} | ${since()}; written: ${fs.existsSync(`${R}/${st}/project/after-restore.txt`)}`);
  say(`   (${L.seen(rig)}: the model still has Turn 2 "version-2" and Turn 3 in its history)`);
  await S.detach();
  return { st, sameIno, accepted: fs.existsSync(`${R}/${st}/project/after-restore.txt`) };
}
const a = await scenario('a', 'restore immediately after the delete', null);
const b = await scenario('b', 'control: an unrelated directory is created between the delete and the restore', () => { sh(`mkdir -p ${R}/unrelated-$$ && touch ${R}/unrelated-$$/x`); });
say(`== result: storage a (${a.sameIno ? 'inode number reused' : 'inode number changed'}) -> ${a.accepted ? 'ACCEPTED as the verified original' : 'refused'}; storage b (${b.sameIno ? 'inode number reused' : 'inode number changed'}) -> ${b.accepted ? 'ACCEPTED' : 'refused'}`);
await rig.stop(); say('S2D-DONE');
