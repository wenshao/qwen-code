// S6: LOST reclaim of a generation holding more sessions than the bounded
// 100-row recovery passes. Production durable store + trusted reboot recovery:
// Broker #1 acquires N sessions on one real worker, then Broker #1 and the worker
// are SIGKILLed together (power loss); Broker #2 comes up on a new boot ID over the
// same state directory and the Harness warms again.
// usage: node lost.mjs <arm> <sessions>
import fs from 'node:fs';
import { RIG, WT, SECRET, TOKEN, sql, scope, jdbc, startJava, broker, sleep } from './lib.mjs';

const [arm, nArg] = process.argv.slice(2);
const n = Number(nArg ?? 303);
const tag = `lost-${arm}-${n}`;
const db = `rig_lost_${arm}_${n}`;
const ws = `${RIG}/ws/${tag}`;
const stateDir = `${RIG}/run/${tag}-state`;
fs.rmSync(stateDir, { recursive: true, force: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(ws, { recursive: true });
sql(null, `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
const port = { head: 18261, base: 18262, cand: 18263 }[arm];
const config = (owner, bootId, initSchema) => ({
  jdbcUrl: jdbc(db), user: 'root', password: '', initSchema, secretKey: SECRET, token: TOKEN,
  httpPort: port, ownerId: owner, node: 'node', cli: `${WT[arm]}/dist/cli.js`, stateDir,
  durable: true, trustedReboot: true, bootId,
  operationLeaseMillis: 30000, dispatchLeaseMillis: 30000, requestTimeoutMillis: 10000, scopes: { h1: scope(ws) },
});
const census = () => sql(db, "SELECT CONCAT(b.runtime_generation, ':', s.session_state, '=', COUNT(*)) FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id = s.binding_id GROUP BY b.runtime_generation, s.session_state ORDER BY 1").split('\n').join(' ');
const bindings = () => sql(db, "SELECT CONCAT(runtime_generation, ':', binding_state, IF(stop_evidence_json IS NULL, '', CONCAT('(stop=', JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.source')), ')'))) FROM qwen_runtime_binding ORDER BY runtime_generation").split('\n').join(' ');

const A1 = await startJava(arm, 'RigBroker', config(`A1-${arm}`, '11111111-1111-1111-1111-111111111111', true), `${tag}-A1`);
let call = broker(A1.ready.baseUri);
const w0 = await call('POST', '/runtimes:warm', { harnessSessionId: 'h1' });
if (w0.status !== 200) throw new Error('warm ' + JSON.stringify(w0.body));
for (let i = 0; i < n; i += 8) {
  await Promise.all(Array.from({ length: Math.min(8, n - i) }, (_, k) =>
    call('POST', '/tool-sessions:acquire', { harnessSessionId: 'h1', runtimeSessionId: `rs-${i + k}`, turnKind: 'bootstrap' })
      .then((r) => { if (r.status !== 200) throw new Error('acquire ' + JSON.stringify(r.body)); })));
}
const out = { arm, sessions: n, before: { sessions: census(), bindings: bindings() }, warms: [] };
const workers = (await A1.command({ op: 'workers' })).workers;
A1.child.kill('SIGKILL');
for (const pid of workers) { try { process.kill(pid, 'SIGKILL'); } catch {} }
out.powerLoss = { broker: A1.child.pid, workers };
await sleep(1000);
const A2 = await startJava(arm, 'RigBroker', config(`A2-${arm}`, '22222222-2222-2222-2222-222222222222', false), `${tag}-A2`);
call = broker(A2.ready.baseUri);
for (let i = 0; i < 8; i++) {
  const w = await call('POST', '/runtimes:warm', { harnessSessionId: 'h1' });
  out.warms.push({ attempt: i + 1, status: w.status, code: w.body?.code ?? (w.body?.ready ? 'ready' : null), ms: Math.round(w.ms), sessions: census(), bindings: bindings() });
  console.log(JSON.stringify(out.warms.at(-1)));
  if (w.status === 200) break;
  await sleep(1000);
}
fs.writeFileSync(`${RIG}/results/${tag}.json`, JSON.stringify(out, null, 2));
const left = (await A2.command({ op: 'workers' })).workers;
A2.child.kill('SIGKILL');
for (const pid of left) { try { process.kill(pid, 'SIGKILL'); } catch {} }
process.exit(0);
