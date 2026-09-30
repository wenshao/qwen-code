// S2c: "a replacement directory at the same pathname can appear valid" — base vs PR (option off) vs PR (option on).
// Durable local workers. The root is replaced while the service is stopped.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM ?? 'head-on';
L.openLog(`s2c-replacement-${ARM}${process.env.ORDER ? '-' + process.env.ORDER : ''}`);
const { say } = L; const R = '/srv/w1a'; const sh = L.sh;
const PROFILE = ARM === 'base' ? L.FILES : undefined;
say(L.hostFacts()); say('arm:', ARM, '|', L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-a', 'a');
const rig = await L.startRig(`s2c-${ARM}`);
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const holder = () => { if (ARM === 'base') { const h = L.one(`SELECT IFNULL(holder_key,'-') FROM managed_workspace_execution_lease WHERE storage_key=${L.storageKey('a')}`); return h === undefined ? 'no row' : `holder=${h === '-' ? 'none' : h.slice(0, 10) + '…'} (base schema: no mount columns)`; }
  const m = L.mountRow('a'); return m ? `holder=${m.holder === '-' ? 'none' : m.holder.slice(0, 10) + '…'} mount_state=${m.state}` : 'no row'; };
const where = (f) => [`${R}/a/project/${f}`, `${R}/a.prev/project/${f}`].filter((p) => fs.existsSync(p)).map((p) => p.includes('a.prev') ? 'ORIGINAL (a.prev)' : 'directory at the configured path').join(',') || 'nowhere';
const A = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
say(`Session A create=${(await A.create(L.FILES)).status}`);
if (ARM === 'head-on') { await A.detach(); L.svc('stop'); L.sayMaint('register-a', L.maint(['register', L.TENANT, 'st-a', `${R}/a`, randomUUID(), '--offline-confirmed'])); say('  ', L.svc('start').split(' ===')[0]); say(`   A load=${(await A.load()).status}`); }
let r = await A.prompt('WRITE seed.txt original-content'); say('A turn 1:', L.turnStr(r).slice(0, 70)); say('   broker:', since()); say('  ', holder());
await A.detach(); L.svc('stop');
sh(`mv ${R}/a ${R}/a.prev && mkdir -p ${R}/a/project`);
say(`== root replaced while stopped: original ${sh(`stat -c 'dev=%d ino=%i' ${R}/a.prev`)} -> replacement ${sh(`stat -c 'dev=%d ino=%i' ${R}/a`)}`);
say('  ', L.svc('start').split(' ===')[0]);
let l; let N;
const existing = async () => {
l = await A.load(PROFILE); say(`existing Session A: load=${l.status}`);
const m0 = rig.model.state.calls; mark = rig.proxy.ledger.length;
const sub = await A.submit('WRITE after-a.txt x'); let st; const t0 = Date.now();
while (Date.now() - t0 < 45000) { st = await A.status(); if (st && !st.hasActivePrompt) break; await L.sleep(250); }
const ev = (await A.transcript()).filter((e) => e.promptId === sub.promptId && e.type.startsWith('turn_')).map((e) => e.type).join(',') || '<no terminal event>';
say(`   A tool Turn: admit=${sub.status} terminal=${ev} after ${Date.now() - t0} ms; status=${JSON.stringify(st)}`);
say(`   broker: ${since()}`); say(`   after-a.txt written: ${where('after-a.txt')}; ${holder()}; model calls +${rig.model.state.calls - m0}`);
};
const fresh = async () => {
N = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
say(`new Session N on the same Workspace: create=${(await N.create(L.FILES)).status}`);
r = await N.prompt('WRITE new.txt x', 45000); say('   N tool Turn (write):', L.turnStr(r).slice(0, 110)); say(`   broker: ${since()}`); say(`   new.txt written: ${where('new.txt')}`);
r = await N.prompt('READ seed.txt', 45000); say('   N tool Turn (read seed.txt):', L.turnStr(r).slice(0, 320)); say(`   broker: ${since()}`);
say(`   ${holder()}`);
};
if (process.env.ORDER === 'new-first') { await fresh(); await existing(); } else { await existing(); await fresh(); }
say('== undo: service stopped, original root moved back, service started');
await A.detach().catch(() => {}); await N.detach().catch(() => {}); L.svc('stop'); sh(`rm -rf ${R}/a.replacement && mv ${R}/a ${R}/a.replacement && mv ${R}/a.prev ${R}/a`); say('  ', L.svc('start').split(' ===')[0]);
l = await A.load(PROFILE); say(`existing Session A after the original root is back: load=${l.status} ${l.status === 200 ? '' : JSON.stringify(l.json)}`);
if (l.status === 200) { mark = rig.proxy.ledger.length; r = await A.prompt('WRITE back.txt x', 45000); say('   A tool Turn:', L.turnStr(r).slice(0, 110)); say(`   broker: ${since()}`); }
say(`   ${holder()}; files in the original: ${fs.readdirSync(`${R}/a/project`).join(' ')}; files left in the replacement: ${fs.readdirSync(`${R}/a.replacement/project`).join(' ') || '<none>'}`);
await rig.stop(); say('S2C-DONE');
