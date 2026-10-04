// R2: the release grace window (56c209634b). A real worker that ignores SIGTERM
// (preload drops SIGTERM listeners) is released by the Broker because its
// attestation reply is lost (the proxy drops it -> releaseQuietly -> stop()).
// mode 'stay': the Broker keeps running; mode 'exit': the Broker JVM gets SIGTERM
// right after the release, inside the 5 s grace window.
// usage: node grace.mjs <arm> <stay|exit>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { RIG, WT, SECRET, TOKEN, sql, scope, jdbc, startJava, broker, sleep } from './lib.mjs';

const [arm, mode] = process.argv.slice(2);
const tag = `grace-${arm}-${mode}`;
const db = `rig_grace_${arm}_${mode}`;
const ws = `${RIG}/ws/${tag}`;
fs.mkdirSync(ws, { recursive: true });
sql(null, `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
const A = await startJava(arm, 'RigBroker', {
  jdbcUrl: jdbc(db), user: 'root', password: '', initSchema: true, secretKey: SECRET, token: TOKEN,
  httpPort: { head: 18281, base: 18282, r1head: 18283 }[arm], ownerId: `A-${arm}`,
  node: `${RIG}/node-ignore-term.sh`, cli: `${WT[arm === 'r1head' ? 'head' : arm]}/dist/cli.js`,
  stateDir: `${RIG}/run/${tag}-A`, operationLeaseMillis: 30000, dispatchLeaseMillis: 30000,
  requestTimeoutMillis: 10000, scopes: { h1: scope(ws) },
}, `${tag}-A`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const stat = (pid) => { try { return execFileSync('ps', ['-o', 'ppid=,stat=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return 'gone'; } };
try {
  await A.command({ op: 'fault', name: 'attest', action: 'PASS' });
  await A.command({ op: 'fault', name: 'attest', action: 'DROP' });
  const call = broker(A.ready.baseUri);
  const warm = await call('POST', '/runtimes:warm', { harnessSessionId: 'h1' });
  const t0 = Date.now();
  const workers = (await A.command({ op: 'workers' })).workers;
  const out = { arm, mode, warm: { status: warm.status, code: warm.body?.code }, workers, samples: [] };
  if (mode === 'exit') A.child.kill('SIGTERM');
  for (let i = 0; i <= 90; i++) {
    const t = Date.now() - t0;
    if (i % 10 === 0 || workers.every((p) => !alive(p))) out.samples.push({ ms: t, workers: workers.map(stat) });
    if (workers.every((p) => !alive(p))) { out.goneAfterMs = t; break; }
    await sleep(100);
  }
  out.survived = workers.filter(alive);
  for (const p of out.survived) { try { process.kill(p, 'SIGKILL'); } catch {} }
  fs.writeFileSync(`${RIG}/results/${tag}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ arm, mode, warm: out.warm, workers, goneAfterMs: out.goneAfterMs ?? null, survived9s: out.survived.length }));
} finally {
  A.child.kill('SIGKILL');
}
process.exit(0);
