// Deployment skew: the PR server pointed at a pre-PR CLI bundle (no activation
// route). The design says old workers refuse, so acquisition fails before any
// execute. Question: what happens to the storage holder?
import * as L from './lib.mjs';
import fs from 'node:fs';

const db = 'rig_stale';
const A = `${L.RIG}/roots/stale-a`;
fs.rmSync(A, { recursive: true, force: true });
fs.mkdirSync(A, { recursive: true });
L.openLog(`s4-stale-worker-${process.argv[2] ?? 'stale'}`);
const say = (t, s) => L.say(t, String(s).replaceAll(A, '<rootA>'));
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}
const mounts = [
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${A}`,
];
const J = { http: 18791, broker: 19791, name: 'stale-jvm' };
const staleArm = process.argv[2] ?? 'stale';
L.startServer(staleArm, J.name, J.http, J.broker, db, mounts);
await L.waitHealth(J.http);
say('setup', 'PR server jar + worker entry = base CLI bundle 5e443797 (no /internal/managed-runtime/v3/activation)');
L.seedRegistry(db, 't-alpha', 'ws-a', 'st-a', { actors: ['alice', 'bob'] });
const alice = (await L.createSession(J.http, 't-alpha', 'alice', 'ws-a', '.')).json.id;
const bob = (await L.createSession(J.http, 't-alpha', 'bob', 'ws-a', '.')).json.id;
say('A', `alice acquire a-rt1: ${L.brief(await L.acquire(J.broker, alice, 'a-rt1'))}`);
say('A', `holders: ${JSON.stringify(L.holders(db))}`);
say('A', `bob acquire b-rt1: ${L.brief(await L.acquire(J.broker, bob, 'b-rt1'))}`);
say('A', `alice release a-rt1: ${L.brief(await L.release(J.broker, alice, 'a-rt1'))}`);

if (process.argv[3] === 'A-only') { L.stopServer(J.name); await L.sleep(5000); process.exit(0); }
say('B', '--- operator fixes the worker entry and restarts ---');
L.stopServer(J.name);
await L.sleep(6000);
L.startServer('pr', J.name, J.http, J.broker, db, mounts);
await L.waitHealth(J.http);
const t0 = Date.now();
let r;
for (let i = 0; i < 40; i++) {
  r = await L.acquire(J.broker, bob, 'b-rt2');
  if (r.json?.code !== 'runtime_broker_reconcile_timeout') break;
  await L.sleep(3000);
}
say('B', `bob acquire b-rt2 after restart (${Math.round((Date.now() - t0) / 1000)} s): ${L.brief(r)}`);
for (let i = 0; i < 40; i++) {
  r = await L.acquire(J.broker, alice, 'a-rt1');
  if (r.json?.code !== 'runtime_broker_reconcile_timeout') break;
  await L.sleep(3000);
}
say('B', `alice retries the same id a-rt1 on the fixed worker: ${L.brief(r)}`);
say('B', `alice release a-rt1: ${L.brief(await L.release(J.broker, alice, 'a-rt1'))}`);
say('B', `holders: ${JSON.stringify(L.holders(db))}`);
say('B', `bob acquire b-rt3: ${L.brief(await L.acquire(J.broker, bob, 'b-rt3'))}`);
say('B', `launches: ${L.launches(J.name).join(' | ').replaceAll(process.env.HOME, '~')}`);
L.stopServer(J.name);
await L.sleep(5000);
