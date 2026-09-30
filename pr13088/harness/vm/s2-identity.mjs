// S2: A2 durable identity at deployment level. Every case: detach, stop the service, change the storage, start the
// service (option on), cold load the completed Session, ask for one new tool call. Then undo the change.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM ?? 'head-on';   // head-on | head-off | base
L.openLog(`s2-identity-${process.env.TAG ?? ARM}`);
const { say } = L;
const R = '/srv/w1a';
const MARK = '.qwen-managed-storage.json';
const exists = (p) => fs.existsSync(p);
say(L.hostFacts()); say('arm:', ARM, '|', L.svc('status').split('\n')[0]);
for (const s of 'abcd') L.seedWs(`ws-${s}`, s);
const rig = await L.startRig(`s2-${process.env.TAG ?? ARM}`);
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const results = [];
const PROFILE = ARM === 'base' ? L.FILES : undefined; // the base Harness needs the profile on load; the PR reads the saved one
const TAG = process.env.TAG ?? ARM;

const A = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
say(`file Session A ${A.sessionId} create=${(await A.create(L.FILES)).status}`);
if (ARM === 'head-on') {
  // Registration happens offline, before the first Turn.
  await A.detach(); L.svc('stop');
  L.sayMaint('register-a', L.maint(['register', L.TENANT, 'st-a', `${R}/a`, randomUUID(), '--offline-confirmed']));
  say('  ', L.svc('start')); say(`   A load=${(await A.load(PROFILE)).status}`);
}
let r = await A.prompt('WRITE seed.txt v1'); say('A turn 1 (before any change):', L.turnStr(r)); say('   broker:', since()); say('   worker pids:', L.workerPids().join(',') || '<none>');
const pub = async () => { const g = await L.api('GET', `/v1/agents/sessions/${A.sessionId}`); const e = await L.api('GET', `/v1/agents/sessions/${A.sessionId}/events`); return `GET session=${g.status} events=${e.status}`; };

let n = 0;
async function probe(label, mutate, undo, expect) {
  n += 1; const file = `case${n}.txt`;
  await A.detach(); L.svc('stop');
  await mutate();
  const started = L.svc('start');
  const up = /health=200/.test(started);
  let line, outcome = 'server did not start';
  if (up) {
    const l = await A.load(PROFILE);
    mark = rig.proxy.ledger.length; const m0 = rig.model.state.calls;
    const t = l.status === 200 ? await A.prompt(`WRITE ${file} x`) : null;
    const where = [`${R}/a/project/${file}`, `${R}/a.prev/project/${file}`, `${R}/a.real/project/${file}`, `${R}/a/project.bak/${file}`, `${R}/elsewhere/${file}`].filter(exists);
    const term = t?.terminal?.map((x) => x.type).join(',') ?? '-';
    const replaced = exists(`${R}/a.prev`) && where.includes(`${R}/a/project/${file}`);
    outcome = l.status !== 200 ? `load ${l.status} ${l.json?.code}` : term === 'turn_complete' && where.length ? `EXECUTED -> ${where.join(',')}${replaced ? ' (inside the REPLACEMENT directory; original is a.prev)' : ''}` : `REFUSED (${term}; ${since()})`;
    line = `load=${l.status} turn=${term} model+${rig.model.state.calls - m0} written=${where.join(',') || 'nowhere'} | ${await pub()}`;
  } else line = started.split('\n').slice(-3).join(' / ').slice(0, 300);
  const insp = ARM === 'head-on' ? L.inspect('a').out : '(n/a)';
  say(`case ${n} ${label}`); say(`   -> ${outcome}`); say(`   ${line}`); if (ARM === 'head-on') say(`   inspect: ${insp}`);
  results.push({ n, label, outcome, inspect: insp, expect });
  if (up) await A.detach();
  L.svc('stop'); await undo(); say('  ', L.svc('start').split(' ===')[0]);
  const l2 = await A.load(PROFILE); if (l2.status !== 200) say(`   !! reload after undo: ${l2.status} ${JSON.stringify(l2.json)}`);
}
const sh = L.sh;
await probe('control: nothing changed', async () => {}, async () => {}, 'execute');
await probe('root replaced at the same pathname (mv a a.prev; mkdir a/project)',
  async () => { sh(`mv ${R}/a ${R}/a.prev && mkdir -p ${R}/a/project`); say(`   original ${sh(`stat -c 'dev=%d ino=%i' ${R}/a.prev`)}; replacement ${sh(`stat -c 'dev=%d ino=%i' ${R}/a`)}`); },
  async () => { sh(`rm -rf ${R}/a && mv ${R}/a.prev ${R}/a`); }, 'refuse');
if (ARM === 'head-on') {
  await probe('replacement root with the marker copied into it',
    async () => { sh(`mv ${R}/a ${R}/a.prev && mkdir -p ${R}/a/project && cp -p ${R}/a.prev/${MARK} ${R}/a/${MARK}`); },
    async () => { sh(`rm -rf ${R}/a && mv ${R}/a.prev ${R}/a`); }, 'refuse');
  await probe('original root back in place (control after the two replacements)', async () => {}, async () => {}, 'execute');
  await probe('marker removed from the original root',
    async () => { sh(`mv ${R}/a/${MARK} ${R}/marker.keep`); }, async () => { sh(`mv ${R}/marker.keep ${R}/a/${MARK}`); }, 'refuse');
  await probe('marker registrationId edited',
    async () => { sh(`cp -p ${R}/a/${MARK} ${R}/marker.keep`); const j = JSON.parse(fs.readFileSync(`${R}/a/${MARK}`, 'utf8')); j.registrationId = randomUUID(); fs.writeFileSync(`${R}/a/${MARK}`, JSON.stringify(j)); },
    async () => { sh(`mv ${R}/marker.keep ${R}/a/${MARK}`); }, 'refuse');
  await probe('marker re-serialized (pretty-printed, same values)',
    async () => { sh(`cp -p ${R}/a/${MARK} ${R}/marker.keep`); const j = JSON.parse(fs.readFileSync(`${R}/a/${MARK}`, 'utf8')); fs.writeFileSync(`${R}/a/${MARK}`, JSON.stringify(j, null, 2) + '\n'); },
    async () => { sh(`mv ${R}/marker.keep ${R}/a/${MARK}`); }, 'execute');
  await probe('marker replaced by a symlink to an identical copy',
    async () => { sh(`mv ${R}/a/${MARK} ${R}/marker.keep && cp ${R}/marker.keep ${R}/marker.copy && ln -s ${R}/marker.copy ${R}/a/${MARK}`); },
    async () => { sh(`rm ${R}/a/${MARK} ${R}/marker.copy && mv ${R}/marker.keep ${R}/a/${MARK}`); }, 'refuse');
  await probe('saved cwd missing (mv project project.bak)',
    async () => { sh(`mv ${R}/a/project ${R}/a/project.bak`); }, async () => { sh(`mv ${R}/a/project.bak ${R}/a/project`); }, 'refuse');
  await probe('saved cwd replaced by a symlink to another directory',
    async () => { sh(`mv ${R}/a/project ${R}/a/project.bak && mkdir -p ${R}/elsewhere && ln -s ${R}/elsewhere ${R}/a/project`); },
    async () => { sh(`rm ${R}/a/project && mv ${R}/a/project.bak ${R}/a/project && rm -rf ${R}/elsewhere`); }, 'refuse');
  await probe('root replaced by a symlink to the moved original (mv a a.real; ln -s a.real a)',
    async () => { sh(`mv ${R}/a ${R}/a.real && ln -s ${R}/a.real ${R}/a`); }, async () => { sh(`rm ${R}/a && mv ${R}/a.real ${R}/a`); }, 'refuse');
  const fenceOp = randomUUID();
  await probe('storage fenced offline (fence <rev 1> <op>)',
    async () => { L.sayMaint('fence-a-rev1', L.maint(['fence', L.TENANT, 'st-a', `${R}/a`, '1', fenceOp, '--offline-confirmed'])); say('   row:', L.mstr(L.mountRow('a'))); },
    async () => {
      L.sayMaint('fence-a-rev1-retry', L.maint(['fence', L.TENANT, 'st-a', `${R}/a`, '1', fenceOp, '--offline-confirmed']));
      L.sayMaint('fence-a-other-op-while-fenced', L.maint(['fence', L.TENANT, 'st-a', `${R}/a`, '1', randomUUID(), '--offline-confirmed']));
      L.sayMaint('restore-a-other-op', L.maint(['restore-original', L.TENANT, 'st-a', `${R}/a`, '1', randomUUID(), '--offline-confirmed']));
      L.sayMaint('restore-a-wrong-rev', L.maint(['restore-original', L.TENANT, 'st-a', `${R}/a`, '2', fenceOp, '--offline-confirmed']));
      L.sayMaint('restore-a', L.maint(['restore-original', L.TENANT, 'st-a', `${R}/a`, '1', fenceOp, '--offline-confirmed'])); say('   row:', L.mstr(L.mountRow('a')));
      L.sayMaint('restore-a-retry', L.maint(['restore-original', L.TENANT, 'st-a', `${R}/a`, '1', fenceOp, '--offline-confirmed'])); say('   row after the retry:', L.mstr(L.mountRow('a')));
      L.sayMaint('delayed-old-fence-rev1', L.maint(['fence', L.TENANT, 'st-a', `${R}/a`, '1', fenceOp, '--offline-confirmed'])); say('   row after the delayed fence:', L.mstr(L.mountRow('a')));
    }, 'refuse');
  await probe('after restore-original (revision 2)', async () => {}, async () => {}, 'execute');
}
say('== summary');
for (const x of results) say(`  ${String(x.n).padStart(2)} ${x.expect === 'execute' ? (x.outcome.startsWith('EXECUTED') ? 'ok ' : '!! ') : (x.outcome.startsWith('EXECUTED') ? '!! ' : 'ok ')} ${x.label} -> ${x.outcome}`);
fs.writeFileSync(`${L.OUT}/s2-${TAG}.json`, JSON.stringify(results, null, 1));
say(`   files under a/project: ${fs.readdirSync(`${R}/a/project`).sort().join(' ')}`);
await A.detach(); await rig.stop();
say('S2-DONE');
