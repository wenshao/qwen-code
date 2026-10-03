// S3: UNKNOWN-execution polling through the shipped TS Broker client vs the new cooldown.
// The worker's execute response is dropped (real loss), the shell keeps running, and the
// client polls. Counts worker /status calls seen by the in-process proxy.
// usage: node poll.mjs <arm>
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { RIG, WT, SECRET, TOKEN, sql, scope, jdbc, startJava, broker, sleep } from './lib.mjs';

const arm = process.argv[2];
const tag = `poll-${arm}`;
const db = `rig_poll_${arm}`;
const ws = `${RIG}/ws/${tag}`;
fs.mkdirSync(ws, { recursive: true });
sql(null, `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
const A = await startJava(arm, 'RigBroker', {
  jdbcUrl: jdbc(db), user: 'root', password: '', initSchema: true, secretKey: SECRET, token: TOKEN,
  httpPort: arm === 'head' ? 18251 : 18252, ownerId: `A-${arm}`, node: 'node', cli: `${WT[arm]}/dist/cli.js`,
  stateDir: `${RIG}/run/${tag}-A`, operationLeaseMillis: 30000, dispatchLeaseMillis: 30000,
  requestTimeoutMillis: 10000, scopes: { h1: scope(ws) },
}, `${tag}-A`);
const call = broker(A.ready.baseUri);
process.on('uncaughtException', (e) => { console.error(e); A.child.kill('SIGKILL'); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); A.child.kill('SIGKILL'); process.exit(1); });
await call('POST', '/runtimes:warm', { harnessSessionId: 'h1' });
const out = {};
async function runClient(rs, waitForUnknown, observationMs) {
  const a = await call('POST', '/tool-sessions:acquire', { harnessSessionId: 'h1', runtimeSessionId: rs, turnKind: 'bootstrap' });
  if (a.status !== 200) throw new Error('acquire ' + JSON.stringify(a.body));
  await A.command({ op: 'drop', name: 'execute' });
  const before = (await A.command({ op: 'counts' })).counts;
  const child = spawn('/Users/wenshao/git/qwen-code-x9/node_modules/.bin/tsx',
    [`${RIG}/poll-client.mts`, A.ready.baseUri, TOKEN, 'h1', rs, 'perl -e "select(undef,undef,undef,60)"', String(waitForUnknown), String(observationMs)],
    { cwd: '/Users/wenshao/git/qwen-code-x9', stdio: ['ignore', 'pipe', 'inherit'] });
  let text = '';
  child.stdout.on('data', (d) => { text += d; });
  await new Promise((r) => child.on('exit', r));
  const after = (await A.command({ op: 'counts' })).counts;
  const lines = text.trim().split('\n').map((l) => JSON.parse(l));
  const done = lines.find((l) => l.phase === 'done');
  const delta = Object.fromEntries(Object.keys(after).map((k) => [k, (after[k] ?? 0) - (before[k] ?? 0)]).filter(([, v]) => v));
  const state = sql(db, `SELECT execution_state FROM qwen_tool_execution WHERE execution_call_id='${done.id}'`);
  return { waitForUnknown, observationMs, elapsedMs: done.elapsedMs, outcome: done.outcome, clientRequests: done.requests, workerCalls: delta, recordState: state };
}
out.mcpSession = await runClient('rs-mcp', true, 20000);
console.log(JSON.stringify(out.mcpSession));
out.plainSession = await runClient('rs-plain', false, 20000);
console.log(JSON.stringify(out.plainSession));
// The automatic-observation path itself (plain GET on the same v2 UNKNOWN record), 20 rapid polls.
const id = sql(db, "SELECT execution_call_id FROM qwen_tool_execution WHERE runtime_session_id='rs-plain'");
const before = (await A.command({ op: 'counts' })).counts;
for (let i = 0; i < 20; i++) await call('GET', `/executions/${id}?requestId=p${i}&harnessSessionId=h1&runtimeSessionId=rs-plain`);
const after = (await A.command({ op: 'counts' })).counts;
out.rapidPlainGets = { gets: 20, workerStatusCalls: (after.status ?? 0) - (before.status ?? 0) };
console.log(JSON.stringify(out.rapidPlainGets));
fs.writeFileSync(`${RIG}/results/${tag}.json`, JSON.stringify(out, null, 2));
A.child.kill('SIGTERM');
await sleep(7000);
process.exit(0);
