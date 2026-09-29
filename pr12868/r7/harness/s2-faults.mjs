// PR #12868 fault probes on the real stack (MySQL + Spring Broker + workers).
// usage: node s2-faults.mjs <sections e.g. E,F,G,I> <storage letters for v2, e.g. c,d>
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, clearHooks, createSession, executions,
  holders, hook, ledger, ledgerMark, loadProvider, openLog, prepareRequest, readLines, runtimeSession, say,
  seedRegistry, sleep, sql, summary, wire, workerPids, launches,
} from './lib.mjs';

const sections = (process.argv[2] ?? 'E,F,G,I').split(',');
const letters = (process.argv[3] ?? 'c,d').split(',');
openLog(`s2-faults-${ARM}-${sections.join('')}`);
const { BrokerManagedRuntimeProvider } = await loadProvider();
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];
function newProvider() {
  const p = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  providers.push(p);
  return p;
}
let letterIndex = 0;
async function workspaceHarness() {
  const letter = letters[letterIndex++ % letters.length];
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  return { workspace: ws, letter, harness: await createSession(ws), cwd: fs.realpathSync(path.join(ROOTS, letter, 'child')) };
}
async function open(mode, given) {
  const where = given ?? (mode === 'v1'
    ? { harness: await createSession(), cwd: fs.realpathSync(path.join(ROOTS, 'plain')) }
    : await workspaceHarness());
  const provider = newProvider();
  const runtimeSessionId = randomUUID();
  const request = prepareRequest(runtimeSessionId, 'bootstrap', where.cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: where.harness });
  const s = { ...where, mode, provider, runtimeSessionId, request, client, promptId: `p-${runtimeSessionId.slice(0, 8)}` };
  await client.fileHistory.bind({ ownerSessionId: s.harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: s.cwd, snapshots: [] });
  s.manifest = await client.manifest();
  s.identity = (callId) => ({
    sessionId: runtimeSessionId, promptId: s.promptId, callId,
    capabilityDigest: s.manifest.capabilityDigest, policyRevision: s.manifest.policyRevision,
  });
  await client.beginTurn(s.identity('turn'));
  s.release = () => attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  s.ready = async (callId, toolName, input) => {
    const prepared = await client.prepare(s.identity(callId), toolName, input);
    const reference = ref(prepared);
    const reserved = await client.prepareExecution(reference);
    if (mode === 'v1') await client.confirm(reference, 'proceed_once');
    return { reference, reserved };
  };
  return s;
}
const shell = (command) => ({ command, is_background: false });
const rowOf = (s, id) => executions(s.runtimeSessionId).find((r) => r.id === id);
const executesFor = (entries, reference) =>
  entries.filter((e) => e.kind === 'execute' && e.request?.operation?.reference?.invocationId === reference.invocationId);

// E: a definite worker refusal of execute, and what it leaves behind.
async function sectionE(mode) {
  const tag = `E-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `e-${s.runtimeSessionId.slice(0, 8)}.txt`);
  const { reference, reserved } = await s.ready('e1', 'write_file', { file_path: file, content: 'e1\n' });
  const mark = ledgerMark();
  const refused = await attempt(() => s.client.startExecution(reference, reserved.executionCallId)); // no preflight yet
  const entry = executesFor(ledger(mark), reference)[0];
  say(tag, `worker answer to execute: HTTP ${entry?.status} ${JSON.stringify(entry?.response)}`);
  const row = rowOf(s, reserved.executionCallId);
  check(`${tag}.1`, 'worker refuses execute-before-preflight definitively (HTTP 409 body, no effect)',
    entry?.status === 409 && !fs.existsSync(file) && !refused.ok, brief(refused));
  say(tag, `Broker row after the definite refusal: ${row.state}/${row.status} generation=${row.generation}`);
  await s.client.preflight(reference).catch((e) => say(tag, `late preflight: ${e.code ?? e.message}`));
  const mark2 = ledgerMark();
  const retry = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  const rawRetry = await broker('POST', `executions/${reserved.executionCallId}:start`, {
    protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId });
  check(`${tag}.2`, 'an UNKNOWN record is never replayed (no further execute on the wire, no effect)',
    executesFor(ledger(mark2), reference).length === 0 && !fs.existsSync(file) && rawRetry.status === 409,
    `retry=${brief(retry).slice(0, 80)} raw=${rawRetry.status} ${rawRetry.code}`);
  const cancel = await attempt(() => s.client.cancel(reference));
  const resolve = await broker('POST', `executions/${reserved.executionCallId}:resolve`, {
    protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId, resolution: 'confirmed_not_executed' });
  const released = await s.release();
  say(tag, `cancel=${brief(cancel).slice(0, 100)} | resolve=${resolve.status} ${resolve.code} | release=${brief(released).slice(0, 100)}`);
  say(tag, `row=${rowOf(s, reserved.executionCallId).state} session=${runtimeSession(s.runtimeSessionId)?.state}`);
  const stuck = !released.ok && released.code === 'runtime_session_busy' && rowOf(s, reserved.executionCallId).state === 'UNKNOWN';
  say(tag, `OBSERVED: definite refusal -> UNKNOWN -> Session unreleasable = ${stuck}`);
  if (mode === 'v2') {
    const held = holders().filter(([, holder]) => holder === s.runtimeSessionId);
    say(tag, `storage holder rows for this Runtime Session: ${JSON.stringify(held)}`);
    const next = newProvider();
    const nextId = randomUUID();
    const nextAcquire = await attempt(() =>
      next.getToolV2Client(prepareRequest(nextId, 'bootstrap', s.cwd), { harnessSessionId: s.harness }));
    say(tag, `next Runtime Session (same Harness Session, same storage) acquire: ${brief(nextAcquire).slice(0, 120)}`);
    const sibling = await createSession(s.workspace);
    const siblingAcquire = await attempt(() =>
      newProvider().getToolV2Client(prepareRequest(randomUUID(), 'bootstrap', s.cwd), { harnessSessionId: sibling }));
    say(tag, `sibling Harness Session (same Workspace) acquire: ${brief(siblingAcquire).slice(0, 120)}`);
    return { stuck, held: held.length, nextAcquire, siblingAcquire };
  }
  return { stuck };
}

// F: the execute reply is lost between worker and Broker.
// Until 9cb9dc86e8 the record of such a call stayed UNKNOWN. Since then the
// Broker asks the worker, and the result the worker kept settles the record.
async function sectionF(mode) {
  const tag = `F-${mode}`;
  const s = await open(mode);
  const counter = path.join(s.cwd, `f-${s.runtimeSessionId.slice(0, 8)}.txt`);
  const { reference, reserved } = await s.ready('f1', 'run_shell_command', shell(`echo once >> ${counter}`));
  await s.client.preflight(reference);
  await hook({ kind: 'execute', action: 'drop-reply', count: 1 });
  const mark = ledgerMark();
  const lost = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  await sleep(500);
  const row = rowOf(s, reserved.executionCallId);
  check(`${tag}.1`, 'lost execute reply: the tool ran once, and the record settles from the result the worker kept',
    lost.ok && lost.value.executionStatus === 'success' && row.state === 'SETTLED' && readLines(counter).length === 1,
    `${brief(lost).slice(0, 90)} row=${row.state} lines=${readLines(counter).length}`);
  await clearHooks();
  const again = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  const fresh = newProvider();
  const freshClient = await fresh.getToolV2Client(s.request, { harnessSessionId: s.harness });
  const freshReserve = await attempt(() => freshClient.prepareExecution(reference));
  const freshStart = await attempt(() => freshClient.startExecution(reference));
  const inspect = await attempt(() => fresh.inspectExecution({ harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId, executionCallId: reserved.executionCallId }));
  const reconcile = await attempt(() => fresh.reconcileExecution({ harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId, executionCallId: reserved.executionCallId }));
  await sleep(500);
  check(`${tag}.2`, 'retries and a restarted provider never replay: one execute on the wire, one effect, the settled result every time',
    executesFor(ledger(mark), reference).length === 1 && readLines(counter).length === 1 &&
    rowOf(s, reserved.executionCallId).state === 'SETTLED' && again.ok && again.value.executionStatus === 'success' &&
    freshStart.ok && freshStart.value.executionStatus === 'success' && inspect.ok && inspect.value.outcome === 'known',
    `executes=${executesFor(ledger(mark), reference).length} lines=${readLines(counter).length} row=${rowOf(s, reserved.executionCallId).state} reReserve=${brief(freshReserve).slice(0, 70)} inspect=${JSON.stringify(inspect.value)} reconcile=${JSON.stringify(reconcile.value)}`);
  say(tag, `wire: ${wire(ledger(mark)).join(', ')}`);
  const released = await s.release();
  say(tag, `release afterwards: ${brief(released).slice(0, 110)} session=${runtimeSession(s.runtimeSessionId)?.state}`);
}

// G: the worker dies while an invocation is prepared and reserved.
async function sectionG(mode) {
  const tag = `G-${mode}`;
  const before = new Set(workerPids().map((w) => w.pid));
  const s = await open(mode);
  const mine = workerPids().filter((w) => !before.has(w.pid));
  const file = path.join(s.cwd, `g-${s.runtimeSessionId.slice(0, 8)}.txt`);
  const { reference, reserved } = await s.ready('g1', 'write_file', { file_path: file, content: 'g1\n' });
  await s.client.preflight(reference);
  say(tag, `worker for this Harness Session: ${JSON.stringify(mine)}`);
  if (mine.length !== 1) {
    check(`${tag}.0`, 'exactly one new worker identified', false, JSON.stringify(mine));
    return;
  }
  process.kill(mine[0].pid, 'SIGKILL');
  await sleep(1500);
  const launchesBefore = launches().length;
  const mark = ledgerMark();
  const started = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  await sleep(1000);
  const row = rowOf(s, reserved.executionCallId);
  check(`${tag}.1`, 'start after worker death fails closed: no effect, nothing replayed from the stored reference',
    !fs.existsSync(file) && (!started.ok || started.value.executionStatus !== 'success') && row.result?.executionStatus !== 'success',
    `${brief(started).slice(0, 100)} row=${row.state}/${row.status} wire=${wire(ledger(mark)).join(',') || '<none>'} newLaunches=${launches().length - launchesBefore}`);
  const control = await attempt(() => s.client.manifest());
  const released = await s.release();
  say(tag, `control after death: ${brief(control).slice(0, 100)}`);
  say(tag, `release after death: ${brief(released).slice(0, 100)} session=${runtimeSession(s.runtimeSessionId)?.state} row=${rowOf(s, reserved.executionCallId).state}`);
  if (mode === 'v2') say(tag, `storage holders: ${JSON.stringify(holders().filter(([, h]) => h === s.runtimeSessionId))}`);
  // A new Runtime Session of the same Harness Session afterwards.
  const next = await attempt(() => open(mode, s));
  say(tag, `next Runtime Session on the same Harness Session: ${next.ok ? 'acquired' : brief(next).slice(0, 120)} launches=${launches().length - launchesBefore}`);
  if (next.ok) {
    const file2 = path.join(s.cwd, `g2-${next.value.runtimeSessionId.slice(0, 8)}.txt`);
    const again = await next.value.ready('g2', 'write_file', { file_path: file2, content: 'g2\n' });
    await next.value.client.preflight(again.reference);
    const result = await attempt(() => next.value.client.startExecution(again.reference, again.reserved.executionCallId));
    check(`${tag}.2`, 'a replacement worker serves new provider work; the dead invocation stays unexecuted',
      result.ok && result.value.executionStatus === 'success' && fs.existsSync(file2) && !fs.existsSync(file), brief(result).slice(0, 80));
    say(tag, `release ${brief(await next.value.release())}`);
  }
}

// I: invalid tool arguments at prepare — what reaches the caller.
async function sectionI(mode) {
  const tag = `I-${mode}`;
  const s = await open(mode);
  const mark = ledgerMark();
  const viaProvider = await attempt(() => s.client.prepare(s.identity('i1'), 'write_file', { file_path: 'relative/path.txt', content: 'x' }));
  const workerAnswer = ledger(mark).find((e) => e.kind === 'prepare');
  const viaBroker = await broker('POST', `tool-sessions/${s.runtimeSessionId}/control`, {
    protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness,
    operation: { kind: 'prepare', identity: s.identity('i2'), toolName: 'write_file', input: { file_path: 'relative/path.txt', content: 'x' } },
  });
  const unknownTool = await broker('POST', `tool-sessions/${s.runtimeSessionId}/control`, {
    protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness,
    operation: { kind: 'prepare', identity: s.identity('i3'), toolName: 'no_such_tool', input: {} },
  });
  say(tag, `worker -> Broker: HTTP ${workerAnswer?.status} ${JSON.stringify(workerAnswer?.response)}`);
  say(tag, `Broker -> caller: HTTP ${viaBroker.status} ${JSON.stringify(viaBroker.json)}`);
  say(tag, `provider error seen by the Harness: ${brief(viaProvider)}`);
  say(tag, `unknown tool: HTTP ${unknownTool.status} ${JSON.stringify(unknownTool.json)}`);
  say(tag, `release ${brief(await s.release())}`);
}

// H: races — concurrent starts, and start racing release.
async function sectionH(mode) {
  const tag = `H-${mode}`;
  let s = await open(mode);
  const counter = path.join(s.cwd, `h-${s.runtimeSessionId.slice(0, 8)}.txt`);
  let { reference, reserved } = await s.ready('h1', 'run_shell_command', shell(`echo once >> ${counter}`));
  await s.client.preflight(reference);
  let mark = ledgerMark();
  const body = () => ({ protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId });
  const burst = await Promise.all(Array.from({ length: 24 }, () => broker('POST', `executions/${reserved.executionCallId}:start`, body())));
  for (let i = 0; i < 100 && rowOf(s, reserved.executionCallId).state !== 'SETTLED'; i++) await sleep(50);
  check(`${tag}.1`, '24 concurrent starts: one dispatch on the wire, one effect, every answer 200',
    executesFor(ledger(mark), reference).length === 1 && readLines(counter).length === 1 && burst.every((r) => r.status === 200) &&
    rowOf(s, reserved.executionCallId).generation === 1,
    `executes=${executesFor(ledger(mark), reference).length} lines=${readLines(counter).length} statuses=${[...new Set(burst.map((r) => r.status))]}`);
  say(tag, `release ${brief(await s.release())}`);
  // start racing release, repeated on fresh Runtime Sessions of one Harness Session.
  const tally = {};
  let violations = 0;
  const where = { harness: s.harness, cwd: s.cwd, workspace: s.workspace, letter: s.letter };
  for (let i = 0; i < 12; i++) {
    s = await open(mode, where);
    const file = path.join(s.cwd, `h2-${s.runtimeSessionId.slice(0, 8)}.txt`);
    ({ reference, reserved } = await s.ready('h2', 'run_shell_command', shell(`echo raced >> ${file}`)));
    await s.client.preflight(reference);
    const base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId };
    const [start, release] = await Promise.all([
      broker('POST', `executions/${reserved.executionCallId}:start`, { ...base, requestId: randomUUID() }),
      (async () => { await sleep(i % 4); return broker('POST', `tool-sessions/${s.runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness }); })(),
    ]);
    for (let k = 0; k < 100 && !['SETTLED', 'UNKNOWN', 'PREPARED'].includes(rowOf(s, reserved.executionCallId).state); k++) await sleep(50);
    await sleep(200);
    const row = rowOf(s, reserved.executionCallId);
    const session = runtimeSession(s.runtimeSessionId)?.state;
    const lines = readLines(file).length;
    const key = `start=${start.status}${start.code ? ' ' + start.code : ''} release=${release.status}${release.code ? ' ' + release.code : ''} row=${row.state}/${row.status} session=${session} effect=${lines}`;
    tally[key] = (tally[key] ?? 0) + 1;
    // Invariants: a released Session has no unsettled record; an effect implies a success record.
    if ((session === 'RELEASED' && row.state !== 'SETTLED') || (lines === 1 && row.result?.executionStatus !== 'success') || lines > 1) violations++;
    if (session !== 'RELEASED') {
      if (row.state === 'PREPARED') await s.client.cancel(reference).catch(() => {});
      await s.release();
    }
  }
  for (const [key, n] of Object.entries(tally)) say(tag, `${n}x ${key}`);
  check(`${tag}.2`, 'start racing release (12 rounds): never a released Session with an unsettled record, never an unrecorded effect', violations === 0, `violations=${violations}`);
}

const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
const observed = {};
for (const section of sections) {
  for (const mode of modes) {
    say('SECTION', `${section} ${mode}`);
    try {
      if (section === 'E') observed[`E-${mode}`] = await sectionE(mode);
      if (section === 'F') await sectionF(mode);
      if (section === 'G') await sectionG(mode);
      if (section === 'I') await sectionI(mode);
      if (section === 'H') await sectionH(mode);
    } catch (error) {
      check(`${section}-${mode}.x`, 'section completed', false, `${error?.name}: ${error?.message} code=${error?.code} status=${error?.status}\n${error?.stack?.split('\n').slice(1, 4).join('\n')}`);
    } finally {
      await clearHooks();
    }
  }
}
say('OBSERVED', observed);
const ok = summary();
for (const p of providers) p.dispose();
process.exit(ok ? 0 : 1);
