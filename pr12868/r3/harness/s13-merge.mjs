// PR #12868 round 3: behaviour at the seams of the hand-resolved merge with
// main (#12839 W0e: terminal receipts, Runtime-loss fences).
//   M1 terminal receipts after release          (provider path)
//   M2 repeated cancellation of a prepared call (provider path)
//   M3 worker death                             (provider or raw path; raw runs on the main arm too)
// usage: ARM=<pr|main> ... node s13-merge.mjs <groups M1,M2,M3p,M3r> <storage letters>
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, clearHooks, createSession, executions,
  holders, hook, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry,
  sleep, sql, summary, wire, workerPids, launches,
} from './lib.mjs';

const groups = (process.argv[2] ?? 'M1,M2,M3p,M3r').split(',');
const letters = (process.argv[3] ?? 'a,b,c,d,e,f,g,h').split(',');
let letterIndex = 0;
openLog(`s13-merge-${ARM}-${groups.join('')}`);
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;

async function place(mode) {
  if (mode === 'v1') return { harness: await createSession(), cwd: fs.realpathSync(path.join(ROOTS, 'plain')) };
  const letter = letters[letterIndex++ % letters.length];
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  return { workspace: ws, harness: await createSession(ws), cwd: fs.realpathSync(path.join(ROOTS, letter, 'child')) };
}
async function open(mode, where) {
  const { BrokerManagedRuntimeProvider } = await loadProvider();
  where ??= await place(mode);
  const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  providers.push(provider);
  const runtimeSessionId = randomUUID();
  const request = prepareRequest(runtimeSessionId, 'bootstrap', where.cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: where.harness });
  const s = { ...where, mode, provider, runtimeSessionId, request, client };
  await client.fileHistory.bind({ ownerSessionId: s.harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: s.cwd, snapshots: [] });
  s.manifest = await client.manifest();
  s.identity = (callId) => ({ sessionId: runtimeSessionId, promptId: 'p1', callId, capabilityDigest: s.manifest.capabilityDigest, policyRevision: s.manifest.policyRevision });
  await client.beginTurn(s.identity('turn'));
  s.base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId };
  s.ready = async (callId, toolName, input) => {
    const prepared = await client.prepare(s.identity(callId), toolName, input);
    const reference = ref(prepared);
    const reserved = await client.prepareExecution(reference);
    if (mode === 'v1') await client.confirm(reference, 'proceed_once');
    await client.preflight(reference);
    return { reference, reserved };
  };
  s.release = () => attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  return s;
}
const getExecution = (s, id) => broker('GET', `executions/${id}?requestId=${randomUUID()}&harnessSessionId=${s.harness}&runtimeSessionId=${s.runtimeSessionId}`);
const post = (s, route, extra = {}) => broker('POST', route, { ...s.base, requestId: randomUUID(), ...extra });
const providerKey = (harness, r) => createHash('sha256').update(harness).update('\0').update(r.promptId).update('\0').update(r.callId).update('\0').update(r.argsDigest).update('\0').update(r.invocationId).digest('hex');
const reserveBody = (s, reference, key) => ({ ...s.base, requestId: randomUUID(), idempotencyKey: key, turnId: reference.promptId, toolCallId: reference.callId, requestDigest: reference.argsDigest, reference });
const sessionRow = (id) => sql(`SELECT session_state, record_version FROM qwen_runtime_session WHERE runtime_session_id='${id}'`)[0]?.join('/v');
const bindingOf = (id) => {
  const row = sql(`SELECT b.binding_state, b.runtime_generation FROM qwen_runtime_binding b JOIN qwen_runtime_session s ON s.binding_id=b.binding_id WHERE s.runtime_session_id='${id}'`)[0];
  return row ? `${row[0]}/gen${row[1]}` : 'none';
};

// M1 -------------------------------------------------------------------------
async function receipts(mode) {
  const tag = `M1-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `m1-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const { reference, reserved } = await s.ready('m1', 'write_file', { file_path: file, content: 'receipt\n' });
  const result = await s.client.startExecution(reference, reserved.executionCallId);
  const before = await getExecution(s, reserved.executionCallId);
  const released = await s.release();
  const row = sessionRow(s.runtimeSessionId);
  const mark = ledgerMark();
  const after = await getExecution(s, reserved.executionCallId);
  const cancel = await post(s, `executions/${reserved.executionCallId}:cancel`);
  const start = await post(s, `executions/${reserved.executionCallId}:start`);
  const key = providerKey(s.harness, reference);
  const same = await broker('POST', 'executions:prepare', reserveBody(s, reference, key));
  const changed = await broker('POST', 'executions:prepare', reserveBody(s, { ...reference, invocationId: randomUUID() }, key));
  const stranger = mode === 'v1' ? await createSession() : (await place('v2')).harness;
  const foreign = await broker('GET', `executions/${reserved.executionCallId}?requestId=${randomUUID()}&harnessSessionId=${stranger}&runtimeSessionId=${s.runtimeSessionId}`);
  const fresh = await broker('POST', 'executions:prepare', reserveBody(s, { ...reference, callId: 'm1-new', invocationId: randomUUID() }, randomUUID()));
  const control = await post(s, `tool-sessions/${s.runtimeSessionId}/control`, { operation: { kind: 'history' } });
  const viaProvider = await attempt(() => s.provider.inspectExecution({ harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId, executionCallId: reserved.executionCallId }));
  const wireAfter = ledger(mark);
  say(tag, `before release: GET ${answer(before)} state=${before.json?.status?.state} | release ${brief(released)}`);
  say(tag, `after release:  GET ${answer(after)} state=${after.json?.status?.state} result=${after.json?.status?.result?.executionStatus} | cancel ${answer(cancel)} state=${cancel.json?.status?.state} | start ${answer(start)} state=${start.json?.status?.state}`);
  say(tag, `after release:  reserve again with the same key and reference ${answer(same)} sameExecution=${same.json?.executionCallId === reserved.executionCallId} | same key, other invocation ${answer(changed)} | other Harness Session ${answer(foreign)}`);
  say(tag, `after release:  NEW reservation ${answer(fresh)} | control[history] ${answer(control)} | provider.inspectExecution ${viaProvider.ok ? viaProvider.value.outcome : brief(viaProvider)}`);
  say(tag, `Session row ${row} -> ${sessionRow(s.runtimeSessionId)} | rows=${JSON.stringify(executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`))} | file=${JSON.stringify(fs.readFileSync(file, 'utf8'))} | worker requests after release: ${wireAfter.length}`);
  check(`${tag}.1`, 'a released Session still answers for its terminal execution: GET, cancel and the same reservation return the stored receipt',
    result.executionStatus === 'success' && after.status === 200 && after.json.status.state === 'settled' && cancel.status === 200 &&
    same.status === 200 && same.json.executionCallId === reserved.executionCallId && viaProvider.ok && viaProvider.value.outcome === 'known');
  check(`${tag}.2`, 'receipts are owner-bound and idempotency-bound: other invocation and other Harness Session are refused',
    changed.status === 409 && foreign.status >= 400 && foreign.status < 500, `${answer(changed)} | ${answer(foreign)}`);
  check(`${tag}.3`, 'reading receipts reopens nothing: no worker request, Session row unchanged, no new work or live control admitted',
    wireAfter.length === 0 && row === sessionRow(s.runtimeSessionId) && fresh.status >= 400 && control.status >= 400 &&
    executions(s.runtimeSessionId).length === 1 && fs.readFileSync(file, 'utf8') === 'receipt\n',
    `wire=${wireAfter.length} fresh=${answer(fresh)} control=${answer(control)}`);
}

// M2 -------------------------------------------------------------------------
async function repeatedCancel(mode) {
  const tag = `M2-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `m2-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const { reserved } = await s.ready('m2', 'write_file', { file_path: file, content: 'never\n' });
  const counts = [];
  const cancelOnce = async () => {
    const mark = ledgerMark();
    const r = await post(s, `executions/${reserved.executionCallId}:cancel`);
    const seen = ledger(mark).filter((e) => e.kind === 'cancel' || e.kind === 'status').map((e) => e.kind);
    counts.push(seen);
    return r;
  };
  const first = await cancelOnce();
  const second = await cancelOnce();
  const burst = await Promise.all([cancelOnce(), cancelOnce(), cancelOnce()]);
  const busy = await s.release();
  const third = busy.ok ? await cancelOnce() : null;
  say(tag, `cancel #1 ${answer(first)} ${first.json?.status?.result?.executionStatus} worker saw [${counts[0]}] | cancel #2 ${answer(second)} worker saw [${counts[1]}] | 3 concurrent ${burst.map(answer)} | release ${brief(busy)} | cancel after release ${third ? `${answer(third)} worker saw [${counts.at(-1)}]` : 'n/a'}`);
  check(`${tag}.1`, 'every cancellation before release asks the worker again and answers cancelled; none has an effect',
    [first, second, ...burst].every((r) => r.status === 200 && r.json.status.result.executionStatus === 'cancelled') &&
    counts.slice(0, 2).every((c) => c.includes('cancel')) && !fs.existsSync(file));
  check(`${tag}.2`, 'after release the cancellation is answered from the stored receipt with no worker request',
    busy.ok && third?.status === 200 && counts.at(-1).length === 0 && !fs.existsSync(file), `release=${brief(busy)}`);
}

// M4 -------------------------------------------------------------------------
// The guard the merge wrote by hand: only a call that was never dispatched
// (dispatch generation 0) keeps asking the worker on a repeated cancellation.
async function repeatedCancelOfStarted(mode) {
  const tag = `M4-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `m4-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const { reference, reserved } = await s.ready('m4', 'run_shell_command', { command: `perl -e "sleep 20"; echo late >> ${file}`, is_background: false });
  const running = attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  for (let i = 0; i < 100 && executions(s.runtimeSessionId)[0].state !== 'EXECUTING'; i++) await sleep(100);
  const seen = [];
  const cancelOnce = async () => {
    const mark = ledgerMark();
    const r = await post(s, `executions/${reserved.executionCallId}:cancel`);
    seen.push(ledger(mark).filter((e) => e.kind === 'cancel' || e.kind === 'status').map((e) => e.kind));
    return r;
  };
  const first = await cancelOnce();
  const outcome = await running;
  for (let i = 0; i < 100 && executions(s.runtimeSessionId)[0].state !== 'SETTLED'; i++) await sleep(100);
  const stored = executions(s.runtimeSessionId)[0];
  const row = [stored.state, stored.generation, stored.cancel];
  const second = await cancelOnce();
  const third = await cancelOnce();
  const released = await s.release();
  const fourth = released.ok ? await cancelOnce() : null;
  await sleep(1200);
  say(tag, `start result=${outcome.ok ? outcome.value.executionStatus : brief(outcome)} | record ${row?.join('/')} (state/dispatch generation/cancel requested)`);
  say(tag, `cancel #1 (running) ${answer(first)} worker saw [${seen[0]}] | cancel #2 (settled) ${answer(second)} ${second.json?.status?.result?.executionStatus} worker saw [${seen[1]}] | cancel #3 ${answer(third)} worker saw [${seen[2]}] | release ${brief(released)} | cancel after release ${fourth ? `${answer(fourth)} worker saw [${seen[3]}]` : 'n/a'}`);
  check(`${tag}.1`, 'the running call is cancelled through the worker and settles cancelled with no late effect',
    first.status === 200 && seen[0].includes('cancel') && outcome.ok && outcome.value.executionStatus === 'cancelled' && !fs.existsSync(file));
  check(`${tag}.2`, 'a repeated cancellation of a call that WAS dispatched is answered from the record: no worker request',
    [second, third].every((r) => r.status === 200 && r.json.status.result.executionStatus === 'cancelled') && seen[1].length === 0 && seen[2].length === 0,
    `worker saw [${seen[1]}] [${seen[2]}]`);
  check(`${tag}.3`, 'release succeeds and the receipt stays readable afterwards',
    released.ok && fourth?.status === 200 && seen[3].length === 0, brief(released));
}

// M5 -------------------------------------------------------------------------
// A cancellation that loses the race: the worker hears it only after the
// command finished, so the record is settled/success with cancel requested.
async function cancelLosesTheRace(mode) {
  const tag = `M5-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `m5-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const { reference, reserved } = await s.ready('m5', 'run_shell_command', { command: `perl -e "sleep 2"; echo done >> ${file}`, is_background: false });
  await hook({ kind: 'cancel', action: 'delay', delayMs: 5000, count: 1 });
  const running = attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  for (let i = 0; i < 100 && executions(s.runtimeSessionId)[0].state !== 'EXECUTING'; i++) await sleep(100);
  const firstPending = post(s, `executions/${reserved.executionCallId}:cancel`);
  const outcome = await running;
  const first = await firstPending;
  for (let i = 0; i < 100 && executions(s.runtimeSessionId)[0].state !== 'SETTLED'; i++) await sleep(100);
  const stored = executions(s.runtimeSessionId)[0];
  const mark = ledgerMark();
  const second = await post(s, `executions/${reserved.executionCallId}:cancel`);
  const seen = ledger(mark).filter((e) => e.kind === 'cancel' || e.kind === 'status').map((e) => e.kind);
  const released = await s.release();
  say(tag, `start result=${outcome.ok ? outcome.value.executionStatus : brief(outcome)} | cancel #1 (delayed 5 s on the wire) ${answer(first)} | record ${stored.state}/${stored.status}/generation ${stored.generation}/cancel requested ${stored.cancel} | file=${JSON.stringify(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)}`);
  say(tag, `cancel #2 ${answer(second)} ${second.json?.status?.result?.executionStatus ?? ''} worker saw [${seen}] | release ${brief(released)}`);
  check(`${tag}.1`, 'the command finished before the worker heard the cancellation; the record says so',
    outcome.ok && outcome.value.executionStatus === 'success' && stored.state === 'SETTLED' && stored.generation === 1 && fs.existsSync(file),
    `${stored.state}/${stored.status} cancel=${stored.cancel}`);
  check(`${tag}.2`, 'a later cancellation is answered from the record (200, success) with no worker request',
    second.status === 200 && second.json?.status?.result?.executionStatus === 'success' && seen.length === 0, `${answer(second)} worker saw [${seen}]`);
  check(`${tag}.3`, 'release succeeds', released.ok, brief(released));
}

// M3 -------------------------------------------------------------------------
async function death(mode, kind) {
  const tag = `M3${kind === 'provider' ? 'p' : 'r'}-${mode}`;
  const before = new Set(workerPids().map((w) => w.pid));
  let s;
  let executionCallId;
  let startIt;
  let file;
  if (kind === 'provider') {
    s = await open(mode);
    file = path.join(s.cwd, `m3-${s.runtimeSessionId.slice(0, 6)}.txt`);
    const { reference, reserved } = await s.ready('m3', 'write_file', { file_path: file, content: 'm3\n' });
    executionCallId = reserved.executionCallId;
    startIt = () => post(s, `executions/${executionCallId}:start`);
    s.viaProvider = () => attempt(() => s.client.startExecution(reference, executionCallId));
  } else {
    s = await place(mode);
    s.runtimeSessionId = randomUUID();
    s.base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId };
    const acquired = await post(s, 'tool-sessions:acquire', { turnKind: 'bootstrap' });
    if (acquired.status !== 200) throw new Error(`raw acquire ${answer(acquired)}`);
    file = path.join(s.cwd, `m3-${s.runtimeSessionId.slice(0, 6)}.txt`);
    const payloadJson = JSON.stringify({ toolName: 'write_file', input: { file_path: file, content: 'm3\n' } });
    const digest = `sha256:${createHash('sha256').update(payloadJson).digest('hex')}`;
    const reference = { sessionId: s.runtimeSessionId, promptId: 'p1', callId: 'm3', argsDigest: digest };
    const reserved = await broker('POST', 'executions:prepare', { ...s.base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: 'p1', toolCallId: 'm3', requestDigest: digest, reference });
    executionCallId = reserved.json.executionCallId;
    startIt = () => post(s, `executions/${executionCallId}:start`, { payloadJson });
    s.release = async () => {
      const r = await post(s, `tool-sessions/${s.runtimeSessionId}:release`);
      return { ok: r.status === 200, status: r.status, code: r.code, value: r.json?.released, name: '', message: '' };
    };
  }
  const mine = workerPids().filter((w) => !before.has(w.pid));
  if (mine.length !== 1) {
    check(`${tag}.0`, 'exactly one new worker identified', false, JSON.stringify(mine));
    return;
  }
  say(tag, `binding before: ${bindingOf(s.runtimeSessionId)} | worker pid ${mine[0].pid}`);
  process.kill(mine[0].pid, 'SIGKILL');
  await sleep(1500);
  const launchesBefore = launches().length;
  const mark = ledgerMark();
  const started = await startIt();
  await sleep(1500);
  const row = executions(s.runtimeSessionId).find((r) => r.id === executionCallId);
  const got = await broker('GET', `executions/${executionCallId}?requestId=${randomUUID()}&harnessSessionId=${s.harness}&runtimeSessionId=${s.runtimeSessionId}`);
  say(tag, `start after death: ${answer(started)} body keys=${JSON.stringify(Object.keys(started.json ?? {}))} details=${JSON.stringify(started.json?.details ?? null)}`);
  say(tag, `record ${row.state}/${row.status} | binding ${bindingOf(s.runtimeSessionId)} | GET ${answer(got)} details=${JSON.stringify(got.json?.details ?? null)} | worker requests ${ledger(mark).length} | file written=${fs.existsSync(file)}`);
  if (s.viaProvider) {
    const p = await s.viaProvider();
    say(tag, `what the provider raises: ${p.ok ? 'ok' : `${p.status} ${p.code} :: ${p.message}`}`);
  }
  const released = await s.release();
  await sleep(500);
  say(tag, `release: ${released.ok ? 'ok' : `${released.status} ${released.code}`} | Session ${runtimeSession(s.runtimeSessionId)?.state} | record ${executions(s.runtimeSessionId).find((r) => r.id === executionCallId).state} | storage held=${holders().some(([, h]) => h === s.runtimeSessionId)}`);
  const next = { base: { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId: randomUUID() } };
  const reacquire = await broker('POST', 'tool-sessions:acquire', { ...next.base, requestId: randomUUID(), turnKind: 'continuation' });
  say(tag, `next Runtime Session of the same Harness Session: ${answer(reacquire)} | new worker launches ${launches().length - launchesBefore} | binding now ${bindingOf(next.base.runtimeSessionId)}`);
  if (s.workspace) {
    const sibling = await createSession(s.workspace);
    const other = await broker('POST', 'tool-sessions:acquire', { protocolVersion: 1, harnessSessionId: sibling, runtimeSessionId: randomUUID(), requestId: randomUUID(), turnKind: 'bootstrap' });
    say(tag, `sibling Harness Session of the same Workspace: ${answer(other)}`);
  }
  check(`${tag}.1`, 'after worker death nothing executes and nothing is replayed', !fs.existsSync(file) && row.result?.executionStatus !== 'success' && started.status !== 200 || (started.status === 200 && started.json?.status?.state !== 'settled' && !fs.existsSync(file)),
    `${answer(started)} record=${row.state}`);
}

const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
for (const group of groups) {
  for (const mode of modes) {
    say('GROUP', `${group} ${mode} arm=${ARM}`);
    try {
      if (group === 'M1') await receipts(mode);
      if (group === 'M2') await repeatedCancel(mode);
      if (group === 'M4') await repeatedCancelOfStarted(mode);
      if (group === 'M5') await cancelLosesTheRace(mode);
      if (group === 'M3p') await death(mode, 'provider');
      if (group === 'M3r') await death(mode, 'raw');
    } catch (error) {
      check(`${group}-${mode}.x`, 'group completed', false, `${error?.name}: ${error?.message} code=${error?.code} status=${error?.status}\n${error?.stack?.split('\n').slice(1, 4).join('\n')}`);
    } finally {
      await clearHooks();
    }
  }
}
const ok = summary();
for (const p of providers) p.dispose();
process.exit(ok ? 0 : 1);
