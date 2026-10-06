// PR #13260 S5: the retained history root precondition on a fresh deployment where no file was ever overwritten
// (no backup was ever written, so $QWEN_HOME/file-history does not exist), and what an operator has to do.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's5';
L.openLog(`s5-${TAG}`);
const { say } = L;
const R = { tag: TAG, steps: [] };
const SRC = '/srv/pr13260/src/a'; const DST = '/srv/pr13260/dst/a';
await P.rollout(['a']);
L.seedWs('ws-a1', 'a');
const rig = await L.startRig(`s5-${TAG}`);
const F1 = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1');
say(`   F1 create=${(await F1.create(L.FILES)).status}`);
const p1 = await F1.prompt('WRITE new.txt created'); say(`     F1 WRITE new.txt (new file, no backup needed): ${P.term(p1)}`);
await F1.detach(); await rig.h.stop(); L.svc('stop'); await W.waitLeasesExpired('a');
const H = W.historyRoot();
const m0 = L.mountRow('a');
const req = M.migrationRequest({ revision: m0.revision, source: SRC, target: DST, bundle: `/srv/pr13260/bundles/${TAG}` });
const file = M.writeRequest(req, TAG);
const hstat = () => { try { return L.sh(`stat -c 'birth=%w mtime=%y' ${H}`); } catch { return '<absent>'; } };
const attempt = async (label) => {
  const r = await M.mig('retire', file, { label: `${TAG}-${label}`, quiet: true });
  const s = { label, history: hstat(), exit: r.code, out: r.code === 0 ? M.migSummary(r) : (r.cause || r.workerLine).slice(0, 120), rows: L.one('SELECT COUNT(*) FROM managed_workspace_migration'), fence: M.fenceRow('a') ? 'installed' : 'none' };
  R.steps.push(s); say(`   ${label.padEnd(34)} history root ${s.history} -> exit=${r.code} ${s.out} | rows=${s.rows} fence=${s.fence}`);
  return r;
};
await attempt('1 history root absent');
fs.mkdirSync(H);
await attempt('2 after mkdir');
L.sh(`touch -d '+1 second' ${H}`);
const ok = await attempt('3 after touch');
if (ok.code === 0) {
  L.sayMaint(`${TAG}-fence`, L.maint(['fence', L.TENANT, 'st-a', SRC, String(m0.revision), req.fenceOperationId, '--offline-confirmed']));
  W.prepareBundle(TAG, { sessions: W.members('a').map((m) => m.id) });
  await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: m0.revision, bundle: req.bundleRoot }), { label: `${TAG}-capture` });
  L.sh(`cp -a ${SRC} ${DST}`);
  R.prepare = M.migSummary(await M.mig('prepare', file, { label: `${TAG}-prepare` }));
  R.promote = M.migSummary(await M.mig('promote', file, { label: `${TAG}-promote` }));
  say('  ', L.svc(`ROOT_a=${DST}`, 'start').split('\n').at(-1).slice(0, 160));
  const h = await new L.Harness({ name: `s5-${TAG}-after`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
  F1.bind(h); const ld = await F1.load(L.FILES); const t = await F1.prompt('WRITE new.txt overwritten');
  const read = () => { try { return fs.readFileSync(`${DST}/project/new.txt`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
  const v = read();
  const rw = await h.json(`/session/${F1.sessionId}/files/rewind`, { promptId: p1.promptId, requestId: randomUUID() }, { clientId: F1.clientId });
  R.after = { load: ld.status, turn: P.term(t), afterWrite: v, undoPreMigration: `${rw.status} ${JSON.stringify(rw.json?.filesChanged)}`, afterUndo: read() };
  say(`   after: load=${ld.status} turn=${R.after.turn} new.txt=${v}; undo pre-migration p1: ${R.after.undoPreMigration} -> new.txt=${R.after.afterUndo}`);
  await F1.detach().catch(() => {}); await h.stop();
}
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s5-${TAG}.json`, JSON.stringify(R, null, 1));
say('S5-DONE');
