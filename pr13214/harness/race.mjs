// S1: cross-process release vs admission race on real MySQL.
// Broker A (own JVM): production service + HTTP face + real bundled worker.
// Broker B (own JVM): production admission transaction on the same database.
// usage: node race.mjs <arm> <rounds> <dbLatencyMsForA> <maxJitterMs>
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { RIG, WT, SECRET, TOKEN, sql, scope, jdbc, startJava, broker, post, sleep } from './lib.mjs';

const [arm, roundsArg, latencyArg, jitterArg] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 100);
const latency = Number(latencyArg ?? 0);
const maxJitter = Number(jitterArg ?? 40);
const tag = `race-${arm}-l${latency}`;
const db = `rig_race_${arm}_l${latency}`;
const ws = `${RIG}/ws/${tag}`;
fs.mkdirSync(ws, { recursive: true });
sql(null, `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
const ports = { head: { a: 18214, b: 18215, p: 18216 }, base: { a: 18224, b: 18225, p: 18226 }, cand: { a: 18234, b: 18235, p: 18236 } }[arm];
let proxy;
if (latency > 0) {
  proxy = spawn('node', [`${RIG}/latency-proxy.mjs`, String(ports.p), '33214', String(latency)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => proxy.stdout.once('data', r));
}
const sc = scope(ws);
const A = await startJava(arm, 'RigBroker', {
  jdbcUrl: jdbc(db, latency > 0 ? ports.p : 33214), user: 'root', password: '', initSchema: true,
  secretKey: SECRET, token: TOKEN, httpPort: ports.a, ownerId: `A-${arm}`,
  node: 'node', cli: `${WT[arm]}/dist/cli.js`, stateDir: `${RIG}/run/${tag}-A`,
  operationLeaseMillis: 30000, dispatchLeaseMillis: 30000, requestTimeoutMillis: 10000,
  scopes: { h1: sc },
}, `${tag}-A`);
const B = await startJava(arm, 'RigAdmitter', {
  jdbcUrl: jdbc(db), user: 'root', password: '', secretKey: SECRET, httpPort: ports.b, scope: sc,
}, `${tag}-B`);
const call = broker(A.ready.baseUri);
const warm = await call('POST', '/runtimes:warm', { harnessSessionId: 'h1' });
if (warm.status !== 200) throw new Error('warm failed ' + JSON.stringify(warm));
const tally = {};
const samples = [];
let contradictions = 0;
for (let i = 0; i < rounds; i++) {
  const sid = `rs-${i}`;
  const acq = await call('POST', '/tool-sessions:acquire', { harnessSessionId: 'h1', runtimeSessionId: sid, turnKind: 'bootstrap' });
  if (acq.status !== 200) throw new Error('acquire failed ' + JSON.stringify(acq));
  const bindingId = acq.body.runtime.bindingId;
  const generation = Number(acq.body.runtime.generation);
  const jitter = Math.random() * maxJitter;
  const releaseP = call('POST', `/tool-sessions/${sid}:release`, { harnessSessionId: 'h1' });
  const admitP = sleep(jitter).then(() =>
    post(`http://127.0.0.1:${ports.b}/admit`, { harness: 'h1', runtimeSession: sid, callId: `call-${i}`, bindingId, generation }));
  const [rel, adm] = await Promise.all([releaseP, admitP]);
  const after = await post(`http://127.0.0.1:${ports.b}/inspect`, { runtimeSession: sid, bindingId, generation });
  const relKey = rel.status === 200 ? `release:200 released=${rel.body.released}` : `release:${rel.status} ${rel.body?.error?.code ?? rel.body?.code ?? JSON.stringify(rel.body).slice(0, 80)}`;
  const admKey = adm.ok ? 'admit:ok' : `admit:${adm.code}`;
  const contradiction = adm.ok && ['RELEASING', 'RELEASED'].includes(after.sessionState) && after.hasActive;
  if (contradiction) contradictions++;
  const key = `${relKey} | ${admKey} | session=${after.sessionState} active=${after.hasActive}`;
  tally[key] = (tally[key] ?? 0) + 1;
  if (contradiction && samples.length < 5) samples.push({ round: i, sid, jitter: +jitter.toFixed(1), releaseMs: +rel.ms.toFixed(1), rel: rel.body, adm, after });
}
const counts = await A.command({ op: 'counts' });
const summary = { arm, rounds, latencyMs: latency, maxJitterMs: maxJitter, contradictions, tally, workerCalls: counts.counts, samples };
fs.mkdirSync(`${RIG}/results`, { recursive: true });
fs.writeFileSync(`${RIG}/results/${tag}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
A.child.kill('SIGTERM');
B.child.kill('SIGTERM');
proxy?.kill('SIGTERM');
await sleep(1500);
process.exit(0);
