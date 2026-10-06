// PR #13260 S9: R7-1 on the real public API. Spring keeps admitting (the operator mistake the storage fence exists for).
// Per trial (one fresh storage each): connection X holds the tenant placement-guard row; `retire` queues on it (LOCK WAIT 1);
// then POST /v1/agents/sessions for that storage queues too (LOCK WAIT 2); X commits. Correct: retire installs the fence and
// the create is refused, leaving no new member. Also: replay of a pre-fence creation receipt during the fence.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's9';
L.openLog(`s9-${TAG}`);
const { say } = L;
const ST = ['a', 'b', 'c'];
const R = { tag: TAG, server: L.env().JAR, migJar: M.MIG_JAR, trials: [] };
say(L.hostFacts()); say(`   server ${L.env().JAR} | migration jar ${M.MIG_JAR}`);
await P.rollout(ST);
for (const s of ST) L.seedWs(`ws-${s}1`, s);
const rig = await L.startRig(`s9-${TAG}`);
const S = {}; const KEYS = {};
for (const s of ST) {
  // one initialized member per storage, plus a pre-fence public create whose Idempotency-Key we replay later
  KEYS[s] = randomUUID();
  const cr = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: `ws-${s}1`, cwd_relative: 'project' } }, { key: KEYS[s] });
  S[s] = new L.HSession(rig.h, cr.json.id ?? cr.json.session_id, `ws-${s}1`);
  say(`   st-${s} F ${S[s].sessionId.slice(0, 8)} create=${(await S[s].create(L.FILES)).status} ${P.term(await S[s].prompt('WRITE a.txt 1'))} ${P.term(await S[s].prompt('WRITE a.txt 2'))}`);
  await S[s].detach();
}
await rig.h.stop();
for (const s of ST) await W.waitLeasesExpired(s);
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);  // N1
const members = (s) => Number(L.one(`SELECT COUNT(*) FROM managed_agent_session WHERE tenant_id='${L.TENANT}' AND workspace_storage_id='st-${s}'`));
const guardKey = L.one(`SELECT tenant_key FROM qwen_runtime_placement_guard WHERE tenant_id='${L.TENANT}'`);
say(`   Spring keeps running; placement-guard key ${guardKey?.slice(0, 12)}…`);
for (const s of ST) {
  const before = members(s);
  const req = M.migrationRequest({ revision: L.mountRow(s).revision, storage: s, source: `/srv/w1c-src/${s}`, target: `/srv/w1c-dst/${s}`, bundle: `/srv/w1c-bundles/${TAG}-${s}` });
  const file = M.writeRequest(req, `${TAG}-${s}`);
  const x = M.rowLockHolder('qwen_runtime_placement_guard', 'tenant_key', guardKey);
  await x.lock();
  const rp = M.mig('retire', file, { label: `${TAG}-${s}-retire`, quiet: true });
  await M.until(() => M.lockWaits() >= 1, 'retire queued');
  const key = randomUUID();
  const cp = L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: `ws-${s}1`, cwd_relative: 'project' } }, { key });
  await M.until(() => M.lockWaits() >= 2, 'create queued behind retire');
  x.release();
  const [r, c] = await Promise.all([rp, cp]); x.close();
  const after = members(s);
  const newId = c.json?.id ?? c.json?.session_id;
  const replay = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: `ws-${s}1`, cwd_relative: 'project' } }, { key });
  const fresh = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: `ws-${s}1`, cwd_relative: 'project' } }, { key: randomUUID() });
  const t = { storage: `st-${s}`, retire: r.code === 0 ? M.migSummary(r).slice(0, 30) : (r.workerLine || r.cause).slice(0, 80), fence: M.fenceRow(s) ? 'installed' : 'none',
    create: `${c.status} ${c.json?.error?.code ?? (newId ? `id=${String(newId).slice(0, 8)}` : JSON.stringify(c.json).slice(0, 80))}`,
    membersBefore: before, membersAfter: after, sameKeyReplay: `${replay.status} ${replay.json?.error?.code ?? ''}`.trim(), newCreateDuringFence: `${fresh.status} ${fresh.json?.error?.code ?? ''}`.trim(),
    strayMemberStatus: after > before ? L.one(`SELECT status FROM managed_agent_session WHERE session_id='${newId}'`) : '-' };
  R.trials.push(t);
  say(`   st-${s}: retire ${t.retire} fence=${t.fence} | queued create -> ${t.create} | members ${before}→${after}${after > before ? ` (stray ${t.strayMemberStatus})` : ''} | same-key replay ${t.sameKeyReplay} | new create during fence ${t.newCreateDuringFence}`);
}
// pre-fence receipt replay: the creation committed BEFORE the fence, replayed with its key while the fence is up
for (const s of ST) {
  const rr = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: `ws-${s}1`, cwd_relative: 'project' } }, { key: KEYS[s] });
  const id = rr.json?.id ?? rr.json?.session_id;
  R[`preFenceReplay_${s}`] = `${rr.status} ${id === S[s].sessionId ? 'same id' : JSON.stringify(rr.json).slice(0, 80)}`;
  say(`   st-${s} pre-fence creation replayed during the fence: ${R[`preFenceReplay_${s}`]} | members now ${members(s)}`);
}
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s9-${TAG}.json`, JSON.stringify(R, null, 1));
say('S9-DONE');
