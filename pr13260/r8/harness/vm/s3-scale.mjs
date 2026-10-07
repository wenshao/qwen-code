// PR #13260 S3: maintenance-window cost on a larger Workspace (20,000 small files + one 256 MiB file in the tree),
// then the QWEN_HOME gate asymmetry: after st-a is migrated, restart with QWEN_HOME unset and run a Turn on st-a
// (migrated) and on st-b (never migrated).
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's3';
const N = Number(process.env.FILES ?? 20000);
L.openLog(`s3-${TAG}`);
const { say } = L;
const R = { tag: TAG, files: N };
const SRC = '/srv/w1c-src/a'; const DST = '/srv/w1c-dst/a';
say(L.hostFacts());
await P.rollout(['a', 'b']);
L.seedWs('ws-a1', 'a'); L.seedWs('ws-b1', 'b');
const rig = await L.startRig(`s3-${TAG}`);
const S = {};
for (const [n, ws] of [['F1', 'ws-a1'], ['B1', 'ws-b1']]) { S[n] = new L.HSession(rig.h, await L.createSession(ws), ws); say(`   ${n} create=${(await S[n].create(L.FILES)).status}`); }
for (const t of ['WRITE a.txt 1', 'WRITE a.txt 2', 'WRITE b.txt 1']) say(`     F1 ${t}: ${P.term(await S.F1.prompt(t))}`);
say(`     B1: ${P.term(await S.B1.prompt('WRITE b.txt 1'))}`);
for (const s of Object.values(S)) await s.detach();
await rig.h.stop(); L.svc('stop'); await W.waitLeasesExpired('a'); await W.waitLeasesExpired('b');
const t0 = Date.now();
L.sh(`cd ${SRC}/project && python3 -c "
import os
for d in range(100):
    os.makedirs(f'vendor/d{d:03d}', exist_ok=True)
    for i in range(${N} // 100):
        open(f'vendor/d{d:03d}/f{i:04d}.txt','w').write('x'*1024)
" && head -c 268435456 /dev/urandom > big.bin`);
say(`   added ${N} files + 256 MiB file in ${Date.now() - t0} ms; tree: ${L.sh(`find ${SRC} | wc -l`)} entries, ${L.sh(`du -sh ${SRC} | cut -f1`)}`);
const m0 = L.mountRow('a');
const req = M.migrationRequest({ revision: m0.revision, source: SRC, target: DST, bundle: `/srv/w1c-bundles/${TAG}` });
const file = M.writeRequest(req, TAG);
const T = {};
const timed = async (k, f) => { const t = Date.now(); const r = await f(); T[k] = Date.now() - t; return r; };
const hroot = W.historyRoot();
R.historyRootBefore = L.sh(`stat -c 'birth=%w mtime=%y' ${hroot}; ls ${hroot} | wc -l`).replace('\n', ' children=');
say(`   history root before retire: ${R.historyRootBefore}`);
let rt = await timed('retire', () => M.mig('retire', file, { label: `${TAG}-retire` }));
R.firstRetire = M.migSummary(rt); R.rowsAfterFirstRetire = L.one(`SELECT COUNT(*) FROM managed_workspace_migration`);
if (rt.code !== 0) {
  L.sh(`touch ${hroot}`);
  say(`   touched ${hroot}: ${L.sh(`stat -c 'birth=%w mtime=%y' ${hroot}`)}`);
  rt = await timed('retire', () => M.mig('retire', file, { label: `${TAG}-retire-after-touch` }));
  R.retireAfterTouch = M.migSummary(rt);
}
await timed('fence', async () => L.sayMaint(`${TAG}-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC, String(m0.revision), req.fenceOperationId, '--offline-confirmed'])));
await timed('bundleCopy', async () => W.prepareBundle(TAG, { sessions: W.members('a').map((m) => m.id) }));
await timed('capture', () => W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: m0.revision, bundle: req.bundleRoot }), { label: `${TAG}-capture` }));
await timed('targetCopy', async () => L.sh(`cp -a ${SRC} ${DST}`));
const p = await timed('prepare', () => M.mig('prepare', file, { label: `${TAG}-prepare` }));
const q = await timed('promote', () => M.mig('promote', file, { label: `${TAG}-promote` }));
R.timesMs = T; R.prepare = M.migSummary(p); R.promote = M.migSummary(q); R.mount = L.mstr(L.mountRow('a'));
say(`   times (ms): ${JSON.stringify(T)}`);

say('== QWEN_HOME unset after promotion: migrated st-a vs never-migrated st-b');
const arms = [];
for (const q2 of ['unset', 'default']) {
  say('  ', L.svc(`ROOT_a=${DST}`, `QHOME=${q2}`, 'restart').split('\n').at(-1).slice(0, 200));
  const h = await new L.Harness({ name: `s3-${TAG}-${q2}`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
  for (const n of ['F1', 'B1']) {
    S[n].bind(h); const ld = await S[n].load(L.FILES);
    const t = ld.status === 200 ? await S[n].prompt(`WRITE probe-${q2}.txt x`) : null;
    arms.push({ qwenHome: q2, session: n, storage: n === 'F1' ? 'st-a (migrated)' : 'st-b (not migrated)', load: ld.status, turn: t ? P.term(t).slice(0, 160) : '-' });
    say(`   QWEN_HOME=${q2} ${n} load=${ld.status} turn=${arms.at(-1).turn}`);
    await S[n].detach().catch(() => {});
  }
  await h.stop();
}
R.arms = arms;
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s3-${TAG}.json`, JSON.stringify(R, null, 1));
say('S3-DONE');
