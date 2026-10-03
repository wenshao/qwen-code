// S5b: Broker JVM exit without close() (library embedding; only JVM shutdown hooks run).
// usage: node libexit.mjs <arm> <healthy|handshake>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { RIG, WT, SECRET, TOKEN, sql, scope, jdbc, startJava, broker, sleep } from './lib.mjs';

const [arm, kase] = process.argv.slice(2);
const tag = `libexit-${arm}-${kase}`;
const db = `rig_libexit_${arm}_${kase}`;
const ws = `${RIG}/ws/${tag}`;
fs.mkdirSync(ws, { recursive: true });
sql(null, `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
const wrapper = `${RIG}/slow-node.sh`;
fs.writeFileSync(wrapper, `#!/bin/bash\ntrap '' TERM\nsleep 20\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
const A = await startJava(arm, 'RigBroker', {
  jdbcUrl: jdbc(db), user: 'root', password: '', initSchema: true, secretKey: SECRET, token: TOKEN,
  httpPort: { head: 18271, base: 18272, cand: 18273 }[arm], ownerId: `A-${arm}`,
  node: kase === 'handshake' ? wrapper : 'node', cli: `${WT[arm]}/dist/cli.js`,
  stateDir: `${RIG}/run/${tag}-A`, operationLeaseMillis: 30000, dispatchLeaseMillis: 30000,
  requestTimeoutMillis: 10000, scopes: { h1: scope(ws) },
}, `${tag}-A`);
const call = broker(A.ready.baseUri);
const warm = call('POST', '/runtimes:warm', { harnessSessionId: 'h1' }).catch((e) => ({ error: String(e) }));
if (kase === 'healthy') await warm; else await sleep(2000);
const workers = (await A.command({ op: 'workers' })).workers;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const t0 = Date.now();
const jvmPid = A.child.pid;
const trace = [];
A.child.on('exit', (c, sg) => trace.push({ t: Date.now() - t0, jvmExit: c ?? sg }));
A.child.kill('SIGTERM');
let gone = null;
for (let i = 0; i < 120 && gone === null; i++) {
  if (workers.every((p) => !alive(p))) gone = Date.now() - t0;
  else await sleep(100);
}
const out = { arm, kase, workers, goneAfterMs: gone, trace };
if (gone === null) {
  await sleep(kase === 'handshake' ? 22000 : 1000);
  out.later = workers.map((p) => (alive(p) ? execFileSync('ps', ['-o', 'ppid=,stat=,command=', '-p', String(p)], { encoding: 'utf8' }).trim().slice(0, 120) : 'gone'));
  for (const p of workers) { try { process.kill(p, 'SIGKILL'); } catch {} }
}
fs.writeFileSync(`${RIG}/results/${tag}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
process.exit(0);
