// PR #12868 round 5: a terminal cancellation receipt after the Broker process
// was replaced (commit 803761aabd). The Broker is stopped and started again on
// the same database and state directory, between the first cancellation of a
// prepared provider call and the second.
// usage: ARM=<pr|r4> TAG=<pid tag> STOP=<TERM|KILL> DB=.. ports.. ROOTS=.. STORAGES=".." node s17-restart.mjs <mode v1|v2> <storage letter>
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  RIG, ROOTS, BROKER_URL, BROKER_TOKEN, ARM, DB, HTTP_PORT, BROKER_PORT, PROXY_PORT, attempt, brief, broker, check, createSession, executions,
  holders, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry, sleep, sql, summary, workerPids,
} from './lib.mjs';

const mode = process.argv[2] ?? 'v1';
const letter = process.argv[3] ?? 'a';
const TAG = process.env.TAG ?? 'kill';
const STOP = process.env.STOP ?? 'KILL';
openLog(`s17-restart-${ARM}-${mode}-${STOP}`);
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const held = (id) => holders().some(([, h]) => h === id);
const tag = `W5-${mode}`;

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
const file = path.join(where.cwd, `w5-${runtimeSessionId.slice(0, 6)}.txt`);
const prepared = await client.prepare(identity('w5'), 'write_file', { file_path: file, content: 'never\n' });
const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const reserved = await client.prepareExecution(reference);
const cancel = () => broker('POST', `executions/${reserved.executionCallId}:cancel`, { ...base, requestId: randomUUID() });
const get = () => broker('GET', `executions/${reserved.executionCallId}?requestId=${randomUUID()}&harnessSessionId=${where.harness}&runtimeSessionId=${runtimeSessionId}`);
const bindingOf = () => {
  const row = sql(`SELECT b.binding_state, b.runtime_generation FROM qwen_runtime_binding b JOIN qwen_runtime_session s ON s.binding_id=b.binding_id WHERE s.runtime_session_id='${runtimeSessionId}'`)[0];
  return row ? `${row[0]}/gen${row[1]}` : 'none';
};

const first = await cancel();
const before = { session: runtimeSession(runtimeSessionId)?.state, binding: bindingOf(), workers: workerPids().length };
say(tag, `prepared call reserved | cancel #1 ${answer(first)} ${first.json?.status?.result?.executionStatus ?? ''} | Session ${before.session} | binding ${before.binding} | record ${executions(runtimeSessionId).map((r) => `${r.state}/${r.status}`)}`);

// Replace the Broker process.
const pid = Number(fs.readFileSync(path.join(RIG, 'run', `spring-${TAG}.pid`), 'utf8').trim());
process.kill(pid, STOP === 'KILL' ? 'SIGKILL' : 'SIGTERM');
for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); await sleep(200); } catch { break; } }
const orphans = workerPids().length;
execFileSync(path.join(RIG, 'restart-spring.sh'), [TAG, DB, String(HTTP_PORT), String(BROKER_PORT), String(PROXY_PORT)], { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
say(tag, `Broker process stopped with SIG${STOP} and started again on the same database | workers still alive after the stop: ${orphans}`);

const mark = ledgerMark();
const second = await cancel();
const third = await cancel();
const got = await get();
const seen = ledger(mark).map((e) => e.kind ?? e.path.replace('/internal/managed-runtime', ''));
const after = { session: runtimeSession(runtimeSessionId)?.state, binding: bindingOf() };
const release = await broker('POST', `tool-sessions/${runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
const late = await broker('POST', `executions/${reserved.executionCallId}:start`, { ...base, requestId: randomUUID() });
await sleep(1000);
say(tag, `after the restart: Session ${after.session} | binding ${after.binding}`);
say(tag, `cancel #2 ${answer(second)}${second.status === 200 ? ` ${second.json?.status?.result?.executionStatus}` : ` retryable=${second.json?.retryable} "${second.json?.error}"`} | cancel #3 ${answer(third)} | GET ${answer(got)} ${got.json?.status?.state ?? ''}/${got.json?.status?.result?.executionStatus ?? ''} | worker saw [${seen}]`);
say(tag, `start of the cancelled call ${answer(late)}${late.status === 200 ? ` ${late.json?.status?.result?.executionStatus}` : ''} | file written=${fs.existsSync(file)} | release ${answer(release)}${release.status === 200 ? '' : ` "${release.json?.error}"`} | Session ${runtimeSession(runtimeSessionId)?.state}${mode === 'v2' ? ` | storage held=${held(runtimeSessionId)}` : ''}`);
check(`${tag}.1`, 'after the Broker was replaced, a repeated cancellation is answered from the stored receipt', second.status === 200 && third.status === 200 && second.json?.status?.result?.executionStatus === 'cancelled', `${answer(second)} | ${answer(third)}`);
check(`${tag}.2`, 'the receipt is readable and the cancelled call never executes', got.status === 200 && !fs.existsSync(file));
const ok = summary();
provider.dispose();
process.exit(ok ? 0 : 1);
