// PR #13260 S4 (phase 1): a real kernel crash (sysrq 'b': immediate reboot, no sync) at the moment promote renames the
// target marker. Sets up to PREPARED, arms a root inotify watcher, then runs promote; the VM dies mid-run.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's4';
L.openLog(`s4-pre-${TAG}`);
const { say } = L;
const SRC = '/srv/pr13260/src/a'; const DST = '/srv/pr13260/dst/a';
say(L.hostFacts());
await P.rollout(['a']);
L.seedWs('ws-a1', 'a');
const rig = await L.startRig(`s4-${TAG}`);
const F1 = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1');
say(`   F1 ${F1.sessionId} create=${(await F1.create(L.FILES)).status}`);
const pr = {};
for (const [k, t] of [['p1', 'WRITE notes.txt v1'], ['p2', 'WRITE notes.txt v2']]) { const r = await F1.prompt(t); pr[k] = r.promptId; say(`     ${k} ${t}: ${P.term(r)}`); }
await F1.detach(); await rig.stop(); L.svc('stop'); await W.waitLeasesExpired('a');
const m0 = L.mountRow('a');
const req = M.migrationRequest({ revision: m0.revision, source: SRC, target: DST, bundle: `/srv/pr13260/bundles/${TAG}` });
const file = M.writeRequest(req, TAG);
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);  // single-Session history root: birth == mtime otherwise (see S3)
const need = (r, what) => { if (r.code !== 0) { say(`   ABORT: ${what} failed`); process.exit(2); } return r; };
need(await M.mig('retire', file, { label: `${TAG}-retire` }), 'retire');
L.sayMaint(`${TAG}-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC, String(m0.revision), req.fenceOperationId, '--offline-confirmed']));
W.prepareBundle(TAG, { sessions: W.members('a').map((m) => m.id) });
need(await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: m0.revision, bundle: req.bundleRoot }), { label: `${TAG}-capture` }), 'capture');
L.sh(`cp -a ${SRC} ${DST} && sync`);
need(await M.mig('prepare', file, { label: `${TAG}-prepare` }), 'prepare');
const state = { file, req, session: F1.sessionId, prompts: pr, sourceMarker: M.markerOf(SRC), targetMarkerBefore: M.markerOf(DST),
  devs: { src: M.stat('/srv/pr13260/src'), dst: M.stat('/srv/pr13260/dst') }, bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), mount: L.mountRow('a'), row: M.migRow(req.migrationOperationId) };
fs.writeFileSync(`${L.OUT}/s4-state.json`, JSON.stringify(state, null, 1));
L.sh('sync');
say(`   PREPARED; state saved; ${L.mstr(state.mount)}; boot_id=${state.bootId}`);
// Root watcher: on the marker rename inside the target, trigger an immediate reboot without syncing.
const w = spawn('sudo', ['/usr/bin/node', '-e', `const fs=require('fs');fs.watch(${JSON.stringify(DST)},(e,n)=>{if(e==='rename'&&String(n)==='.qwen-managed-storage.json'){fs.writeFileSync('/proc/sysrq-trigger','b');}});setInterval(()=>{},1e6);`], { detached: true, stdio: 'ignore' });
w.unref();
await L.sleep(1500);
say('   watcher armed; running promote (the VM should crash at the marker rename)');
const q = await M.mig('promote', file, { label: `${TAG}-promote-crash` });
say(`   UNEXPECTED: promote returned ${q.code} without a crash`);
