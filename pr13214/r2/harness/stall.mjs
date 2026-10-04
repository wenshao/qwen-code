// S2: one execution's dispatch renewal parks in a real InnoDB row-lock wait
// (another transaction holds its row FOR UPDATE); does an unrelated binding's
// execution keep its dispatch lease? Production lease 30 s (renew every 10 s).
// usage: node stall.mjs <arm> <stalledCount 1|2> <lockSeconds>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { RIG, WT, SECRET, TOKEN, MYSQL, sql, scope, jdbc, startJava, broker, sleep } from './lib.mjs';

const [arm, stalledArg, lockArg] = process.argv.slice(2);
const stalled = Number(stalledArg ?? 1);
const lockSeconds = Number(lockArg ?? 45);
const healthySeconds = Number(process.argv[5] ?? lockSeconds + 5);
const tag = `stall-${arm}-s${stalled}${process.argv[6] ?? ''}`;
const db = `rig_stall_${arm}_s${stalled}${process.argv[6] ?? ''}`;
sql(null, `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
const harnesses = ['h1', 'h2', 'h3'];
const scopes = {};
for (const h of harnesses) {
  const ws = `${RIG}/ws/${tag}-${h}`;
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  scopes[h] = scope(ws, `workspace-${h}`);
}
const A = await startJava(arm, 'RigBroker', {
  jdbcUrl: jdbc(db), user: 'root', password: '', initSchema: true, secretKey: SECRET, token: TOKEN,
  httpPort: arm === 'head' ? 18241 : 18242, ownerId: `A-${arm}`, node: 'node', cli: `${WT[arm]}/dist/cli.js`,
  stateDir: `${RIG}/run/${tag}-A`, operationLeaseMillis: 30000, dispatchLeaseMillis: 30000,
  requestTimeoutMillis: 120000, scopes,
}, `${tag}-A`);
const call = broker(A.ready.baseUri);
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1);
for (const h of harnesses) {
  const w = await call('POST', '/runtimes:warm', { harnessSessionId: h });
  const a = await call('POST', '/tool-sessions:acquire', { harnessSessionId: h, runtimeSessionId: `rs-${h}`, turnKind: 'bootstrap' });
  if (w.status !== 200 || a.status !== 200) throw new Error(`setup ${h} ${w.status} ${a.status} ${JSON.stringify(a.body)}`);
}
async function create(h, callId, command) {
  const payload = { toolName: 'run_shell_command', input: { command, is_background: false } };
  const digest = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const r = await call('POST', '/executions', {
    idempotencyKey: `k-${callId}`, harnessSessionId: h, runtimeSessionId: `rs-${h}`, turnId: 'turn-1', toolCallId: callId,
    requestDigest: digest, reference: { sessionId: `rs-${h}`, promptId: 'turn-1', callId, argsDigest: digest, ...payload },
  });
  if (r.status !== 200) throw new Error(`create ${h} ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.executionCallId;
}
const stalledHarnesses = stalled === 2 ? ['h1', 'h3'] : stalled === 1 ? ['h1'] : [];
const ids = {};
const tStart = Date.now();
for (const h of stalledHarnesses) ids[h] = await create(h, `call-${h}`, 'perl -e "select(undef,undef,undef,150)"');
ids.h2 = await create('h2', 'call-h2', `perl -e "select(undef,undef,undef,${healthySeconds})"; echo ok >> healthy-marker`);
const execRow = (id) => sql(db, `SELECT execution_state, IFNULL(execution_status,'-'), dispatch_owner IS NOT NULL, TIMESTAMPDIFF(MICROSECOND, NOW(6), dispatch_lease_until) DIV 1000 FROM qwen_tool_execution WHERE execution_call_id='${id}'`);
for (let i = 0; i < 100; i++) {
  if (Object.values(ids).every((id) => execRow(id).startsWith('EXECUTING'))) break;
  await sleep(100);
}
if (!Object.values(ids).every((id) => execRow(id).startsWith('EXECUTING'))) throw new Error('not executing: ' + JSON.stringify(Object.values(ids).map(execRow)));
console.log(`[${at()}] all EXECUTING; stalling ${stalledHarnesses.join(',')} for ${lockSeconds}s`);
// lock by PRIMARY KEY only: a FOR UPDATE on the non-indexed execution_call_id would scan-lock every row
const inList = stalledHarnesses.map((h) => `'${sql(db, `SELECT execution_call_id_hash FROM qwen_tool_execution WHERE execution_call_id='${ids[h]}'`)}'`).join(',');
const locker = stalledHarnesses.length === 0 ? spawn('true') : spawn(MYSQL, ['-h127.0.0.1', '-P33214', '-uroot', db, '-e',
  `BEGIN; SELECT execution_call_id FROM qwen_tool_execution WHERE execution_call_id_hash IN (${inList}) FOR UPDATE; SELECT SLEEP(${lockSeconds}); COMMIT;`], { stdio: 'ignore' });
await sleep(800);
const lockedRows = sql(null, "SELECT COUNT(*) FROM performance_schema.data_locks WHERE OBJECT_SCHEMA='" + db + "' AND OBJECT_NAME='qwen_tool_execution' AND LOCK_TYPE='RECORD'");
console.log('record locks held by the stalling transaction:', lockedRows);
const timeline = [];
let jstack = null;
const deadline = Date.now() + (lockSeconds + 30) * 1000;
while (Date.now() < deadline) {
  const row = { t: Number(at()) };
  for (const [h, id] of Object.entries(ids)) row[h] = execRow(id);
  timeline.push(row);
  if (!jstack && Date.now() - tStart > (lockSeconds * 1000) / 2 + 5000) {
    jstack = execFileSync('/Users/wenshao/Install/jdk21/bin/jstack', [String(A.ready.pid)], { encoding: 'utf8' });
  }
  const healthy = row.h2.split('\t')[0];
  if (['SETTLED', 'UNKNOWN', 'ABANDONED'].includes(healthy) && Number(at()) > lockSeconds + 8) break;
  await sleep(1000);
}
locker.kill();
const threads = (jstack ?? '').split('\n\n').filter((b) => /qwen-runtime-broker-(lease-renewal|coordination)/.test(b))
  .map((b) => b.split('\n').slice(0, 14).join('\n'));
const marker = fs.existsSync(`${scopes.h2.canonicalCwd}/healthy-marker`) ? fs.readFileSync(`${scopes.h2.canonicalCwd}/healthy-marker`, 'utf8').trim() : null;
const final = Object.fromEntries(Object.entries(ids).map(([h, id]) => [h, execRow(id)]));
const summary = { arm, stalled: stalledHarnesses, lockedRows, lockSeconds, leaseSeconds: 30, final, healthyShellMarker: marker, timeline, threads };
fs.mkdirSync(`${RIG}/results`, { recursive: true });
fs.writeFileSync(`${RIG}/results/${tag}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ arm, stalled: stalledHarnesses, final, healthyShellMarker: marker }, null, 2));
console.log(threads.join('\n---\n'));
A.child.kill('SIGTERM');
await sleep(7000);
process.exit(0);
