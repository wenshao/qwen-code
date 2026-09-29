// PR #12868 contract probes on the real stack. Every section opens fresh
// Runtime Sessions; boot v1 = plain Session, boot v2 = Hosted Workspace Session.
//
// usage: node s1-contract.mjs <sections e.g. A,B,C,D> [storage letter for v2]
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, createSession, executions,
  ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry, sleep,
  summary, wire, holders, readLines,
} from './lib.mjs';

const sections = (process.argv[2] ?? 'A,B,C,D').split(',');
const letters = (process.argv[3] ?? 'a').split(',');
let letterIndex = 0;
openLog(`s1-contract-${ARM}-${sections.join('')}`);
const { BrokerManagedRuntimeProvider } = await loadProvider();
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];
function newProvider() {
  const p = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  providers.push(p);
  return p;
}

// One Workspace (and storage) per section: a section that leaves an UNKNOWN
// record pins its storage and must not starve the next section.
let workspaceHarness;
async function newWorkspace() {
  const letter = letters[letterIndex++ % letters.length];
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  return { workspace: ws, harness: await createSession(ws), cwd: fs.realpathSync(path.join(ROOTS, letter, 'child')) };
}
async function harnessFor(mode) {
  if (mode === 'v1') return { harness: await createSession(), cwd: fs.realpathSync(path.join(ROOTS, 'plain')) };
  workspaceHarness ??= await newWorkspace();
  return workspaceHarness;
}

async function open(mode, { provider = newProvider(), harness, cwd, bind = true, begin = true } = {}) {
  if (!harness) ({ harness, cwd } = await harnessFor(mode));
  const runtimeSessionId = randomUUID();
  const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: harness });
  const s = { mode, provider, harness, cwd, runtimeSessionId, request, client, promptId: `p-${runtimeSessionId.slice(0, 8)}` };
  if (bind)
    await client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] });
  s.manifest = await client.manifest();
  s.identity = (callId) => ({
    sessionId: runtimeSessionId,
    promptId: s.promptId,
    callId,
    capabilityDigest: s.manifest.capabilityDigest,
    policyRevision: s.manifest.policyRevision,
  });
  if (begin) await client.beginTurn(s.identity('turn'));
  s.release = () => attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  return s;
}
const shell = (command) => ({ command, is_background: false });
async function approve(s, reference) {
  if (s.mode === 'v1') await s.client.confirm(reference, 'proceed_once');
  return s.client.preflight(reference);
}
const executesFor = (entries, reference) =>
  entries.filter((e) => e.kind === 'execute' && e.request?.operation?.reference?.invocationId === reference.invocationId);

// ---------------------------------------------------------------------------
async function sectionA(mode) {
  const tag = `A-${mode}`;
  const s = await open(mode);
  const marker = `MARK-${randomUUID()}`;
  const counter = path.join(s.cwd, `counter-${marker}.txt`);
  check(`${tag}.1`, 'acquire leaves the Runtime Session READY', runtimeSession(s.runtimeSessionId)?.state === 'READY');
  check(`${tag}.2`, 'manifest lists the four fixed tools', JSON.stringify(s.manifest.tools.map((t) => t.name)) === '["read_file","write_file","edit","run_shell_command"]');
  const mark = ledgerMark();
  const prepared = await s.client.prepare(s.identity('call-1'), 'run_shell_command', shell(`echo ${marker} >> ${counter}`));
  const reference = ref(prepared);
  check(`${tag}.3`, 'prepare has no tool effect', !fs.existsSync(counter));
  const reserved = await s.client.prepareExecution(reference);
  let rows = executions(s.runtimeSessionId);
  check(`${tag}.4`, 'durable reservation: one PREPARED row, dispatch generation 0, no effect',
    rows.length === 1 && rows[0].state === 'PREPARED' && rows[0].generation === 0 && !fs.existsSync(counter),
    `state=${rows[0]?.state} gen=${rows[0]?.generation}`);
  check(`${tag}.5`, 'stored reference has exactly the seven identity fields',
    JSON.stringify(Object.keys(rows[0].reference).sort()) === JSON.stringify([...REF_KEYS].sort()),
    Object.keys(rows[0].reference).join(','));
  const rowText = JSON.stringify(rows[0]);
  check(`${tag}.6`, 'stored row holds no tool name, command text or marker',
    !rowText.includes(marker) && !rowText.includes('run_shell_command') && !rowText.includes('echo '));
  const preflight = await approve(s, reference);
  check(`${tag}.7`, 'approval + preflight allow the invocation', preflight.shouldProceed === true && !fs.existsSync(counter));
  const first = await s.client.startExecution(reference, reserved.executionCallId);
  check(`${tag}.8`, 'start executes the original invocation', first.executionStatus === 'success' && readLines(counter).length === 1,
    `status=${first.executionStatus} lines=${readLines(counter).length}`);
  // Retries: same provider, raw :start twice, and a restarted provider (same idempotency key).
  const again = await s.client.startExecution(reference, reserved.executionCallId);
  const rawStart = [];
  for (let i = 0; i < 2; i++)
    rawStart.push(await broker('POST', `executions/${reserved.executionCallId}:start`, {
      protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId,
    }));
  const other = newProvider();
  const otherClient = await other.getToolV2Client(s.request, { harnessSessionId: s.harness });
  const reReserved = await otherClient.prepareExecution(reference);
  const third = await otherClient.startExecution(reference, reReserved.executionCallId);
  rows = executions(s.runtimeSessionId);
  const executes = executesFor(ledger(mark), reference);
  check(`${tag}.9`, 'repeated start + restarted provider: same execution, one dispatch, one effect',
    again.executionStatus === 'success' && third.executionStatus === 'success' &&
    rawStart.every((r) => r.status === 200 && r.json.status.state === 'settled') &&
    reReserved.executionCallId === reserved.executionCallId && rows.length === 1 && rows[0].generation === 1 &&
    executes.length === 1 && readLines(counter).length === 1,
    `rows=${rows.length} gen=${rows[0]?.generation} wireExecutes=${executes.length} lines=${readLines(counter).length} rawStart=${rawStart.map((r) => r.status)}`);
  const execBody = JSON.stringify(executes[0]?.request ?? {});
  check(`${tag}.10`, 'Broker -> worker execute carries only the reference (no arguments)',
    executes.length === 1 && !execBody.includes(marker) && JSON.stringify(Object.keys(executes[0].request.operation).sort()) === '["kind","reference"]',
    `operationKeys=${Object.keys(executes[0]?.request?.operation ?? {})}`);
  const released = await s.release();
  check(`${tag}.11`, 'release succeeds and the Session is RELEASED', released.ok && released.value === true && runtimeSession(s.runtimeSessionId)?.state === 'RELEASED', brief(released));
  const tail = wire(ledger(mark)).slice(-2);
  if (mode === 'v2')
    check(`${tag}.12`, 'worker release precedes Workspace deactivation; storage ownership dropped',
      tail[0].includes('control[release] -> 200') && tail[1].includes('/v3/activation -> 200') &&
      !holders().some(([, holder]) => holder === s.runtimeSessionId), tail.join(' | '));
  rows = executions(s.runtimeSessionId);
  check(`${tag}.13`, 'durable evidence survives release', rows.length === 1 && rows[0].state === 'SETTLED' && rows[0].result?.executionStatus === 'success');
}

// ---------------------------------------------------------------------------
async function sectionB() {
  const s = await open('v1');
  const file = (n) => path.join(s.cwd, `b-${s.runtimeSessionId.slice(0, 8)}-${n}.txt`);
  // B1: start without approval.
  let prepared = await s.client.prepare(s.identity('b1'), 'write_file', { file_path: file(1), content: 'b1\n' });
  let reference = ref(prepared);
  let reserved = await s.client.prepareExecution(reference);
  const unapproved = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  check('B.1', 'start before preflight has no effect (worker refuses the execute)',
    !fs.existsSync(file(1)) && !unapproved.ok, brief(unapproved));
  say('B.1', 'row after the refused start: ' + executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`));
  prepared = await s.client.prepare(s.identity('b1b'), 'write_file', { file_path: file(11), content: 'b1b\n' });
  reference = ref(prepared);
  reserved = await s.client.prepareExecution(reference);
  const noDecisionPreflight = await attempt(() => s.client.preflight(reference));
  const noDecision = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  say('B.1b', `DEFAULT approval, preflight + start with NO confirm: preflight=${brief(noDecisionPreflight)} start=${brief(noDecision).slice(0, 60)} fileWritten=${fs.existsSync(file(11))}`);
  // B2: denied.
  prepared = await s.client.prepare(s.identity('b2'), 'write_file', { file_path: file(2), content: 'b2\n' });
  reference = ref(prepared);
  await s.client.confirm(reference, 'cancel');
  reserved = await attempt(() => s.client.prepareExecution(reference));
  const denied = reserved.ok ? await attempt(() => s.client.startExecution(reference, reserved.value.executionCallId)) : reserved;
  check('B.2', 'a cancel decision never executes', !fs.existsSync(file(2)) && (!denied.ok || ['cancelled', 'not_started'].includes(denied.value.executionStatus)), brief(denied));
  // B3: immutable decisions.
  prepared = await s.client.prepare(s.identity('b3'), 'write_file', { file_path: file(3), content: 'b3\n' });
  reference = ref(prepared);
  await s.client.confirm(reference, 'proceed_once');
  await s.client.preflight(reference);
  const same = await attempt(() => s.client.confirm(reference, 'proceed_once'));
  const flipped = await attempt(() => s.client.confirm(reference, 'cancel'));
  check('B.3', 'approval decision is immutable (same repeats, different refused)', same.ok && !flipped.ok, `same=${brief(same)} flipped=${brief(flipped)}`);
  // B4: changed arguments under the same call identity.
  const changed = await attempt(() => s.client.prepare(s.identity('b3'), 'write_file', { file_path: file(3), content: 'CHANGED\n' }));
  check('B.4', 'changed arguments under one call identity are refused', !changed.ok, brief(changed));
  // B5: tampered reference (argsDigest / invocationId) against the prepared invocation.
  const tamperedDigest = await attempt(() => s.client.preflight({ ...reference, argsDigest: 'f'.repeat(64) }));
  const tamperedId = await attempt(() => s.client.confirmation({ ...reference, invocationId: randomUUID() }));
  check('B.5', 'tampered argsDigest / invocationId are refused', !tamperedDigest.ok && !tamperedId.ok, `${brief(tamperedDigest)} | ${brief(tamperedId)}`);
  // B6: foreign Session reference, through the provider and through raw Broker HTTP.
  const foreign = { ...reference, sessionId: randomUUID() };
  const viaProvider = await attempt(() => s.client.preflight(foreign));
  const mark = ledgerMark();
  const viaBroker = await broker('POST', `tool-sessions/${s.runtimeSessionId}/control`, {
    protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, operation: { kind: 'preflight', reference: foreign },
  });
  const reserveForeign = await broker('POST', 'executions:prepare', {
    protocolVersion: 1, requestId: randomUUID(), idempotencyKey: randomUUID(), harnessSessionId: s.harness,
    runtimeSessionId: s.runtimeSessionId, turnId: foreign.promptId, toolCallId: foreign.callId, requestDigest: foreign.argsDigest, reference: foreign,
  });
  check('B.6', 'foreign Session reference refused before any worker request',
    !viaProvider.ok && viaBroker.status >= 400 && reserveForeign.status >= 400 && ledger(mark).length === 0,
    `provider=${brief(viaProvider)} broker=${viaBroker.status} ${viaBroker.code} reserve=${reserveForeign.status} ${reserveForeign.code} wire=${ledger(mark).length}`);
  // B7: unknown operation / unknown field / execute through the public control route.
  const mark2 = ledgerMark();
  const control = (operation) => broker('POST', `tool-sessions/${s.runtimeSessionId}/control`, {
    protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, operation });
  const unknownKind = await control({ kind: 'teleport' });
  const extraField = await control({ kind: 'manifest', extra: true });
  const execute = await control({ kind: 'execute', reference });
  const acquire = await control({ kind: 'acquire' });
  const release = await control({ kind: 'release' });
  check('B.7', 'public control route refuses unknown kinds/fields and transport-only operations before dispatch',
    [unknownKind, extraField, execute, acquire, release].every((r) => r.status === 400) && ledger(mark2).length === 0,
    `${[unknownKind, extraField, execute, acquire, release].map((r) => `${r.status} ${r.code}`).join(' | ')} wire=${ledger(mark2).length}`);
  check('B.8', 'after all refusals the approved invocation still runs once',
    (await s.client.startExecution(reference, (await s.client.prepareExecution(reference)).executionCallId)).executionStatus === 'success' &&
    fs.readFileSync(file(3), 'utf8') === 'b3\n');
  // B9: file-history owner must be this Session (raw Broker HTTP, fresh unbound Session).
  const unbound = await open('v1', { bind: false, begin: false });
  const mark3 = ledgerMark();
  const bind = (binding) => broker('POST', `tool-sessions/${unbound.runtimeSessionId}/control`, {
    protocolVersion: 1, requestId: randomUUID(), harnessSessionId: unbound.harness, operation: { kind: 'bind-history', binding } });
  const good = { ownerSessionId: unbound.harness, ownerRuntimeSessionId: unbound.runtimeSessionId, executionCwd: unbound.cwd, snapshots: [] };
  const foreignOwner = await bind({ ...good, ownerSessionId: s.harness });
  const foreignRuntime = await bind({ ...good, ownerRuntimeSessionId: s.runtimeSessionId });
  const refusedBeforeWorker = ledger(mark3).length === 0;
  const otherCwd = await bind({ ...good, executionCwd: '/tmp' });
  const accepted = await bind(good);
  check('B.9', 'file-history binding: foreign owner refused before any worker request; foreign directory refused; own binding accepted',
    foreignOwner.status >= 400 && foreignRuntime.status >= 400 && refusedBeforeWorker && otherCwd.status >= 400 && accepted.status === 200,
    `owner=${foreignOwner.status} ${foreignOwner.code} runtime=${foreignRuntime.status} ${foreignRuntime.code} wireBeforeCwd=${refusedBeforeWorker ? 0 : '>0'} cwd=${otherCwd.status} ${otherCwd.code} own=${accepted.status}`);
  say('B', `release ${brief(await unbound.release())}`);
  say('B', `release ${brief(await s.release())}`);
}

// ---------------------------------------------------------------------------
async function sectionC(mode) {
  const tag = `C-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `c-${s.runtimeSessionId.slice(0, 8)}.txt`);
  const prepared = await s.client.prepare(s.identity('c1'), 'write_file', { file_path: file, content: 'provider\n' });
  const reference = ref(prepared);
  const reserved = await s.client.prepareExecution(reference);
  await approve(s, reference);
  const base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId };
  const payloadJson = JSON.stringify({ toolName: 'write_file', input: { file_path: file, content: 'raw\n' } });
  let mark = ledgerMark();
  const mixed = await broker('POST', `executions/${reserved.executionCallId}:start`, { ...base, requestId: randomUUID(), payloadJson });
  check(`${tag}.1`, 'provider reservation + payloadJson start fails before dispatch',
    mixed.status >= 400 && mixed.status < 500 && !fs.existsSync(file) && ledger(mark).length === 0 && executions(s.runtimeSessionId)[0].state === 'PREPARED',
    `${mixed.status} ${mixed.code} wire=${ledger(mark).length}`);
  const extra = await broker('POST', `executions/${reserved.executionCallId}:start`, { ...base, requestId: randomUUID(), toolName: 'write_file' });
  check(`${tag}.2`, 'start with an unknown field is refused', extra.status === 400 && !fs.existsSync(file), `${extra.status} ${extra.code}`);
  // Raw four-field reservation in ANOTHER Runtime Session of the same Harness Session is covered in section G;
  // here: raw reservation shape checks that never reach a worker.
  const { createHash } = await import('node:crypto');
  const digest = `sha256:${createHash('sha256').update(payloadJson).digest('hex')}`;
  const rawReference = { sessionId: s.runtimeSessionId, promptId: s.promptId, callId: 'c-raw', argsDigest: digest };
  const reserveBody = (reference, requestDigest, extraFields = {}) => ({
    ...base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: reference.promptId, toolCallId: reference.callId,
    requestDigest, reference, ...extraFields,
  });
  mark = ledgerMark();
  const smuggled = await broker('POST', 'executions:prepare', reserveBody(reference, reference.argsDigest, { payloadJson }));
  const smuggledRef = await broker('POST', 'executions:prepare', reserveBody({ ...reference, toolName: 'write_file' }, reference.argsDigest));
  check(`${tag}.3`, 'reservation refuses payload/tool fields beside or inside the reference',
    smuggled.status === 400 && smuggledRef.status === 400, `${smuggled.status} ${smuggled.code} | ${smuggledRef.status} ${smuggledRef.code}`);
  const immediate = await broker('POST', 'executions', reserveBody({ ...reference, callId: 'c-imm' }, reference.argsDigest));
  check(`${tag}.4`, 'immediate raw route refuses a seven-field provider reference', immediate.status === 400, `${immediate.status} ${immediate.code}`);
  const rawReserved = await broker('POST', 'executions:prepare', reserveBody(rawReference, digest));
  say(`${tag}`, `raw reserve in provider-owned Session: ${rawReserved.status} ${rawReserved.code ?? ''} ${JSON.stringify(rawReserved.json).slice(0, 200)}`);
  if (rawReserved.status === 200) {
    const noPayload = await broker('POST', `executions/${rawReserved.json.executionCallId}:start`, { ...base, requestId: randomUUID() });
    check(`${tag}.5`, 'raw reservation + start without payloadJson fails before dispatch',
      noPayload.status === 400 && ledger(mark).length === 0, `${noPayload.status} ${noPayload.code} wire=${ledger(mark).length}`);
    mark = ledgerMark();
    const rawStart = await broker('POST', `executions/${rawReserved.json.executionCallId}:start`, { ...base, requestId: randomUUID(), payloadJson });
    let row;
    for (let i = 0; i < 100; i++) {
      row = executions(s.runtimeSessionId).find((r) => r.id === rawReserved.json.executionCallId);
      if (row.state === 'SETTLED' || row.state === 'UNKNOWN') break;
      await sleep(100);
    }
    check(`${tag}.6`, 'raw tool call cannot enter a provider-owned Session (no effect)',
      !fs.existsSync(file) && row.result?.executionStatus !== 'success',
      `start=${rawStart.status} ${rawStart.code ?? ''} row=${row.state}/${row.status} result=${JSON.stringify(row.result)?.slice(0, 200)} wire=${wire(ledger(mark)).join(',')}`);
  }
  const started = await s.client.startExecution(reference, reserved.executionCallId);
  check(`${tag}.7`, 'the provider invocation is unaffected by the refused mixes', started.executionStatus === 'success' && fs.readFileSync(file, 'utf8') === 'provider\n');
  say(tag, `release ${brief(await s.release())}`);
  say(tag, executions(s.runtimeSessionId).map((r) => `${Object.keys(r.reference).length}-field ${r.state}/${r.status}`));
}

// ---------------------------------------------------------------------------
async function sectionD(mode) {
  const tag = `D-${mode}`;
  // D1: unreserved preparation is cleaned up by release.
  let s = await open(mode);
  const f1 = path.join(s.cwd, `d1-${s.runtimeSessionId.slice(0, 8)}.txt`);
  let prepared = await s.client.prepare(s.identity('d1'), 'write_file', { file_path: f1, content: 'd1\n' });
  let mark = ledgerMark();
  let released = await s.release();
  check(`${tag}.1`, 'release cleans up an unreserved preparation without effect',
    released.ok && released.value === true && !fs.existsSync(f1) && executions(s.runtimeSessionId).length === 0, brief(released));
  const late = await broker('POST', 'executions:prepare', {
    protocolVersion: 1, requestId: randomUUID(), idempotencyKey: randomUUID(), harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId,
    turnId: prepared.promptId, toolCallId: prepared.callId, requestDigest: prepared.argsDigest, reference: ref(prepared),
  });
  check(`${tag}.2`, 'a released Session refuses a late reservation', late.status >= 400 && !fs.existsSync(f1), `${late.status} ${late.code}`);

  // D2: durable reservation blocks release until it is cancelled.
  s = await open(mode);
  const f2 = path.join(s.cwd, `d2-${s.runtimeSessionId.slice(0, 8)}.txt`);
  prepared = await s.client.prepare(s.identity('d2'), 'write_file', { file_path: f2, content: 'd2\n' });
  let reference = ref(prepared);
  let reserved = await s.client.prepareExecution(reference);
  const busyProvider = newProvider();
  await busyProvider.getToolV2Client(s.request, { harnessSessionId: s.harness });
  const blocked = await attempt(() => busyProvider.release(s.runtimeSessionId, s.request));
  check(`${tag}.3`, 'release with an uncancelled durable reservation is refused; Session stays READY',
    !blocked.ok && blocked.code === 'runtime_session_busy' && runtimeSession(s.runtimeSessionId)?.state === 'READY', brief(blocked));
  mark = ledgerMark();
  const cancelled = await attempt(() => s.client.cancel(reference));
  let rows = executions(s.runtimeSessionId);
  check(`${tag}.4`, 'cancel before start settles cancelled with no effect and no execute on the wire',
    cancelled.ok && cancelled.value.state === 'settled' && cancelled.value.result.executionStatus === 'cancelled' &&
    rows[0].state === 'SETTLED' && rows[0].generation === 0 && !fs.existsSync(f2) && !ledger(mark).some((e) => e.kind === 'execute'),
    `${brief(cancelled)} wire=${wire(ledger(mark)).join(',')}`);
  const lateStart = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  check(`${tag}.5`, 'start after cancel never executes', !fs.existsSync(f2) && (!lateStart.ok || lateStart.value.executionStatus === 'cancelled'), brief(lateStart));
  released = await s.release();
  check(`${tag}.6`, 'release succeeds after the cancel', released.ok && released.value === true, brief(released));

  // D3: running work blocks release; cancellation settles it; release waits for cleanup.
  s = await open(mode);
  const f3 = path.join(s.cwd, `d3-${s.runtimeSessionId.slice(0, 8)}.txt`);
  prepared = await s.client.prepare(s.identity('d3'), 'run_shell_command', shell(`perl -e "sleep 20"; echo late >> ${f3}`));
  reference = ref(prepared);
  reserved = await s.client.prepareExecution(reference);
  await approve(s, reference);
  const running = attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  for (let i = 0; i < 100 && executions(s.runtimeSessionId)[0].state !== 'EXECUTING'; i++) await sleep(100);
  const second = newProvider();
  await second.getToolV2Client(s.request, { harnessSessionId: s.harness });
  const active = await attempt(() => second.release(s.runtimeSessionId, s.request));
  check(`${tag}.7`, 'release during running work is refused; Session stays READY',
    !active.ok && active.code === 'runtime_session_busy' && runtimeSession(s.runtimeSessionId)?.state === 'READY', brief(active));
  const t0 = Date.now();
  const stop = await attempt(() => s.client.cancel(reference));
  const outcome = await running;
  check(`${tag}.8`, 'cancel of running work settles cancelled well before the command would finish',
    outcome.ok && outcome.value.executionStatus === 'cancelled' && Date.now() - t0 < 10_000 && !fs.existsSync(f3),
    `cancel=${brief(stop).slice(0, 90)} result=${outcome.ok ? outcome.value.executionStatus : brief(outcome)} ${Date.now() - t0}ms`);
  released = await s.release();
  check(`${tag}.9`, 'release succeeds once the work settled', released.ok && released.value === true, brief(released));
  await sleep(1500);
  check(`${tag}.10`, 'the cancelled command left no late effect', !fs.existsSync(f3));

  // D4: after release — no new work, idempotent release, evidence kept, conflicting owner refused.
  const again = await attempt(() => s.provider.release(s.runtimeSessionId, s.request));
  const rawRelease = await broker('POST', `tool-sessions/${s.runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness });
  check(`${tag}.11`, 'release is idempotent (provider and Broker)', again.ok && again.value === true && rawRelease.status === 200 && rawRelease.json.released === true, `${brief(again)} raw=${rawRelease.status}`);
  const fresh = newProvider();
  const reacquire = await attempt(() => fresh.getToolV2Client(s.request, { harnessSessionId: s.harness }));
  const control = await broker('POST', `tool-sessions/${s.runtimeSessionId}/control`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, operation: { kind: 'manifest' } });
  check(`${tag}.12`, 'a released Runtime Session admits no new acquire or control', !reacquire.ok && control.status >= 400,
    `acquire=${brief(reacquire)} control=${control.status} ${control.code}`);
  rows = executions(s.runtimeSessionId);
  check(`${tag}.13`, 'evidence of the cancelled execution is preserved', rows.length === 1 && rows[0].state === 'SETTLED' && rows[0].result?.executionStatus === 'cancelled');
  const observe = await broker('GET', `executions/${reserved.executionCallId}?requestId=${randomUUID()}&harnessSessionId=${s.harness}&runtimeSessionId=${s.runtimeSessionId}`);
  say(tag, `Broker HTTP observation after release: ${observe.status} ${observe.code ?? ''}`);

  // D5: conflicting owner.
  s = await open(mode);
  const intruder = mode === 'v1' ? await createSession() : (await newWorkspace()).harness;
  const stolenAcquire = await broker('POST', 'tool-sessions:acquire', { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: intruder, runtimeSessionId: s.runtimeSessionId, turnKind: 'bootstrap' });
  const stolenRelease = await broker('POST', `tool-sessions/${s.runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: intruder });
  const stolenControl = await broker('POST', `tool-sessions/${s.runtimeSessionId}/control`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: intruder, operation: { kind: 'manifest' } });
  const otherTurn = await broker('POST', 'tool-sessions:acquire', { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId, turnKind: 'continuation' });
  check(`${tag}.14`, 'another Harness Session / turn kind cannot acquire, control or release it',
    [stolenAcquire, stolenRelease, stolenControl, otherTurn].every((r) => r.status >= 400 && r.status < 500) && runtimeSession(s.runtimeSessionId)?.state === 'READY',
    [stolenAcquire, stolenRelease, stolenControl, otherTurn].map((r) => `${r.status} ${r.code}`).join(' | '));
  say(tag, `release ${brief(await s.release())}`);
}

// ---------------------------------------------------------------------------
const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
for (const section of sections) {
  for (const mode of section === 'B' ? ['v1'] : modes) {
    say('SECTION', `${section} ${mode}`);
    workspaceHarness = undefined;
    try {
      if (section === 'A') await sectionA(mode);
      if (section === 'B') await sectionB();
      if (section === 'C') await sectionC(mode);
      if (section === 'D') await sectionD(mode);
    } catch (error) {
      check(`${section}-${mode}.x`, 'section completed', false, `${error?.name}: ${error?.message} code=${error?.code} status=${error?.status}\n${error?.stack?.split('\n').slice(1, 4).join('\n')}`);
    }
  }
}
const ok = summary();
for (const p of providers) p.dispose();
process.exit(ok ? 0 : 1);
