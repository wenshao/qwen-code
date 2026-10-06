// PR #13260 S12 (head 14b579d1): consequences of the scope decision "W1c migrates only hosted-workspace-files/1".
// Storages: a = files/1 only (control) · b = files/2 only · c = files/1 + files/2 · d = files/1 + a files/2 Session that is
// closed and DELETED before maintenance (retained members, including deleted ones, participate in W1c).
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's12';
L.openLog(`s12-${TAG}`);
const { say } = L;
const R = { tag: TAG, arms: [] };
const F2 = 'hosted-workspace-files/2';
const ST = ['a', 'b', 'c', 'd'];
say(L.hostFacts()); say(`   server ${L.env().JAR} dist ${L.env().DIST}`);
await P.rollout(ST);
for (const s of ST) L.seedWs(`ws-${s}1`, s);
const rig = await L.startRig(`s12-${TAG}`);
const S = {};
const open = async (name, s, profile) => {
  const h = new L.HSession(rig.h, await L.createSession(`ws-${s}1`), `ws-${s}1`); const c = await h.create(profile);
  const t1 = await h.prompt(`WRITE ${name}.txt one`); const t2 = await h.prompt(`WRITE ${name}.txt two`);
  say(`   st-${s} ${name} ${h.sessionId.slice(0, 8)} profile=${profile} create=${c.status}${c.status !== 200 ? ` ${JSON.stringify(c.json).slice(0, 120)}` : ''} ${P.term(t1)} ${P.term(t2)}`);
  await h.detach(); S[name] = h; return h;
};
await open('a1', 'a', L.FILES);
await open('b2', 'b', F2);
await open('c1', 'c', L.FILES); await open('c2', 'c', F2);
await open('d1', 'd', L.FILES); await open('d2', 'd', F2);
say(`   st-d files/2 Session: ${await P.lifecycle(S.d2.sessionId, 'close')} | ${await P.lifecycle(S.d2.sessionId, 'delete')} -> status ${L.one(`SELECT status FROM managed_agent_session WHERE session_id='${S.d2.sessionId}'`)}, journal head ${L.one(`SELECT IFNULL(MAX(state),'none') FROM qwen_managed_session_journal_head WHERE session_id='${S.d2.sessionId}'`)}`);
await rig.h.stop(); for (const s of ST) await W.waitLeasesExpired(s);
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);  // N1
const wk0 = M.workers().length;
for (const s of ST) {
  const req = M.migrationRequest({ revision: L.mountRow(s).revision, storage: s, source: `/srv/w1c-src/${s}`, target: `/srv/w1c-dst/${s}`, bundle: `/srv/w1c-bundles/${TAG}-${s}` });
  const r = await M.mig('retire', M.writeRequest(req, `${TAG}-${s}`), { label: `${TAG}-${s}-retire`, quiet: true });
  const arm = { storage: `st-${s}`, members: W.members(s).map((m) => m.status).join('+'), retire: r.code === 0 ? M.migSummary(r).slice(0, 40) : (r.workerLine || r.cause).slice(0, 100),
    rows: L.one(`SELECT COUNT(*) FROM managed_workspace_migration WHERE storage_id='st-${s}'`), fence: M.fenceRow(s) ? 'installed' : 'none', workersAlive: `${M.workers().length}/${wk0}` };
  R.arms.push(arm);
  say(`   st-${s} [${arm.members}] retire: ${arm.retire} | rows=${arm.rows} fence=${arm.fence} | rig workers alive ${arm.workersAlive}`);
}
// W1b capture of the files/2 storage still works (main widened recovery to /2): capture after a W1a fence only
{
  const s = 'b'; const fence = (await import('node:crypto')).randomUUID(); const m = L.mountRow(s);
  L.maint(['fence', L.TENANT, `st-${s}`, `/srv/w1c-src/${s}`, String(m.revision), fence, '--offline-confirmed']);
  W.prepareBundle(`${TAG}-cap-${s}`, { storage: s, sessions: W.members(s).map((x) => x.id) });
  const c = await W.w1b('capture', W.captureRequest({ fence, revision: m.revision, storage: s, bundle: `/srv/w1c-bundles/${TAG}-cap-${s}` }), { label: `${TAG}-${s}-w1b-capture`, quiet: true });
  R.w1bCaptureFiles2 = W.summary(c);
  say(`   st-b (files/2) plain W1b capture: ${R.w1bCaptureFiles2.slice(0, 110)}`);
}
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s12-${TAG}.json`, JSON.stringify(R, null, 1));
say('S12-DONE');
