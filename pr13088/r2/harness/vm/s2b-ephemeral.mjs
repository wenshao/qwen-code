// S2b: default (non-durable) local-process mode. Does the next tool Turn work after a Broker restart?
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
const TAG = process.env.TAG ?? 'head-on';
L.openLog(`s2b-ephemeral-${TAG}`);
const { say } = L;
const PROFILE = TAG === 'base' ? L.FILES : undefined;
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-a', 'a');
const rig = await L.startRig(`s2b-${TAG}`);
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const A = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
say(`file Session A create=${(await A.create(L.FILES)).status}`);
if (TAG === 'head-on') { await A.detach(); L.svc('stop'); L.sayMaint('register-a', L.maint(['register', L.TENANT, 'st-a', '/srv/w1a/a', randomUUID(), '--offline-confirmed'])); say('  ', L.svc('start')); say(`   load=${(await A.load()).status}`); }
const procs = () => L.sh("ps -eo pid,ppid,args | grep -E 'cli.js' | grep -v grep | grep -v hosted-harness | cut -c1-110 || true").replace(/\n/g, ' ; ') || '<none>';
let r = await A.prompt('WRITE t1.txt x'); say('turn 1:', L.turnStr(r).slice(0, 90)); say('   broker:', since()); say('   worker processes:', procs());
r = await A.prompt('WRITE t2.txt x'); say('turn 2 (no restart):', L.turnStr(r).slice(0, 90)); say('   broker:', since());
const bind = () => L.sql(`SELECT LEFT(binding_id,8), runtime_generation, binding_state FROM qwen_runtime_binding ORDER BY runtime_generation`).map((x) => x.join('/')).join(' ');
say('   bindings:', bind());
await A.detach(); say('   graceful restart:', L.svc('restart').split(' ===')[0]); say('   worker processes:', procs()); say('   bindings:', bind());
say(`   load=${(await A.load(PROFILE)).status}`);
const t0 = Date.now(); let i = 0;
for (;;) {
  i += 1; mark = rig.proxy.ledger.length;
  r = await A.prompt(`WRITE after-${i}.txt x`);
  const term = r.terminal?.map((x) => x.type).join(',');
  say(`   +${Math.round((Date.now() - t0) / 1000)} s tool Turn ${i}: ${term} | ${since()} | bindings: ${bind()}`);
  if (term === 'turn_complete' || Date.now() - t0 > Number(process.env.MAXWAIT ?? 330000)) break;
  await L.sleep(30000);
}
await A.detach(); await rig.stop(); say('S2B-DONE');
