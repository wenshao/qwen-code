// PR #13260 S2: refusal / interruption / rollback matrix on real Linux mounts (one DB, four storages).
//  st-a: Files Sessions -> migrated to a target that IS an ext4 mount root (lost+found), with operator mistakes on the way,
//        SIGKILLs during prepare and at the marker rename, then deployment restarts with wrong settings.
//  st-b: Files Session -> source drift after PREPARED -> INVALIDATED -> abort -> W1a restore-original rollback.
//  st-c: a Shell-profile Session (unsupported) ; st-d: a public Session that was never attached (uninitialized).
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's2';
L.openLog(`s2-${TAG}`);
const { say } = L;
const R = { tag: TAG };
const SRC = (st) => `/srv/pr13260/src/${st}`;
const MR = '/srv/pr13260/mr';
const read = (root, f) => { try { return fs.readFileSync(`${root}/${f}`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
const rowsFor = (st) => `rows=${L.one(`SELECT COUNT(*) FROM managed_workspace_migration WHERE storage_id='st-${st}'`)} fence=${M.fenceRow(st) ? M.fenceRow(st).slice(0, 8) : 'none'}`;
say(L.hostFacts());

await P.rollout(['a', 'b', 'c', 'd']);
for (const [ws, st] of [['ws-a1', 'a'], ['ws-b1', 'b'], ['ws-c1', 'c'], ['ws-d1', 'd']]) L.seedWs(ws, st);
const rig = await L.startRig(`s2-${TAG}`);
const S = {}; const PR = {};
const open = async (name, ws, profile = L.FILES) => {
  const s = new L.HSession(rig.h, await L.createSession(ws), ws); const c = await s.create(profile);
  say(`   ${name} ${s.sessionId} (${ws}, ${profile}) create=${c.status}`); S[name] = s; return s;
};
const run = async (name, label, text) => { const r = await S[name].prompt(text); PR[label] = r.promptId; say(`     ${name} ${label}: ${P.term(r)}`); return r; };
await open('A1', 'ws-a1'); await run('A1', 'a1', 'WRITE notes.txt one'); await run('A1', 'a2', 'WRITE notes.txt two');
await open('B1', 'ws-b1'); await run('B1', 'b1', 'WRITE b.txt one');
await open('C1', 'ws-c1', L.SHELL); await run('C1', 'c1', L.shell64('echo shell > s.txt && echo ok'));
const D1 = await L.createSession('ws-d1'); say(`   D1 ${D1} (ws-d1) public create only, never attached`);
for (const s of Object.values(S)) await s.detach();
await rig.h.stop(); L.svc('stop');
for (const st of ['a', 'b', 'c']) await W.waitLeasesExpired(st);
const wk0 = M.workers(); say(`   offline; durable workers still alive: ${wk0.length}`);
const rev = (st) => L.mountRow(st).revision;

say('== A preflight refusals (each must leave no migration row and no storage fence)');
const pre = async (label, st, over, opts = {}) => {
  const req = M.migrationRequest({ revision: rev(st), storage: st, source: SRC(st), target: `/srv/pr13260/dst/${st}`, bundle: `/srv/pr13260/bundles/${TAG}-${st}`, ...over });
  const r = await M.mig('retire', M.writeRequest(req, `${TAG}-${label}`), { label: `${TAG}-${label}`, quiet: true, ...opts });
  const out = { label, exit: r.code, refusal: (r.cause || r.workerLine).slice(0, 140), after: rowsFor(st), workersAlive: wk0.filter((w) => M.alive(w.pid)).length };
  say(`   ${label.padEnd(44)} exit=${r.code} ${out.refusal} | ${out.after} | workers alive ${out.workersAlive}/${wk0.length}`);
  return out;
};
R.pre = [];
R.pre.push(await pre('A1 state dir missing', 'a', { state: `/var/lib/pr13260/${L.DB()}-missing` }));
L.sh(`chmod 755 ${M.stateDir()}`); R.pre.push(await pre('A2 state dir mode 0755', 'a', {})); L.sh(`chmod 700 ${M.stateDir()}`);
L.sh(`ln -sfn ${M.homeOf()} /var/lib/pr13260/home-link-${L.DB()}`);
R.pre.push(await pre('A3 history root through a symlink', 'a', { history: `/var/lib/pr13260/home-link-${L.DB()}/file-history` }));
R.pre.push(await pre('A4 Shell-profile member (st-c)', 'c', {}));
R.pre.push(await pre('A5 never-attached member (st-d)', 'd', {}));

say('== B st-a -> target is the mount root of a fresh ext4 volume');
const reqA = M.migrationRequest({ revision: rev('a'), storage: 'a', source: SRC('a'), target: MR, bundle: `/srv/pr13260/bundles/${TAG}-a` });
const fileA = M.writeRequest(reqA, `${TAG}-a`);
const retA = await M.mig('retire', fileA, { label: `${TAG}-a-retire` });
say(`   workers alive after retire: ${wk0.filter((w) => M.alive(w.pid)).length}/${wk0.length}; ${rowsFor('a')}; st-a bindings ${M.bindingStr(M.bindings('a'))}`);

say('== B0 operator error: Spring restarted while the storage fence is installed (W1a not yet fenced)');
say('  ', L.svc('start').split('\n').at(-1));
const h0 = await new L.Harness({ name: `s2-${TAG}-fenced`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
rig.h = h0;
const during = {};
for (const n of ['A1', 'B1']) {
  S[n].bind(h0); const ld = await S[n].load(L.FILES);
  const t = ld.status === 200 ? await S[n].prompt('WRITE during.txt fenced') : null;
  during[n] = { load: ld.status, loadCode: ld.json?.code, turn: t ? P.term(t) : '-', proxy: L.ledgerStr(rig.proxy.ledger, rig.proxy.ledger.length - 4) };
  say(`   ${n} load=${ld.status}${ld.json?.code ? ` ${ld.json.code}` : ''} turn=${during[n].turn}`);
  await S[n].detach().catch(() => {});
}
during.stAworkers = M.workers().filter((w) => w.cwd.startsWith(SRC('a'))).length;
during.fileWritten = read(`${SRC('a')}/project`, 'during.txt');
say(`   st-a workers started while fenced: ${during.stAworkers}; st-a during.txt=${during.fileWritten}; Broker calls: ${L.ledgerStr(rig.proxy.ledger).slice(-400)}`);
R.during = during;
await h0.stop(); L.svc('stop');
for (const st of ['a', 'b']) await W.waitLeasesExpired(st);
// B1's Turn above created a new st-b placement; retire later handles st-b.
L.sayMaint(`${TAG}-a-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC('a'), String(reqA.mountRevision), reqA.fenceOperationId, '--offline-confirmed']));
W.prepareBundle(`${TAG}-a`, { storage: 'a', sessions: W.members('a').map((m) => m.id) });
await W.w1b('capture', W.captureRequest({ op: reqA.captureOperationId, fence: reqA.fenceOperationId, revision: reqA.mountRevision, bundle: reqA.bundleRoot }), { label: `${TAG}-a-capture` });
L.sh(`rsync -aH ${SRC('a')}/ ${MR}/`);
say(`   target ${MR}: ${M.fsOf(MR)} entries: ${fs.readdirSync(MR).join(' ')}`);
const steps = [];
const step = async (label, cmd, opts = {}, before) => {
  before?.();
  const r = await M.mig(cmd, fileA, { label: `${TAG}-a-${label.replace(/\s+/g, '-')}`, quiet: true, ...opts });
  const row = M.migRow(reqA.migrationOperationId); const m = L.mountRow('a');
  const s = { label, exit: r.code, killed: r.killed, refusal: r.code === 0 ? '' : (r.workerLine || r.cause).slice(0, 120), state: row.state, lastError: row.error, mount: `${m.state}/rev${m.revision}`, marker: M.markerBrief(MR), tmp: fs.readdirSync(MR).filter((f) => f.includes('.tmp')).join(',') || '-' };
  steps.push(s);
  say(`   ${label.padEnd(46)} exit=${r.code}${r.killed ? ` [${r.killed}]` : ''} ${s.refusal} | row ${row.state}/${row.error} | mount ${s.mount} | tmp=${s.tmp}`);
  return r;
};
await step('B1 prepare (lost+found present)', 'prepare');
L.sh(`rmdir ${MR}/lost+found`);
await step('B2 prepare, maintenance QWEN_HOME unset', 'prepare', { home: null });
L.sh(`ln -sfn ${M.homeOf()} /var/lib/pr13260/home-link-${L.DB()}`);
await step('B3 prepare, QWEN_HOME = symlink alias', 'prepare', { home: `/var/lib/pr13260/home-link-${L.DB()}` });
fs.writeFileSync(`${MR}/stray.txt`, 'copied by mistake\n');
await step('B4 prepare, undeclared target file', 'prepare');
fs.rmSync(`${MR}/stray.txt`);
let workerSeen = 0;
const midScan = () => { const v = M.migRow(reqA.migrationOperationId)?.verify; if (!v || v === '-' || L.one(`SELECT COUNT(*) FROM managed_workspace_recovery_operation WHERE operation_id='${v}'`) === '0') return false; workerSeen ||= Date.now(); return Date.now() - workerSeen > 1500; };
midScan.label = 'verify attempt row exists + 1.5 s (mid worker scan)';
await step('B5 prepare, SIGKILL mid worker scan', 'prepare', { killWhen: midScan });
await step('B6 prepare retry', 'prepare');
const markerBefore = M.markerOf(MR);
await step('B7 promote, SIGKILL at the marker rename', 'promote', { killOnWatch: { dir: MR, test: (ev, n) => ev === 'rename' && n === '.qwen-managed-storage.json' } });
R.markerReplacedBeforeKill = M.markerOf(MR) !== markerBefore;
await step('B8 promote retry', 'promote');
await step('B9 promote replay', 'promote');
await step('B10 abort after completion', 'abort');
R.steps = steps;
R.mountA = L.mountRow('a');

say('== C deployment restarts after promotion (st-a now at the mount root)');
const turnA = async (label, settings) => {
  say('  ', L.svc(...settings, 'restart').split('\n').at(-1));
  const h = await new L.Harness({ name: `s2-${TAG}-${label}`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
  S.A1.bind(h); const ld = await S.A1.load(L.FILES);
  const t = ld.status === 200 ? await S.A1.prompt(`WRITE probe.txt ${label}`) : null;
  const tail = L.sh('grep -aE "Workspace execution authority is unavailable|workspace_unavailable|workspace_migrating" /var/lib/pr13260/log/server.log | tail -1 | cut -c1-220 || true');
  const out = { label, settings: settings.join(' '), load: ld.status, loadCode: ld.json?.code, loadMsg: JSON.stringify(ld.json ?? {}).slice(0, 200), turn: t ? P.term(t) : '-', target: read(`${MR}/project`, 'probe.txt'), source: read(`${SRC('a')}/project`, 'probe.txt'), log: tail };
  say(`   ${label.padEnd(26)} load=${ld.status}${ld.json?.code ? ` ${ld.json.code}` : ''} turn=${out.turn} | probe.txt target=${out.target} source=${out.source}`);
  await S.A1.detach().catch(() => {}); await h.stop();
  return out;
};
R.restarts = [];
R.restarts.push(await turnA('old-mapping', ['ROOT_a=']));
R.restarts.push(await turnA('qwen-home-unset', [`ROOT_a=${MR}`, 'QHOME=unset']));
R.restarts.push(await turnA('qwen-home-symlink', [`ROOT_a=${MR}`, `QHOME=/var/lib/pr13260/home-link-${L.DB()}`]));
R.restarts.push(await turnA('canonical', [`ROOT_a=${MR}`, 'QHOME=default']));
L.svc('stop'); await W.waitLeasesExpired('a'); await W.waitLeasesExpired('b');

say('== D st-b: source drift after PREPARED -> INVALIDATED -> abort -> W1a restore-original rollback');
const reqB = M.migrationRequest({ revision: rev('b'), storage: 'b', source: SRC('b'), target: '/srv/pr13260/dst/b', bundle: `/srv/pr13260/bundles/${TAG}-b` });
const fileB = M.writeRequest(reqB, `${TAG}-b`);
await M.mig('retire', fileB, { label: `${TAG}-b-retire` });
L.sayMaint(`${TAG}-b-fence`, L.maint(['fence', L.TENANT, 'st-b', SRC('b'), String(reqB.mountRevision), reqB.fenceOperationId, '--offline-confirmed']));
W.prepareBundle(`${TAG}-b`, { storage: 'b', sessions: W.members('b').map((m) => m.id) });
await W.w1b('capture', W.captureRequest({ op: reqB.captureOperationId, fence: reqB.fenceOperationId, revision: reqB.mountRevision, storage: 'b', bundle: reqB.bundleRoot }), { label: `${TAG}-b-capture` });
L.sh(`cp -a ${SRC('b')} /srv/pr13260/dst/b`);
const D = {};
D.prepare = M.migSummary(await M.mig('prepare', fileB, { label: `${TAG}-b-prepare` }));
fs.appendFileSync(`${SRC('b')}/project/b.txt`, 'edited after capture\n');
const pd = await M.mig('promote', fileB, { label: `${TAG}-b-promote-drift` });
D.promote = { exit: pd.code, refusal: (pd.workerLine || pd.cause).slice(0, 140), row: M.migStr(M.migRow(reqB.migrationOperationId)), mount: L.mstr(L.mountRow('b')), targetMarkerIsSource: M.markerOf('/srv/pr13260/dst/b') === M.markerOf(SRC('b')) };
say(`   promote after drift: exit=${pd.code} ${D.promote.refusal} | ${D.promote.row} | ${D.promote.mount} | target marker still the source marker=${D.promote.targetMarkerIsSource}`);
const pr = await M.mig('promote', fileB, { label: `${TAG}-b-promote-again` });
D.promoteAgain = `exit=${pr.code} ${(pr.workerLine || pr.cause).slice(0, 120)}`;
const ab = await M.mig('abort', fileB, { label: `${TAG}-b-abort` });
D.abort = { exit: ab.code, out: M.migSummary(ab), fence: M.fenceRow('b') ?? 'cleared', mount: L.mstr(L.mountRow('b')) };
say(`   abort: ${D.abort.out} | storage fence ${D.abort.fence} | ${D.abort.mount}`);
L.sh(`printf 'one\\n' > ${SRC('b')}/project/b.txt`);  // undo the drift by hand (content back to the captured bytes)
const ro = L.maint(['restore-original', L.TENANT, 'st-b', SRC('b'), String(reqB.mountRevision), reqB.fenceOperationId, '--offline-confirmed']);
L.sayMaint(`${TAG}-b-restore-original`, ro);
D.restore = { exit: ro.code, out: ro.code === 0 ? ro.out : ro.cause, mount: L.mstr(L.mountRow('b')) };
say('  ', L.svc(`ROOT_a=${MR}`, 'QHOME=default', 'start').split('\n').at(-1));
const hB = await new L.Harness({ name: `s2-${TAG}-b-after`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
S.B1.bind(hB); const ldB = await S.B1.load(L.FILES); const tB = ldB.status === 200 ? await S.B1.prompt('WRITE b2.txt after-rollback') : null;
D.after = { load: ldB.status, turn: tB ? P.term(tB) : '-', file: read(`${SRC('b')}/project`, 'b2.txt') };
say(`   st-b after rollback: load=${ldB.status} turn=${D.after.turn} b2.txt(source)=${D.after.file}`);
await S.B1.detach().catch(() => {}); await hB.stop();
R.D = D;
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s2-${TAG}.json`, JSON.stringify(R, null, 1));
say('S2-DONE');
