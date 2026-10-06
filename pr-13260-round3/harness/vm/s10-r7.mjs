// PR #13260 S10 (round 3, R7-1 witness): can a public create-session be admitted onto a storage whose W1c fence
// committed while the create was queued on the tenant placement lock? End to end on the packaged stack: Spring stays
// RUNNING (the admission surface the fence protects), MySQL 8.4 REPEATABLE READ, the shipped migration jar.
// Forced interleaving: connection X holds the tenant's placement-guard row (FOR UPDATE); `retire` queues on it; then the
// public create-session request runs its first consistent read and queues behind retire; X commits. With FIFO grant,
// retire's constructor installs the fence and commits, then the create proceeds to requireOpen().
// Outcome classes: FENCE-MISSED = create 2xx and the fence/migration row exist (R7-1); FENCE-HONOURED = create refused
// while the fence exists; CREATE-FIRST = the create took the lock first (retire then refuses the uninitialized member).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's10';
L.openLog(`s10-${TAG}`);
const { say } = L;
const SRC = '/srv/pr13260/src/a';
const R = { tag: TAG, jar: L.env().JAR };
say(L.hostFacts()); say(`   server jar=${L.env().JAR} (Spring stays running) | migration jar=${M.MIG_JAR}`);

await P.rollout(['a', 'b']);
L.seedWs('ws-a1', 'a');
const rig = await L.startRig(`s10-${TAG}`);
const U = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1'); await U.create(L.FILES);
for (const t of ['WRITE notes.txt v1', 'WRITE notes.txt v2']) say(`   U ${t}: ${P.term(await U.prompt(t))}`);
await U.detach(); await rig.h.stop(); say('   Harness stopped; Spring left RUNNING');
await W.waitLeasesExpired('a');
L.sh(`runuser -u w1crig -- touch ${W.historyRoot()}`); // N1 remedy
const m0 = L.mountRow('a');
const req = M.migrationRequest({ revision: m0.revision, source: SRC, target: '/srv/pr13260/dst/a', bundle: `/srv/pr13260/bundles/${TAG}` });
const file = M.writeRequest(req, TAG);
const key = L.one(`SELECT tenant_key FROM qwen_runtime_placement_guard WHERE tenant_id='${L.TENANT}'`);
const waiters = () => Number(L.one(`SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_NAME = 'qwen_runtime_placement_guard'`, { db: 'performance_schema' }));
const until = async (f, what, ms = 30000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`); await L.sleep(25); } return Date.now() - t0; };
const sessionsBefore = Number(L.one(`SELECT COUNT(*) FROM managed_agent_session WHERE tenant_id='${L.TENANT}'`));

say('== X holds the tenant placement-guard row');
const X = spawn('docker', ['exec', '-i', 'pr13260-mysql', 'mysql', '--unbuffered', '-uroot', '-prootpw', '-N', L.DB()], { stdio: ['pipe', 'pipe', 'ignore'] });
let xout = ''; X.stdout.on('data', (d) => { xout += d; });
X.stdin.write(`BEGIN; SELECT tenant_id FROM qwen_runtime_placement_guard WHERE tenant_key='${key}' FOR UPDATE; SELECT 'held';\n`);
await until(() => xout.includes('held'), 'X lock');
const pRetire = M.mig('retire', file, { label: `${TAG}-retire`, quiet: true });
R.retireQueuedAfterMs = await until(() => waiters() >= 1, 'retire queued');
const idem = randomUUID();
const pCreate = L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: 'ws-a1', cwd_relative: 'project' } }, { key: idem });
R.createQueuedAfterMs = await until(() => waiters() >= 2, 'create queued');
say(`   retire queued (${R.retireQueuedAfterMs} ms), then create-session queued (${R.createQueuedAfterMs} ms): ${waiters()} waiters on the placement guard`);
X.stdin.write('COMMIT;\n'); X.stdin.end();
const [rr, cr] = await Promise.all([pRetire, pCreate]);
const newId = cr.json?.id ?? cr.json?.session_id;
const mig = M.migRow(req.migrationOperationId); const fence = M.fenceRow('a');
const newRow = newId ? L.sql(`SELECT session_id, workspace_storage_id, status, created_at FROM managed_agent_session WHERE tenant_id='${L.TENANT}' AND session_id='${newId}'`)[0] : null;
R.create = { status: cr.status, body: JSON.stringify(cr.json).slice(0, 300), sessionId: newId ?? null, row: newRow ?? null };
R.retire = { exit: rr.code, out: M.migSummary(rr) };
R.after = { migration: mig ? `${mig.state}/${mig.error}` : 'none', fence: fence ? fence.slice(0, 8) : 'none', sessions: Number(L.one(`SELECT COUNT(*) FROM managed_agent_session WHERE tenant_id='${L.TENANT}'`)) - sessionsBefore };
R.outcome = cr.status < 300 && (fence || mig) ? 'FENCE-MISSED' : cr.status >= 400 && (fence || mig) ? 'FENCE-HONOURED' : cr.status < 300 && !mig ? 'CREATE-FIRST' : 'OTHER';
say(`   create-session: ${cr.status} ${R.create.body.slice(0, 160)}`);
say(`   new session row: ${newRow ? newRow.join(' ') : '<none>'}`);
say(`   retire: exit=${rr.code} ${R.retire.out} | migration row ${R.after.migration} | storage fence ${R.after.fence}`);
say(`   OUTCOME: ${R.outcome}`);

if (R.outcome === 'FENCE-MISSED') {
  say('== consequences of the admitted Session');
  const h = await new L.Harness({ name: `s10-${TAG}-h2`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
  const N = new L.HSession(h, newId, 'ws-a1'); const c = await N.create(L.FILES);
  R.newSessionCreate = `${c.status} ${JSON.stringify(c.json).slice(0, 200)}`;
  say(`   attach the admitted Session through the Harness: ${R.newSessionCreate}`);
  await h.stop();
  const r2 = await M.mig('retire', file, { label: `${TAG}-retire-again`, quiet: true });
  R.retireAgain = M.migSummary(r2);
  say(`   retire again: exit=${r2.code} ${R.retireAgain}`);
  say(`   members now: ${W.members('a').map((m) => `${m.id.slice(0, 8)}:${m.status}:head=${m.head}`).join(' ')}`);
}
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s10-${TAG}.json`, JSON.stringify(R, null, 1));
say('S10-DONE');
