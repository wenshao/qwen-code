// PR #12868 round 6: a repeated cancellation after the Broker process was
// replaced (commit 5c0c9bf323 answers 503 runtime_reconciliation_required and
// asks the caller to acquire again).
// The Broker is stopped and started again on the same database and state
// directory, between the first cancellation of a prepared provider call and
// the second. Then the caller does what the answer asks for.
// usage: ARM=.. TAG=<pid tag> STOP=<TERM|KILL> DB=.. ports.. ROOTS=.. STORAGES=".." JAR_ARM=.. WORKER_ARM=.. node s19-restart.mjs <mode v1|v2> <storage letter>
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  RIG, ROOTS, BROKER_URL, BROKER_TOKEN, ARM, DB, HTTP_PORT, BROKER_PORT, PROXY_PORT, attempt, brief, broker, check, createSession, executions,
  holders, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry, sleep, sql, summary, workerPids, workerPortOf,
} from './lib.mjs';

const mode = process.argv[2] ?? 'v1';
const letter = process.argv[3] ?? 'a';
const TAG = process.env.TAG ?? 'kill';
const STOP = process.env.STOP ?? 'KILL';
openLog(`s19-restart-${ARM}-${mode}-${STOP}`);
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const full = (r) => `${answer(r)}${r.status === 200 ? ` ${r.json?.status?.result?.executionStatus ?? ''}` : ` retryable=${r.json?.retryable} "${String(r.json?.error).slice(0, 110)}"`}`;
const held = (id) => holders().some(([, h]) => h === id);
const tag = `Y-${mode}`;

const where = mode === 'v1'
  ? { harness: await createSession(), cwd: fs.realpathSync(path.join(ROOTS, 'plain')) }
  : await (async () => { const ws = `ws-${letter}-${Date.now()}`; seedRegistry(ws, `st-${letter}`); return { harness: await createSession(ws), cwd: fs.realpathSync(path.join(ROOTS, letter, 'child')) }; })();
const { BrokerManagedRuntimeProvider } = await loadProvider();
const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
const runtimeSessionId = randomUUID();
const request = prepareRequest(runtimeSessionId, 'bootstrap', where.cwd);
const client = await provider.getToolV2Client(request, { harnessSessionId: where.harness });
await client.fileHistory.bind({ ownerSessionId: where.harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: where.cwd, snapshots: [] });
const manifest = await client.manifest();
const identity = (callId) => ({ sessionId: runtimeSessionId, promptId: 'p1', callId, capabilityDigest: manifest.capabilityDigest, policyRevision: manifest.policyRevision });
await client.beginTurn(identity('turn'));
const base = { protocolVersion: 1, harnessSessionId: where.harness, runtimeSessionId };
const file = path.join(where.cwd, `y-${runtimeSessionId.slice(0, 6)}.txt`);
const prepared = await client.prepare(identity('y'), 'write_file', { file_path: file, content: 'never\n' });
const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const reserved = await client.prepareExecution(reference);
const port = workerPortOf(runtimeSessionId);
const cancel = () => broker('POST', `executions/${reserved.executionCallId}:cancel`, { ...base, requestId: randomUUID() });
const get = () => broker('GET', `executions/${reserved.executionCallId}?requestId=${randomUUID()}&harnessSessionId=${where.harness}&runtimeSessionId=${runtimeSessionId}`);
// The rig's usual request deadline is 120 s, which is also how long the
// Broker may take to give up on an adoption: this one waits longer.
const acquire = async () => {
  const started = Date.now();
  const r = await fetch(`${BROKER_URL}/internal/runtime-broker/v1/tool-sessions:acquire`, { method: 'POST', headers: { authorization: `Bearer ${BROKER_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...base, requestId: randomUUID(), turnKind: 'bootstrap' }), signal: AbortSignal.timeout(300_000) });
  const json = await r.json().catch(() => undefined);
  return { status: r.status, code: json?.code, json, seconds: ((Date.now() - started) / 1000).toFixed(1) };
};
const bindingOf = () => {
  const row = sql(`SELECT b.binding_state, b.runtime_generation FROM qwen_runtime_binding b JOIN qwen_runtime_session s ON s.binding_id=b.binding_id WHERE s.runtime_session_id='${runtimeSessionId}'`)[0];
  return row ? `${row[0]}/gen${row[1]}` : 'none';
};
const state = () => `Session ${runtimeSession(runtimeSessionId)?.state} | binding ${bindingOf()}`;
const pidOn = (p) => {
  try {
    return Number(execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]);
  } catch {
    return 0;
  }
};

const first = await cancel();
say(tag, `prepared call reserved | cancel #1 ${full(first)} | ${state()} | record ${executions(runtimeSessionId).map((r) => `${r.state}/${r.status}`)}`);

// Replace the Broker process.
const pid = Number(fs.readFileSync(path.join(RIG, 'run', `spring-${TAG}.pid`), 'utf8').trim());
process.kill(pid, STOP === 'KILL' ? 'SIGKILL' : 'SIGTERM');
for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); await sleep(200); } catch { break; } }
const workerAlive = pidOn(port) > 0;
execFileSync(path.join(RIG, 'restart-spring.sh'), [TAG, DB, String(HTTP_PORT), String(BROKER_PORT), String(PROXY_PORT)], { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
say(tag, `Broker process stopped with SIG${STOP} and started again on the same database | the Session's worker survived the stop: ${workerAlive} | ${state()}`);

// 1. What the repeated cancellation answers now.
let mark = ledgerMark();
const second = await cancel();
const got = await get();
say(tag, `cancel #2 ${full(second)} | GET ${answer(got)} ${got.json?.status?.state ?? ''}/${got.json?.status?.result?.executionStatus ?? ''} | worker saw [${ledger(mark).map((e) => e.kind ?? e.path.replace('/internal/managed-runtime', ''))}]`);

// 2. The caller does what the answer asks for: acquire again, then cancel.
const tries = [];
for (let i = 0; i < 1; i++) {
  mark = ledgerMark();
  const a = await acquire();
  const c = await cancel();
  const seen = ledger(mark).map((e) => `${e.kind ?? e.path.replace('/internal/managed-runtime', '')} ${e.status}`);
  tries.push({ a, c });
  say(tag, `acquire again: answered after ${a.seconds} s with ${answer(a)}${a.status === 200 ? '' : ` retryable=${a.json?.retryable} "${String(a.json?.error).slice(0, 100)}"`} | cancel ${full(c)} | ${state()} | worker saw [${seen}]`);
  if (c.status === 200) break;
}

// 3. If that did not settle it: the worker goes away for good.
let lost;
const lastTry = tries[tries.length - 1];
if (lastTry.c.status !== 200) {
  const orphan = pidOn(port);
  if (orphan > 0) process.kill(orphan, 'SIGKILL');
  await sleep(1500);
  const after = [];
  for (let i = 0; i < 1; i++) {
    const a = await acquire();
    const c = await cancel();
    after.push({ a, c });
    say(tag, `worker ${orphan > 0 ? 'killed' : 'already gone'} | acquire again: answered after ${a.seconds} s with ${answer(a)}${a.status === 200 ? '' : ` retryable=${a.json?.retryable} "${String(a.json?.error).slice(0, 80)}"`} | cancel ${full(c)} | ${state()}`);
    if (c.status === 200) break;
  }
  lost = after[after.length - 1];
}

const late = await broker('POST', `executions/${reserved.executionCallId}:start`, { ...base, requestId: randomUUID() });
const release = await broker('POST', `tool-sessions/${runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
await sleep(1000);
say(tag, `start of the cancelled call ${answer(late)}${late.status === 200 ? ` ${late.json?.status?.result?.executionStatus}` : ''} | file written=${fs.existsSync(file)} | release ${answer(release)}${release.status === 200 ? '' : ` "${String(release.json?.error).slice(0, 90)}"`} | ${state()}${mode === 'v2' ? ` | storage held=${held(runtimeSessionId)}` : ''}`);
const settled = lastTry.c.status === 200 ? 'after acquiring again' : lost?.c.status === 200 ? 'only after the worker was gone' : 'never';
say(tag, `OBSERVED: the repeated cancellation was confirmed ${settled}`);
check(`${tag}.1`, 'after the Broker was replaced, the repeated cancellation is not a definite 404', second.status !== 404, full(second));
check(`${tag}.2`, 'it asks for adoption with a retryable 503 runtime_reconciliation_required', second.status === 503 && second.json?.code === 'runtime_reconciliation_required' && second.json?.retryable === true, full(second));
check(`${tag}.3`, 'acquiring again, as the answer asks, lets the cancellation be confirmed', lastTry.c.status === 200 && lastTry.c.json?.status?.result?.executionStatus === 'cancelled', `${tries.map((t) => `acquire ${answer(t.a)} after ${t.a.seconds} s / cancel ${answer(t.c)}`).join(' | ')}`);
check(`${tag}.5`, 'failing that, the cancellation is confirmed once the worker is gone', lastTry.c.status === 200 || lost?.c.status === 200, lost ? `acquire ${answer(lost.a)} after ${lost.a.seconds} s / cancel ${answer(lost.c)}` : 'not needed');
check(`${tag}.4`, 'the receipt is readable and the cancelled call never executes', got.status === 200 && !fs.existsSync(file));
const ok = summary();
provider.dispose();
process.exit(ok ? 0 : 1);
