// R3-1: a Session row already RELEASING with an active execution on it
// (the row a pre-fix / old-version peer's check-then-act race leaves behind),
// then a release retry reaches this Broker. Real MySQL + real worker + HTTP face.
// usage: node r31.mjs <arm>
import fs from 'node:fs';
import { RIG, WT, SECRET, TOKEN, sql, scope, jdbc, startJava, broker, sleep } from './lib.mjs';

const arm = process.argv[2];
const noexec = process.argv[3] === 'noexec';
const tag = `r31-${arm}${noexec ? '-noexec' : ''}`;
const db = `rig_r31_${arm}${noexec ? '_noexec' : ''}`;
const ws = `${RIG}/ws/${tag}`;
fs.mkdirSync(ws, { recursive: true });
sql(null, `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
const A = await startJava(arm, 'RigBroker', {
  jdbcUrl: jdbc(db), user: 'root', password: '', initSchema: true, secretKey: SECRET, token: TOKEN,
  httpPort: { head: 18231, base: 18232, cand: 18233 }[arm], ownerId: `A-${arm}`, node: 'node', cli: `${WT[arm]}/dist/cli.js`,
  stateDir: `${RIG}/run/${tag}-A`, operationLeaseMillis: 30000, dispatchLeaseMillis: 30000,
  requestTimeoutMillis: 10000, scopes: { h1: scope(ws) },
}, `${tag}-A`);
const call = broker(A.ready.baseUri);
const log = [];
const step = (name, value) => {
  log.push({ step: name, value });
  console.log(name, JSON.stringify(value));
};
step('warm', (await call('POST', '/runtimes:warm', { harnessSessionId: 'h1' })).status);
const acq = await call('POST', '/tool-sessions:acquire', { harnessSessionId: 'h1', runtimeSessionId: 'rs-1', turnKind: 'bootstrap' });
step('acquire', { status: acq.status, runtime: acq.body.runtime });
const digest = 'sha256:' + 'c'.repeat(64);
const prep = noexec ? { status: 0, body: {} } : await call('POST', '/executions:prepare', {
  idempotencyKey: 'k-1', harnessSessionId: 'h1', runtimeSessionId: 'rs-1', turnId: 'turn-1', toolCallId: 'call-1',
  requestDigest: digest, reference: { sessionId: 'rs-1', promptId: 'turn-1', callId: 'call-1', argsDigest: digest },
});
step('prepare', { status: prep.status, executionCallId: prep.body.executionCallId, state: prep.body.status?.state });
const q = (s) => sql(db, s);
const rowSql = "SELECT session_state, record_version FROM qwen_runtime_session WHERE runtime_session_id='rs-1'";
const execSql = "SELECT execution_state FROM qwen_tool_execution WHERE runtime_session_id='rs-1'";
step('before.session', q(rowSql));
step('before.execution', q(execSql));
// The persisted state R3-1 names: session RELEASING while an execution on it is still active.
q("UPDATE qwen_runtime_session SET session_state='RELEASING', record_version=record_version+1 WHERE runtime_session_id='rs-1'");
step('forged.session', q(rowSql));
const before = (await A.command({ op: 'counts' })).counts;
const rel = await call('POST', '/tool-sessions/rs-1:release', { harnessSessionId: 'h1' });
step('release', { status: rel.status, body: rel.body });
await sleep(500);
const after = (await A.command({ op: 'counts' })).counts;
step('after.session', q(rowSql));
step('after.execution', q(execSql));
step('worker.control.calls.during.release', (after.control ?? 0) - (before.control ?? 0));
const get = noexec ? { status: 0, body: null } : await call('GET', `/executions/${prep.body.executionCallId}?requestId=g1&harnessSessionId=h1&runtimeSessionId=rs-1`);
step('get.execution', { status: get.status, body: get.body });
fs.mkdirSync(`${RIG}/results`, { recursive: true });
fs.writeFileSync(`${RIG}/results/${tag}.json`, JSON.stringify(log, null, 2));
A.child.kill('SIGTERM');
await sleep(1500);
process.exit(0);
