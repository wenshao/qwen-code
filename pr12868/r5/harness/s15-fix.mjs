// PR #12868 round 4: the two behaviours commit cc06ee0e4e changes, on the real
// chain (built TS provider -> Spring Broker on MySQL -> bundled worker).
//   U1 a refused provider acquire must not fence the raw protocol      (R1-30, boot v2)
//   U2 cancellation of a prepared call the worker no longer retains    (R1-32, through the Broker)
//   U3 status / cancel / execute for a reference the worker forgot     (R1-32, at the worker)
// U1 and U3 send requests the Broker itself never sends in that order. They go
// to the worker the Broker launched, with the Broker's own headers (inject()).
// usage: ARM=<pr|r3> ... node s15-fix.mjs <groups U1,U2,U3> <storage letters>
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, clearHooks, createSession, executions,
  holders, inject, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry,
  sleep, summary, workerPortOf,
} from './lib.mjs';

const groups = (process.argv[2] ?? 'U1,U2,U3').split(',');
const letters = (process.argv[3] ?? 'a,b,c,d,e,f,g,h').split(',');
let letterIndex = 0;
openLog(`s15-fix-${ARM}-${groups.join('')}`);
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const shown = (r) => `${r.status} ${r.status === 200 ? JSON.stringify(r.json?.result ?? r.json).slice(0, 120) : `${r.json?.code} "${r.json?.error}"`}`;
const PROVIDER = 'provider/v1/control';
const envelope = (session, operation) => ({ session, operation, protocolVersion: 1, providerProtocol: 'managed-runtime-provider/1' });

async function place(mode) {
  if (mode === 'v1') return { harness: await createSession(), cwd: fs.realpathSync(path.join(ROOTS, 'plain')) };
  const letter = letters[letterIndex++ % letters.length];
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  return { workspace: ws, harness: await createSession(ws), cwd: fs.realpathSync(path.join(ROOTS, letter, 'child')) };
}
async function open(mode, where, runtimeSessionId = randomUUID()) {
  const { BrokerManagedRuntimeProvider } = await loadProvider();
  where ??= await place(mode);
  const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  providers.push(provider);
  const request = prepareRequest(runtimeSessionId, 'bootstrap', where.cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: where.harness });
  const s = { ...where, mode, provider, runtimeSessionId, request, client };
  await client.fileHistory.bind({ ownerSessionId: s.harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: s.cwd, snapshots: [] });
  s.manifest = await client.manifest();
  s.identity = (callId, promptId = 'p1') => ({ sessionId: runtimeSessionId, promptId, callId, capabilityDigest: s.manifest.capabilityDigest, policyRevision: s.manifest.policyRevision });
  await client.beginTurn(s.identity('turn'));
  s.base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId };
  s.wire = { runtimeSessionId, turnKind: 'bootstrap', harnessSessionId: s.harness };
  s.port = workerPortOf(runtimeSessionId);
  s.ready = async (callId, toolName, input, promptId = 'p1') => {
    const prepared = await client.prepare(s.identity(callId, promptId), toolName, input);
    const reference = ref(prepared);
    const reserved = await client.prepareExecution(reference);
    if (mode === 'v1') await client.confirm(reference, 'proceed_once');
    await client.preflight(reference);
    return { reference, reserved };
  };
  s.release = () => attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  return s;
}
const post = (s, route, extra = {}) => broker('POST', route, { ...s.base, requestId: randomUUID(), ...extra });
const getExecution = (s, id) => broker('GET', `executions/${id}?requestId=${randomUUID()}&harnessSessionId=${s.harness}&runtimeSessionId=${s.runtimeSessionId}`);
const held = (id) => holders().some(([, h]) => h === id);

// Raw four-field path through the Broker (#12831), for one Runtime Session.
async function rawCall(base, runtimeSessionId, callId, toolName, input) {
  const payloadJson = JSON.stringify({ toolName, input });
  const digest = `sha256:${createHash('sha256').update(payloadJson).digest('hex')}`;
  const reference = { sessionId: runtimeSessionId, promptId: 'p1', callId, argsDigest: digest };
  const reserve = await broker('POST', 'executions:prepare', { ...base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: 'p1', toolCallId: callId, requestDigest: digest, reference });
  const mark = ledgerMark();
  const start = await broker('POST', `executions/${reserve.json.executionCallId}:start`, { ...base, requestId: randomUUID(), payloadJson });
  let row;
  for (let i = 0; i < 100; i++) {
    row = executions(runtimeSessionId).find((r) => r.id === reserve.json.executionCallId);
    if (row && (row.state === 'SETTLED' || row.state === 'UNKNOWN')) break;
    await sleep(100);
  }
  const worker = ledger(mark).find((e) => e.path.endsWith('/execute'));
  return { reserve, start, row, worker };
}

// U1 -------------------------------------------------------------------------
async function refusedAcquire() {
  const tag = 'U1-v2';
  const where = await place('v2');
  // A first Runtime Session of this Harness Session brings the worker up.
  const first = await open('v2', where);
  const port = first.port;
  const released = await first.release();
  say(tag, `worker of the Harness Session listens on a loopback port (seen on the wire) | first Runtime Session released: ${brief(released)}`);

  const next = randomUUID();
  const wireSession = { runtimeSessionId: next, turnKind: 'bootstrap', harnessSessionId: where.harness };
  const refused = await inject(port, PROVIDER, envelope(wireSession, { kind: 'acquire' }));
  say(tag, `provider acquire for a Runtime Session whose context is not installed yet (sent by the rig): ${shown(refused)}`);

  const base = { protocolVersion: 1, harnessSessionId: where.harness, runtimeSessionId: next };
  const acquire = await broker('POST', 'tool-sessions:acquire', { ...base, requestId: randomUUID(), turnKind: 'bootstrap' });
  const file = path.join(where.cwd, `u1-${next.slice(0, 6)}.txt`);
  const raw = await rawCall(base, next, 'u1-raw', 'write_file', { file_path: file, content: 'raw after refused acquire\n' });
  say(tag, `Broker acquires the same Runtime Session (context, activation): ${answer(acquire)} | raw start ${answer(raw.start)} | worker ${raw.worker?.path.replace('/internal/managed-runtime', '')} -> ${raw.worker ? shown({ status: raw.worker.status, json: raw.worker.response }) : 'no request'}`);
  const switched = await inject(port, PROVIDER, envelope(wireSession, { kind: 'acquire' }));
  say(tag, `provider acquire for that Session once it has run raw work (sent by the rig): ${shown(switched)}`);
  const release = await broker('POST', `tool-sessions/${next}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
  say(tag, `record ${raw.row?.state}/${raw.row?.status} | file=${JSON.stringify(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)} | release ${answer(release)} | Session ${runtimeSession(next)?.state} | storage held=${held(next)}`);
  const after = await inject(port, PROVIDER, envelope(wireSession, { kind: 'acquire' }));
  say(tag, `provider acquire for that Session after the release request (sent by the rig): ${shown(after)}`);
  // The next Runtime Session of the Workspace, through the provider as usual.
  const follow = await attempt(() => open('v2', where));
  say(tag, `next Runtime Session of the same Workspace through the provider: ${follow.ok ? 'ok' : brief(follow)}`);
  if (follow.ok) await follow.value.release();

  check(`${tag}.1`, 'the worker refuses a provider acquire before the context is active', refused.status === 409 && refused.json?.code === 'managed_context_unavailable', shown(refused));
  check(`${tag}.2`, 'the refused acquire leaves the raw protocol available: the raw call executes once',
    raw.worker?.status === 200 && raw.row?.state === 'SETTLED' && raw.row?.status === 'success' && fs.existsSync(file),
    `worker ${raw.worker?.status} record ${raw.row?.state}/${raw.row?.status}`);
  check(`${tag}.3`, 'the Session releases and drops its storage; the Workspace admits the next Runtime Session',
    release.status === 200 && !held(next) && follow.ok, `release ${answer(release)} next ${follow.ok ? 'ok' : brief(follow)}`);
  check(`${tag}.4`, 'a Session that ran raw work cannot switch to the provider, and a released one stays closed', switched.status === 409 && after.status === 409, `${shown(switched)} | ${shown(after)}`);
}

// U1b ------------------------------------------------------------------------
async function refusedAcquireThenProvider() {
  const tag = 'U1b-v2';
  const where = await place('v2');
  const first = await open('v2', where);
  const port = first.port;
  await first.release();
  const next = randomUUID();
  const wireSession = { runtimeSessionId: next, turnKind: 'bootstrap', harnessSessionId: where.harness };
  const refused = await Promise.all([1, 2, 3].map(() => inject(port, PROVIDER, envelope(wireSession, { kind: 'acquire' }))));
  say(tag, `three concurrent provider acquires before the context is installed (sent by the rig): ${refused.map(answer).join(', ')}`);
  const s = await attempt(() => open('v2', where, next));
  let ran = { ok: false };
  const file = path.join(where.cwd, `u1b-${next.slice(0, 6)}.txt`);
  if (s.ok) ran = await attempt(async () => {
    const c = await s.value.ready('u1b', 'write_file', { file_path: file, content: 'provider after refused acquire\n' });
    return s.value.client.startExecution(c.reference, c.reserved.executionCallId);
  });
  const mark = ledgerMark();
  const raw = s.ok ? await inject(port, 'v2/execute', { protocolVersion: 2, reference: { promptId: 'p1', sessionId: next, callId: 'u1b-raw', argsDigest: `sha256:${createHash('sha256').update('x').digest('hex')}` }, toolName: 'write_file', input: { file_path: `${file}.raw`, content: 'raw\n' } }) : null;
  const released = s.ok ? await s.value.release() : null;
  say(tag, `the same Runtime Session through the provider and the Broker: ${s.ok ? 'acquired' : brief(s)} | call ${ran.ok ? ran.value.executionStatus : brief(ran)} | file=${JSON.stringify(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)}`);
  say(tag, `a raw execute for the Session the provider now owns (sent by the rig): ${raw ? shown(raw) : 'n/a'} | raw file written=${fs.existsSync(`${file}.raw`)} | release ${released ? brief(released) : 'n/a'}`);
  check(`${tag}.1`, 'every concurrent acquire is refused while the context is not active', refused.every((r) => r.status === 409 && r.json?.code === 'managed_context_unavailable'), refused.map(answer).join(', '));
  check(`${tag}.2`, 'the refused acquires do not block a later provider acquire; the call executes once', s.ok && ran.ok && ran.value.executionStatus === 'success' && fs.existsSync(file));
  check(`${tag}.3`, 'a successful provider acquire still fences the raw protocol', raw?.status === 409 && !fs.existsSync(`${file}.raw`), raw ? shown(raw) : '');
  check(`${tag}.4`, 'release succeeds', released?.ok === true, released ? brief(released) : '');
}

// U2 -------------------------------------------------------------------------
// The worker forgets the calls of a prompt when the next prompt begins. It
// refuses to begin the next prompt while a call is unfinished, so a call can
// only be forgotten after it settled: here, after its first cancellation.
async function forgottenPreparedCancel(mode) {
  const tag = `U2-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `u2-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const { reference, reserved } = await s.ready('u2', 'write_file', { file_path: file, content: 'never\n' });
  const early = await attempt(() => s.client.beginTurn(s.identity('turn-2', 'p2')));
  const seen = [];
  const cancelOnce = async () => {
    const mark = ledgerMark();
    const r = await post(s, `executions/${reserved.executionCallId}:cancel`);
    seen.push(ledger(mark).filter((e) => e.kind === 'cancel' || e.kind === 'status').map((e) => `${e.kind} -> ${shown({ status: e.status, json: e.response })}`));
    return r;
  };
  const first = await cancelOnce();
  const turn = await attempt(() => s.client.beginTurn(s.identity('turn-2', 'p2')));
  const second = await cancelOnce();
  const third = await cancelOnce();
  const viaClient = await attempt(() => s.client.cancel(reference));
  const row = executions(s.runtimeSessionId)[0];
  const got = await getExecution(s, reserved.executionCallId);
  const late = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  // The Session keeps working for the new prompt.
  const file2 = path.join(s.cwd, `u2b-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const next = await attempt(async () => {
    const n = await s.ready('u2b', 'write_file', { file_path: file2, content: 'p2\n' }, 'p2');
    return s.client.startExecution(n.reference, n.reserved.executionCallId);
  });
  const released = await s.release();
  const fourth = released.ok ? await cancelOnce() : null;
  say(tag, `call prepared and reserved in prompt p1, not started | begin-turn for p2 while it is unfinished: ${early.ok ? 'ok' : brief(early).slice(0, 150)}`);
  say(tag, `cancel #1: caller ${answer(first)} ${first.json?.status?.result?.executionStatus ?? ''} | worker saw [${seen[0].join(' ; ')}]`);
  say(tag, `begin-turn for p2 after the cancellation: ${turn.ok ? 'ok' : brief(turn).slice(0, 150)} (the worker now forgets the calls of p1)`);
  say(tag, `cancel #2: caller ${answer(second)}${second.json?.retryable === undefined ? '' : ` retryable=${second.json.retryable}`} ${JSON.stringify(second.json?.error ?? second.json?.status?.result?.executionStatus)} | worker saw [${seen[1].join(' ; ')}]`);
  say(tag, `cancel #3: caller ${answer(third)} | worker saw [${seen[2].join(' ; ')}]`);
  say(tag, `the same cancellation through the provider client: ${viaClient.ok ? `ok ${JSON.stringify(viaClient.value)?.slice(0, 120)}` : brief(viaClient).slice(0, 200)}`);
  say(tag, `record ${row.state}/${row.status} cancel requested=${row.cancel} | GET ${answer(got)} ${got.json?.status?.state ?? ''}/${got.json?.status?.result?.executionStatus ?? ''} | start of the old call: ${late.ok ? late.value.executionStatus : brief(late).slice(0, 110)} | file written=${fs.existsSync(file)}`);
  say(tag, `a call of p2 in the same Session: ${next.ok ? next.value.executionStatus : brief(next).slice(0, 150)} | release ${brief(released)} | cancel after release ${fourth ? `${answer(fourth)} worker saw [${seen[3].join(' ; ')}]` : 'n/a'} | storage held=${held(s.runtimeSessionId)}`);
  say(tag, `OBSERVED: a repeated cancellation of a call the worker forgot is answered to the caller with ${answer(second)}`);
  check(`${tag}.1`, 'the worker does not begin the next prompt while a prepared call is unfinished', !early.ok && turn.ok, early.ok ? 'begun' : 'refused');
  check(`${tag}.2`, 'the worker answers the cancellation of a call it no longer retains with exactly { state: "unknown" }',
    seen[1].length > 0 && seen[1][0].startsWith('cancel -> 200 {"state":"unknown"}'), seen[1].join(' ; '));
  check(`${tag}.3`, 'the forgotten call never executes and its record stays settled as cancelled',
    row.state === 'SETTLED' && row.status === 'cancelled' && got.status === 200 && !fs.existsSync(file) && (!late.ok || late.value.executionStatus === 'cancelled'));
  check(`${tag}.4`, 'the Session keeps working for the new prompt and releases', next.ok && next.value.executionStatus === 'success' && released.ok && !held(s.runtimeSessionId), `${next.ok ? next.value.executionStatus : brief(next)} | ${brief(released)}`);
}

// U3 -------------------------------------------------------------------------
async function forgottenObservation(mode) {
  const tag = `U3-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `u3-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const { reference, reserved } = await s.ready('u3', 'run_shell_command', { command: `echo once >> ${file}`, is_background: false });
  const done = await s.client.startExecution(reference, reserved.executionCallId);
  await s.client.beginTurn(s.identity('turn-2', 'p2'));
  const send = (operation) => inject(s.port, PROVIDER, envelope(s.wire, operation));
  const status = await send({ kind: 'status', reference, afterSequence: 0 });
  const cancel = await send({ kind: 'cancel', reference });
  const execute = await send({ kind: 'execute', reference });
  say(tag, `call of prompt p1 executed (${done.executionStatus}); prompt p2 begun; the worker no longer retains the call`);
  say(tag, `status  (sent by the rig) ${shown(status)}`);
  say(tag, `cancel  (sent by the rig) ${shown(cancel)}`);
  say(tag, `execute (sent by the rig) ${shown(execute)} | file=${JSON.stringify(fs.readFileSync(file, 'utf8'))}`);

  // A call the worker does retain: a changed reference stays a conflict.
  const file2 = path.join(s.cwd, `u3b-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const kept = await s.ready('u3b', 'write_file', { file_path: file2, content: 'kept\n' }, 'p2');
  const forged = { ...kept.reference, argsDigest: 'f'.repeat(64) };
  const forgedStatus = await send({ kind: 'status', reference: forged, afterSequence: 0 });
  const forgedCancel = await send({ kind: 'cancel', reference: forged });
  const other = { ...kept.reference, invocationId: randomUUID() };
  const otherStatus = await send({ kind: 'status', reference: other, afterSequence: 0 });
  const real = await send({ kind: 'status', reference: kept.reference, afterSequence: 0 });
  const ran = await attempt(() => s.client.startExecution(kept.reference, kept.reserved.executionCallId));
  say(tag, `retained call, argsDigest changed: status ${shown(forgedStatus)} | cancel ${shown(forgedCancel)}`);
  say(tag, `retained call, other invocation id: status ${shown(otherStatus)} | true reference: status ${real.status} state=${real.json?.result?.state} cancelRequested=${real.json?.result?.cancelRequested}`);
  say(tag, `the retained call then runs: ${ran.ok ? ran.value.executionStatus : brief(ran)} | file=${JSON.stringify(fs.existsSync(file2) ? fs.readFileSync(file2, 'utf8') : null)}`);
  const released = await s.release();
  say(tag, `release ${brief(released)} | records=${JSON.stringify(executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`))}`);

  const unknown = (r) => r.status === 200 && JSON.stringify(r.json?.result) === '{"state":"unknown"}';
  check(`${tag}.1`, 'status and cancel for a call the worker no longer retains answer exactly { state: "unknown" }', unknown(status) && unknown(cancel), `${shown(status)} | ${shown(cancel)}`);
  check(`${tag}.2`, 'execute for that call is refused and the effect happened once', execute.status === 409 && fs.readFileSync(file, 'utf8') === 'once\n', shown(execute));
  check(`${tag}.3`, 'a changed reference of a retained call is a conflict and cancels nothing',
    forgedStatus.status === 409 && forgedCancel.status === 409 && real.json?.result?.cancelRequested === false && ran.ok && ran.value.executionStatus === 'success',
    `${shown(forgedStatus)} | ${shown(forgedCancel)}`);
  check(`${tag}.4`, 'an invocation id the worker never issued answers unknown and reveals nothing', unknown(otherStatus), shown(otherStatus));
  check(`${tag}.5`, 'release succeeds', released.ok, brief(released));
}

// U4 -------------------------------------------------------------------------
// The status arm was rewritten by this commit; its progress cursor must still work.
async function progressCursor(mode) {
  const tag = `U4-${mode}`;
  const s = await open(mode);
  const { reference, reserved } = await s.ready('u4', 'run_shell_command', { command: 'for i in 1 2 3 4 5; do echo tick$i; perl -e "select(undef,undef,undef,0.8)"; done', is_background: false });
  const running = attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  for (let i = 0; i < 100 && executions(s.runtimeSessionId)[0].state !== 'EXECUTING'; i++) await sleep(100);
  await sleep(2600);
  const send = (afterSequence) => inject(s.port, PROVIDER, envelope(s.wire, { kind: 'status', reference, afterSequence }));
  const all = await send(0);
  const seqs = (r) => (r.json?.result?.progress ?? []).map((p) => p.seq);
  const last = all.json?.result?.lastSeq ?? 0;
  const tail = await send(Math.max(0, last - 1));
  const none = await send(last);
  const done = await running;
  const after = await send(0);
  const released = await s.release();
  say(tag, `while the command runs: status after 0 -> state=${all.json?.result?.state} lastSeq=${last} progress seq [${seqs(all)}]`);
  say(tag, `status after ${Math.max(0, last - 1)} -> progress seq [${seqs(tail)}] | status after ${last} -> progress seq [${seqs(none)}]`);
  say(tag, `command ${done.ok ? done.value.executionStatus : brief(done)} | status after 0 once settled -> state=${after.json?.result?.state} lastSeq=${after.json?.result?.lastSeq} | release ${brief(released)}`);
  check(`${tag}.1`, 'status returns only the progress after the cursor',
    all.status === 200 && last >= 2 && seqs(all).length >= 2 && seqs(tail).every((n) => n > last - 1) && seqs(tail).length < seqs(all).length && seqs(none).every((n) => n > last),
    `all=[${seqs(all)}] tail=[${seqs(tail)}] none=[${seqs(none)}]`);
  check(`${tag}.2`, 'the command settles and the Session releases', done.ok && done.value.executionStatus === 'success' && released.ok);
}

const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
for (const group of groups) {
  for (const mode of group.startsWith('U1') ? ['v2'] : modes) {
    say('GROUP', `${group} ${mode} arm=${ARM}`);
    try {
      if (group === 'U1') await refusedAcquire();
      if (group === 'U1b') await refusedAcquireThenProvider();
      if (group === 'U2') await forgottenPreparedCancel(mode);
      if (group === 'U3') await forgottenObservation(mode);
      if (group === 'U4') await progressCursor(mode);
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
