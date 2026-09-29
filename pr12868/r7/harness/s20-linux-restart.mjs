// PR #12868 round 6, on Linux: the repeated cancellation after the Broker
// process was replaced, with the durable local provisioner of #12865.
// The server (trial merge of this head with main) and its workers run in a
// Linux container; this probe runs on the host, as the caller. The Broker has
// no proxy here, so requests to the worker are not listed.
// usage: ARM=tm7 DB=<db> MYSQL_PORT=13869 HTTP_PORT=18890 BROKER_PORT=19890 DURABLE=<true|false> STOP=<KILL|TERM> node s20-linux-restart.mjs <mode v1|v2> <storage letter>
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  BROKER_URL, BROKER_TOKEN, ARM, DB, broker, check, createSession, executions,
  holders, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry, sleep, sql, summary,
} from './lib.mjs';

const mode = process.argv[2] ?? 'v1';
const letter = process.argv[3] ?? 'a';
const STOP = process.env.STOP ?? 'KILL';
const DURABLE = process.env.DURABLE ?? 'true';
const BOX = process.env.BOX ?? 'pr12868-linux';
openLog(`s20-linux-restart-${ARM}-${DURABLE === 'true' ? 'durable' : 'default'}-${mode}-${STOP}`);
const inBox = (script) => {
  try {
    return execFileSync('docker', ['exec', BOX, 'sh', '-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    return String(error.stdout ?? '').trim();
  }
};
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const full = (r) => `${answer(r)}${r.status === 200 ? ` ${r.json?.status?.result?.executionStatus ?? ''}` : ` retryable=${r.json?.retryable} "${String(r.json?.error).slice(0, 110)}"`}`;
const held = (id) => holders().some(([, h]) => h === id);
const tag = `L-${mode}`;
const workers = () => inBox('pgrep -f managed-runtime-worker | wc -l');

say(tag, `host: ${inBox('uname -sr')} | machine-id ${inBox('cut -c1-8 /etc/machine-id')}… | boot_id ${inBox('cut -c1-8 /proc/sys/kernel/random/boot_id')}… | provisioner local-process, durable-local-process=${DURABLE}`);
const where = mode === 'v1'
  ? { harness: await createSession(), cwd: '/rig/roots/plain' }
  : await (async () => { const ws = `ws-${letter}-${Date.now()}`; seedRegistry(ws, `st-${letter}`); return { harness: await createSession(ws), cwd: `/rig/roots/${letter}/child` }; })();
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
const file = `${where.cwd}/l-${runtimeSessionId.slice(0, 6)}.txt`;
const written = () => inBox(`test -e ${file} && echo true || echo false`);
const prepared = await client.prepare(identity('l'), 'write_file', { file_path: file, content: 'never\n' });
const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const reserved = await client.prepareExecution(reference);
// A second call in the same Session, left prepared: it shows whether the
// adopted worker still serves the Session after the restart.
const other = `${where.cwd}/l-other-${runtimeSessionId.slice(0, 6)}.txt`;
const preparedOther = await client.prepare(identity('l-other'), 'write_file', { file_path: other, content: 'after the restart\n' });
const referenceOther = Object.fromEntries(REF_KEYS.map((k) => [k, preparedOther[k]]));
const reservedOther = await client.prepareExecution(referenceOther);
// Decided and checked before the restart, as a caller would have done.
if (mode === 'v1') await client.confirm(referenceOther, 'proceed_once');
await client.preflight(referenceOther);
const cancel = () => broker('POST', `executions/${reserved.executionCallId}:cancel`, { ...base, requestId: randomUUID() });
const get = () => broker('GET', `executions/${reserved.executionCallId}?requestId=${randomUUID()}&harnessSessionId=${where.harness}&runtimeSessionId=${runtimeSessionId}`);
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

const first = await cancel();
say(tag, `two calls prepared and reserved | cancel #1 of the first ${full(first)} | ${state()} | records ${executions(runtimeSessionId).map((r) => `${r.state}/${r.status}`)} | workers running ${workers()}`);

// Replace the Broker process.
inBox(`kill -${STOP} $(cat /rig/spring.pid)`);
for (let i = 0; i < 100; i++) { if (inBox('kill -0 $(cat /rig/spring.pid) 2>/dev/null && echo alive || echo gone') === 'gone') break; await sleep(200); }
const survived = workers();
const started = inBox(`/rig/start.sh ${DB} ${DURABLE} | tail -1`);
say(tag, `Broker process stopped with SIG${STOP} and started again on the same database (${started}) | workers that survived the stop: ${survived} | ${state()}`);

const second = await cancel();
const got = await get();
say(tag, `cancel #2 ${full(second)} | GET ${answer(got)} ${got.json?.status?.state ?? ''}/${got.json?.status?.result?.executionStatus ?? ''}`);
const a = await acquire();
const third = await cancel();
say(tag, `acquire again: answered after ${a.seconds} s with ${answer(a)}${a.status === 200 ? '' : ` retryable=${a.json?.retryable} "${String(a.json?.error).slice(0, 100)}"`} | cancel #3 ${full(third)} | ${state()} | workers running ${workers()}`);

// The cancelled call must stay cancelled; the other prepared call must run.
const late = await broker('POST', `executions/${reserved.executionCallId}:start`, { ...base, requestId: randomUUID() });
let ran = { status: '-' };
if (third.status === 200) {
  ran = await broker('POST', `executions/${reservedOther.executionCallId}:start`, { ...base, requestId: randomUUID() });
  for (let i = 0; i < 50; i++) {
    const row = executions(runtimeSessionId).find((r) => r.id === reservedOther.executionCallId);
    if (row && (row.state === 'SETTLED' || row.state === 'UNKNOWN')) break;
    await sleep(200);
  }
}
const rowOther = executions(runtimeSessionId).find((r) => r.id === reservedOther.executionCallId);
say(tag, `start of the cancelled call ${answer(late)}${late.status === 200 ? ` ${late.json?.status?.result?.executionStatus}` : ''} | its file written=${written()} | start of the other prepared call ${answer(ran)} -> record ${rowOther?.state}/${rowOther?.status} | its file holds ${JSON.stringify(inBox(`cat ${other} 2>/dev/null`))}`);
const release = await broker('POST', `tool-sessions/${runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
await sleep(1000);
say(tag, `release ${answer(release)}${release.status === 200 ? '' : ` "${String(release.json?.error).slice(0, 90)}"`} | ${state()}${mode === 'v2' ? ` | storage held=${held(runtimeSessionId)}` : ''} | workers running ${workers()}`);
check(`${tag}.1`, 'after the Broker was replaced, the repeated cancellation asks for adoption (503 runtime_reconciliation_required, retryable)', second.status === 503 && second.json?.code === 'runtime_reconciliation_required' && second.json?.retryable === true, full(second));
check(`${tag}.2`, 'acquiring again adopts the worker', a.status === 200, `${answer(a)} after ${a.seconds} s`);
check(`${tag}.3`, 'the cancellation is then confirmed', third.status === 200 && third.json?.status?.result?.executionStatus === 'cancelled', full(third));
check(`${tag}.4`, 'the cancelled call never executes; the other prepared call of the Session runs on the adopted worker', written() === 'false' && rowOther?.state === 'SETTLED' && rowOther?.status === 'success');
check(`${tag}.5`, 'the Session releases', release.status === 200 && runtimeSession(runtimeSessionId)?.state === 'RELEASED' && !(mode === 'v2' && held(runtimeSessionId)), answer(release));
const ok = summary();
provider.dispose();
process.exit(ok ? 0 : 1);
