// PR #13118 real-chain probes: each guard the PR pins, observed through the
// real Spring server (embedded Runtime Broker, MySQL 8.4.7), the production
// HttpRuntimeTransport and a real worker process launched from the bundle.
// Driven by the BUILT TypeScript BrokerManagedRuntimeProvider.
//
// usage: node s13118.mjs <sections e.g. A,B,C,D,E,F> [label]
//   A  H8   status cursor (afterSequence) on a running Shell call
//   B  Q6   Shell directory that does not exist
//   C  T8   release while the worker has a call in flight (Broker path, then rig-sent)
//   D  T18  worker 413 managed_runtime_provider_too_large as the Broker sees it
//   E  P5   status cursor 2^53 in the worker's answer as the Broker sees it
//   F  I6   uppercase Runtime Session UUID end to end
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, attempt, brief, check, createSession, executions,
  ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, sleep,
  summary, wire, hook, clearHooks, inject, workerPortOf, readLines, broker,
} from './lib.mjs';

const sections = (process.argv[2] ?? 'A,B,C,D,E,F').split(',');
const label = process.argv[3] ?? 'head';
openLog(`s13118-${label}-${sections.join('')}`);
say('RUN', `label=${label} worker=${process.env.WORKER_DIST ?? 'wt-pr/dist'} jar=${process.env.JAR_LABEL ?? 'pr'} ${new Date().toISOString()}`);
const { BrokerManagedRuntimeProvider } = await loadProvider();
const NODE = '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node';
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];
const newProvider = () => {
  const p = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  providers.push(p);
  return p;
};

async function open({ runtimeSessionId = randomUUID() } = {}) {
  const provider = newProvider();
  const harness = await createSession();
  const cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
  const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: harness });
  const s = { provider, harness, cwd, runtimeSessionId, request, client, promptId: `p-${runtimeSessionId.slice(0, 8)}` };
  await client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] });
  s.manifest = await client.manifest();
  s.identity = (callId) => ({
    sessionId: runtimeSessionId,
    promptId: s.promptId,
    callId,
    capabilityDigest: s.manifest.capabilityDigest,
    policyRevision: s.manifest.policyRevision,
  });
  await client.beginTurn(s.identity('turn'));
  s.release = () => attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  s.envelope = (operation) => ({
    protocolVersion: 1,
    providerProtocol: 'managed-runtime-provider/1',
    session: { runtimeSessionId, turnKind: 'bootstrap', harnessSessionId: harness },
    operation,
  });
  return s;
}
// v1 (plain) Sessions ask for approval: confirm, then preflight.
async function ready(s, callId, tool, input) {
  const reference = ref(await s.client.prepare(s.identity(callId), tool, input));
  const reserved = await s.client.prepareExecution(reference);
  await s.client.confirm(reference, 'proceed_once');
  const preflight = await s.client.preflight(reference);
  return { reference, reserved, preflight };
}
// A Shell call that prints `lines` chunks, then waits for a gate file.
function gatedScript(s, tag, lines) {
  const gate = path.join(s.cwd, `gate-${tag}-${s.runtimeSessionId.slice(0, 8)}`);
  const script = path.join(s.cwd, `emit-${tag}-${s.runtimeSessionId.slice(0, 8)}.cjs`);
  const started = path.join(s.cwd, `started-${tag}-${s.runtimeSessionId.slice(0, 8)}`);
  fs.writeFileSync(script, `const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(started)}, String(process.pid));
let i = 0;
const out = setInterval(() => {
  process.stdout.write('chunk-' + (++i) + '\\n');
  if (i === ${lines}) {
    clearInterval(out);
    const wait = setInterval(() => { if (fs.existsSync(${JSON.stringify(gate)})) { clearInterval(wait); process.stdout.write('done\\n'); } }, 50);
  }
}, 400);`);
  return { gate, command: `"${NODE}" "${script}"`, open: () => fs.writeFileSync(gate, ''), running: () => fs.existsSync(started) };
}
async function until(what, fn, ms = 120_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}
const seqs = (status) => (status.progress ?? []).map((e) => e.seq);

// ---------------------------------------------------------------------------
async function sectionA() {
  const s = await open();
  const g = gatedScript(s, 'a', 4);
  const { reference } = await ready(s, 'a1', 'run_shell_command', { command: g.command, is_background: false });
  const running = s.client.startExecution(reference).catch((e) => e);
  const mine = (e) => e.kind === 'status' && e.request?.operation?.reference?.invocationId === reference.invocationId;
  // The Broker reads the worker only after its execute request (30 s) ends.
  const seen = await until('a worker status answer with four progress events', async () =>
    ledger().filter(mine).find((e) => !e.injected && (e.response?.result?.progress ?? []).length >= 4));
  const port = workerPortOf(s.runtimeSessionId);
  const brokerSeqs = seen.response.result.progress.map((p) => p.seq);
  const cursor = brokerSeqs[2];
  // A.1: the production path. The caller's cursor, as the Broker handles it.
  const mark = ledgerMark();
  const viaBroker = await s.client.status(reference, cursor);
  const sent = ledger(mark).filter((e) => mine(e) && !e.injected);
  say('A1', `caller status(afterSeq=${cursor}) via Broker -> state=${viaBroker.state} lastSeq=${viaBroker.lastSeq} progress=${JSON.stringify(seqs(viaBroker))}; worker requests it caused: ${sent.length} with afterSequence=${[...new Set(sent.map((e) => e.request.operation.afterSequence))].join(',')}; worker answered seqs=${JSON.stringify(sent[0]?.response?.result?.progress?.map((p) => p.seq))}`);
  check('A1.1', 'Broker path: the caller cursor is not forwarded (worker is asked with afterSequence 0) and the answer carries no progress',
    sent.length >= 1 && sent.every((e) => e.request.operation.afterSequence === 0) && seqs(viaBroker).length === 0,
    `afterSequence=${sent.map((e) => e.request.operation.afterSequence)} progress=${seqs(viaBroker).length}`);
  // A.2: the worker's own contract, asked by the rig with the Broker's credentials.
  const all = await inject(port, 'provider/v1/control', s.envelope({ kind: 'status', reference, afterSequence: 0 }));
  const after = await inject(port, 'provider/v1/control', s.envelope({ kind: 'status', reference, afterSequence: cursor }));
  const allSeqs = (all.json?.result?.progress ?? []).map((p) => p.seq);
  const afterSeqs = (after.json?.result?.progress ?? []).map((p) => p.seq);
  say('A2', `rig-sent status to worker :${port}: afterSequence=0 -> ${all.status} lastSeq=${all.json?.result?.lastSeq} seqs=${JSON.stringify(allSeqs)}; afterSequence=${cursor} -> ${after.status} lastSeq=${after.json?.result?.lastSeq} seqs=${JSON.stringify(afterSeqs)}`);
  check('A2.1', 'worker: status with a nonzero cursor answers only the events after it',
    after.status === 200 && afterSeqs.length >= 1 && JSON.stringify(afterSeqs) === JSON.stringify(allSeqs.filter((q) => q > cursor)),
    `after=${JSON.stringify(afterSeqs)}`);
  check('A2.2', 'worker: lastSeq is the same with or without the cursor', after.json?.result?.lastSeq === all.json?.result?.lastSeq);
  check('A2.3', 'worker: cursor 0 answers every event from the first', allSeqs[0] === 1 && allSeqs.length >= 4, JSON.stringify(allSeqs));
  g.open();
  const result = await running;
  check('A.4', 'the call settles successfully once released', result?.executionStatus === 'success', result?.executionStatus ?? String(result?.message));
  const released = await s.release();
  check('A.5', 'the Session releases', released.ok && released.value === true, brief(released));
}

// ---------------------------------------------------------------------------
async function sectionB() {
  const s = await open();
  const missing = path.join(s.cwd, `missing-directory-${s.runtimeSessionId.slice(0, 8)}`);
  const outside = fs.realpathSync(path.join(ROOTS, 'a'));
  const mark = ledgerMark();
  const nonexistent = await attempt(() => s.client.prepare(s.identity('b1'), 'run_shell_command', { command: 'pwd', is_background: false, directory: missing }));
  const elsewhere = await attempt(() => s.client.prepare(s.identity('b2'), 'run_shell_command', { command: 'pwd', is_background: false, directory: outside }));
  const prepWire = ledger(mark).filter((e) => e.kind === 'prepare');
  say('B', `nonexistent: ${brief(nonexistent)}`);
  say('B', `outside:     ${brief(elsewhere)}`);
  say('B', `wire: ${prepWire.map((e) => `prepare -> ${e.status} ${e.response?.code ?? ''}`).join(' | ')}`);
  check('B.1', 'a Shell prepare naming an absolute directory that does not exist is refused 400 managed_runtime_tool_invalid',
    !nonexistent.ok && nonexistent.status === 400 && nonexistent.code === 'managed_runtime_tool_invalid', brief(nonexistent));
  check('B.2', 'the refusal comes from the worker (400 on the wire), like a directory outside the workspace',
    prepWire.length === 2 && prepWire.every((e) => e.status === 400 && e.response?.code === 'managed_runtime_tool_invalid'));
  check('B.3', 'nothing is journaled for the refused call', executions(s.runtimeSessionId).length === 0);
  fs.mkdirSync(missing);
  const { reference, preflight } = await ready(s, 'b1', 'run_shell_command', { command: 'pwd', is_background: false, directory: missing });
  const result = await s.client.startExecution(reference);
  check('B.4', 'the same call prepares and runs there once the directory exists',
    preflight.shouldProceed === true && result.executionStatus === 'success' && JSON.stringify(result).includes(path.basename(missing)),
    `${result.executionStatus}`);
  const released = await s.release();
  check('B.5', 'the Session releases', released.ok && released.value === true, brief(released));
}

// B2: what a call with a directory that does not exist does when it runs
// (reached only when prepare admits it, i.e. with Q6 broken).
async function sectionB2() {
  const s = await open();
  const missing = path.join(s.cwd, `missing-run-${s.runtimeSessionId.slice(0, 8)}`);
  const prepared = await attempt(() => ready(s, 'b2', 'run_shell_command', { command: 'pwd; echo ran-here', is_background: false, directory: missing }));
  say('B2', `prepare/approve with a missing directory: ${prepared.ok ? 'admitted' : brief(prepared)}`);
  if (prepared.ok) {
    const result = await attempt(() => s.client.startExecution(prepared.value.reference));
    say('B2', `run: ${brief(result)}`);
    say('B2', `journal: ${executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`).join(',')}`);
  }
  const released = await s.release();
  say('B2', `release: ${brief(released)}`);
}

// ---------------------------------------------------------------------------
async function sectionC() {
  const s = await open();
  const target = path.join(s.cwd, `c-${s.runtimeSessionId.slice(0, 8)}.txt`);
  // P: approved, reserved, never started (worker state 'prepared').
  const p = await ready(s, 'c-prepared', 'write_file', { file_path: target, content: 'written after the refused release\n' });
  // E: a Shell call that stays running until the gate opens.
  const g = gatedScript(s, 'c', 1);
  const e = await ready(s, 'c-running', 'run_shell_command', { command: g.command, is_background: false });
  const running = s.client.startExecution(e.reference).catch((x) => x);
  await until('the Shell call running', async () => g.running());
  await sleep(500);
  const port = workerPortOf(s.runtimeSessionId);

  // C1: the production path. The Broker refuses before the worker is asked.
  let mark = ledgerMark();
  const second = newProvider();
  await second.getToolV2Client(s.request, { harnessSessionId: s.harness });
  const viaBroker = await attempt(() => second.release(s.runtimeSessionId, s.request, { terminal: true }));
  const releaseWire1 = ledger(mark).filter((x) => x.kind === 'release');
  say('C1', `release via Broker while a call runs: ${brief(viaBroker)}; worker release requests: ${releaseWire1.length}`);
  check('C1.1', 'Broker refuses the release itself (runtime_session_busy), the worker is not asked',
    !viaBroker.ok && viaBroker.code === 'runtime_session_busy' && releaseWire1.length === 0, brief(viaBroker));

  // C2: the worker's own guard, reached by a release the rig sends to the
  // worker with the Broker's credentials (an order the Broker never sends).
  mark = ledgerMark();
  const direct = await inject(port, 'provider/v1/control', s.envelope({ kind: 'release' }));
  say('C2', `rig-sent release to worker :${port}: ${direct.status} ${JSON.stringify(direct.json)}`);
  check('C2.1', 'worker answers 409 managed_runtime_provider_operation_failed "still owns unfinished work"',
    direct.status === 409 && direct.code === 'managed_runtime_provider_operation_failed' && direct.json?.error === 'Managed Runtime Session still owns unfinished work.');
  const pStatus = await inject(port, 'provider/v1/control', s.envelope({ kind: 'status', reference: p.reference, afterSequence: 0 }));
  say('C2', `prepared call after the refused release: worker status ${pStatus.status} state=${pStatus.json?.result?.state}`);
  check('C2.2', 'the prepared call is still prepared on the worker', pStatus.status === 200 && pStatus.json?.result?.state === 'prepared');
  const rows = executions(s.runtimeSessionId);
  const pRow = rows.find((r) => r.reference.invocationId === p.reference.invocationId);
  check('C2.3', 'the Broker journal still holds the prepared call as PREPARED', pRow?.state === 'PREPARED', `state=${pRow?.state}`);
  g.open();
  const eResult = await running;
  check('C2.4', 'the running call settles successfully', eResult?.executionStatus === 'success', eResult?.executionStatus ?? String(eResult?.message));
  const pResult = await attempt(() => s.client.startExecution(p.reference));
  say('C2', `start of the preserved call: ${brief(pResult)}; file ${fs.existsSync(target) ? 'written' : 'absent'}`);
  check('C2.5', 'the preserved call still runs and writes its file', pResult.ok && pResult.value.executionStatus === 'success' && fs.existsSync(target), brief(pResult));
  const released = await s.release();
  check('C2.6', 'the Session then releases through the Broker', released.ok && released.value === true && runtimeSession(s.runtimeSessionId)?.state === 'RELEASED', brief(released));
}

async function sectionC3() {
  const s = await open();
  const target = path.join(s.cwd, `c3-${s.runtimeSessionId.slice(0, 8)}.txt`);
  const p = await ready(s, 'c3-prepared', 'write_file', { file_path: target, content: 'c3\n' });
  const g = gatedScript(s, 'c3', 1);
  const e = await ready(s, 'c3-running', 'run_shell_command', { command: g.command, is_background: false });
  const running = s.client.startExecution(e.reference).catch((x) => x);
  await until('the Shell call running', async () => g.running());
  const refused = await s.release();
  say('C3', `release by the same client while a call runs: ${brief(refused)}`);
  g.open();
  const eResult = await running;
  const start = await attempt(() => s.client.startExecution(p.reference));
  const cancel = await attempt(() => s.client.cancel(p.reference));
  const again = await s.release();
  const rows = executions(s.runtimeSessionId).map((r) => `${r.reference.callId}=${r.state}/${r.status}`);
  say('C3', `after the refusal: running call ${eResult?.executionStatus}; start prepared -> ${brief(start)}; cancel prepared -> ${brief(cancel)}; release again -> ${brief(again)}; journal ${rows.join(',')}; Session ${runtimeSession(s.runtimeSessionId)?.state}`);
  check('C3.1', 'observed: the same client refuses to start the preserved call after its own refused release (client state, not the worker)', !start.ok && start.code === 'managed_runtime_unavailable', brief(start));
  check('C3.2', 'observed: cancelling the preserved call and releasing again completes (no wedge)', cancel.ok && cancel.value?.result?.executionStatus === 'cancelled' && again.ok && again.value === true && runtimeSession(s.runtimeSessionId)?.state === 'RELEASED', `${brief(cancel)} / ${brief(again)}`);
}

// ---------------------------------------------------------------------------
async function sectionD() {
  const s = await open();
  // The fitter keeps results inside the limit and the manifest is fixed, so
  // the worker's 413 is a backstop; show what the Broker makes of it.
  await clearHooks();
  await hook({ kind: 'manifest', action: 'rewrite', status: 413, body: JSON.stringify({ code: 'managed_runtime_provider_too_large', error: 'Managed Runtime provider response exceeds its body size limit.' }) });
  const mark = ledgerMark();
  const other = newProvider();
  const client = await other.getToolV2Client(s.request, { harnessSessionId: s.harness });
  const answer = await attempt(() => client.manifest());
  await clearHooks();
  const wireD = ledger(mark).filter((x) => x.kind === 'manifest');
  say('D', `manifest with the worker answer replaced by 413 too_large: ${brief(answer)} retryable=${answer.retryable ?? '-'}; wire=${wire(wireD).join(' | ')}`);
  check('D.1', 'the caller receives 413 managed_runtime_provider_too_large', !answer.ok && answer.status === 413 && answer.code === 'managed_runtime_provider_too_large', brief(answer));
  const again = await attempt(() => s.client.manifest());
  check('D.2', 'the next manifest (no rewrite) is answered normally', again.ok && again.value.tools.length === 4, brief(again));
  const released = await s.release();
  check('D.3', 'the Session releases', released.ok && released.value === true, brief(released));
}

// ---------------------------------------------------------------------------
async function sectionE() {
  const s = await open();
  const g = gatedScript(s, 'e', 1);
  const { reference, reserved } = await ready(s, 'e1', 'run_shell_command', { command: g.command, is_background: false });
  const id = reserved.executionCallId;
  const getRaw = () => broker('GET', `executions/${id}?requestId=${randomUUID()}&harnessSessionId=${s.harness}&runtimeSessionId=${s.runtimeSessionId}`);
  // Raw :start, so no client polling loop competes for the rewrite hook.
  const started = broker('POST', `executions/${id}:start`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId });
  await until('the Shell call running', async () => g.running());
  const start = await started;
  say('E', `raw :start answered ${start.status} state=${start.json?.status?.state}`);
  await until('the journal to mark the call UNKNOWN (Broker execute request over)', async () => executions(s.runtimeSessionId)[0]?.state === 'UNKNOWN', 90_000);
  say('E', `journal: ${executions(s.runtimeSessionId).map((r) => r.state).join(',')}`);
  const mine = (e) => e.kind === 'status' && e.request?.operation?.reference?.invocationId === reference.invocationId;
  let mark = ledgerMark();
  const plain = await getRaw();
  say('E', `plain GET -> ${plain.status} state=${plain.json?.status?.state}; worker status requests: ${ledger(mark).filter(mine).length}`);
  check('E.0', 'a GET of the running call is answered from a worker status read', plain.status === 200 && ledger(mark).filter(mine).length >= 1);
  const session = { harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId, turnKind: 'bootstrap' };
  const body = (lastSeq, firstAvailableSeq) =>
    `{"protocolVersion":1,"providerProtocol":"managed-runtime-provider/1","session":${JSON.stringify(session)},"result":{"state":"executing","cancelRequested":false,"lastSeq":${lastSeq},"firstAvailableSeq":${firstAvailableSeq},"progressGap":false,"progress":[]}}`;
  const cases = [
    ['E.1', 'worker lastSeq 2^53 is refused by the Broker', '9007199254740992', '0', false],
    ['E.2', 'worker firstAvailableSeq 2^53 (lastSeq 2^53 - 1) is refused by the Broker', '9007199254740991', '9007199254740992', false],
    ['E.3', 'worker lastSeq 2^53 - 1 is accepted by the Broker', '9007199254740991', '0', true],
  ];
  for (const [cid, title, last, first, accept] of cases) {
    await clearHooks();
    await hook({ kind: 'status', action: 'rewrite', body: body(last, first) });
    mark = ledgerMark();
    const answer = await getRaw();
    await clearHooks();
    const w = ledger(mark).filter(mine);
    say('E', `${cid} lastSeq=${last} firstAvailableSeq=${first}: GET -> ${answer.status} ${answer.code ?? ''} state=${answer.json?.status?.state ?? '-'} ${answer.json?.error ?? ''} (worker reads ${w.length}, rewritten ${w.filter((x) => x.fault === 'rewrite').length})`);
    check(cid, title, accept ? answer.status === 200 && answer.json?.status?.state === 'executing' : answer.status >= 400, `${answer.status} ${answer.code ?? ''}`);
  }
  // What the in-repo client reports when the Broker refuses the cursor.
  await hook({ kind: 'status', action: 'rewrite', body: body('9007199254740992', '0') });
  const viaClient = await attempt(() => s.client.status(reference, 0));
  await clearHooks();
  say('E', `client status() under the lastSeq 2^53 rewrite: ${brief(viaClient)}`);
  const rows = executions(s.runtimeSessionId);
  say('E', `journal after the rewritten answers: ${rows.map((r) => `${r.state}/${r.status}`).join(',')}`);
  g.open();
  const settled = await until('the call settled', async () => { const r = await getRaw(); return r.json?.status?.state === 'settled' ? r : null; });
  check('E.4', 'the call still settles successfully afterwards', settled.json?.status?.result?.executionStatus === 'success', JSON.stringify(settled.json?.status?.result?.executionStatus));
  const released = await s.release();
  check('E.5', 'the Session releases', released.ok && released.value === true, brief(released));
}

// ---------------------------------------------------------------------------
async function sectionF() {
  const upper = randomUUID().toUpperCase();
  const provider = newProvider();
  const harness = await createSession();
  const cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
  const request = prepareRequest(upper, 'bootstrap', cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: harness });
  const manifest = await attempt(() => client.manifest());
  check('F.1', 'acquire + manifest accept an uppercase Runtime Session UUID', manifest.ok, brief(manifest));
  const identity = (sessionId, callId) => ({ sessionId, promptId: 'p-upper', callId, capabilityDigest: manifest.value.capabilityDigest, policyRevision: manifest.value.policyRevision });
  const bind = await attempt(() => client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: upper, executionCwd: cwd, snapshots: [] }));
  const begin = await attempt(() => client.beginTurn(identity(upper, 'turn')));
  say('F', `in-repo client, uppercase Session: bind ${brief(bind)} | begin-turn ${brief(begin)}`);
  check('F.2', 'in-repo client: bind-history and begin-turn are refused before any Broker request (core lower-cases identities)', !bind.ok && !begin.ok);
  const raw = async (sessionId, idSession) => {
    const mark = ledgerMark();
    const r = await broker('POST', `tool-sessions/${encodeURIComponent(sessionId)}/control`, {
      protocolVersion: 1, requestId: randomUUID(), harnessSessionId: harness,
      operation: { kind: 'begin-turn', identity: identity(idSession, 'turn') },
    });
    const w = ledger(mark).filter((e) => e.kind === 'begin-turn');
    return { ...r, worker: w.map((e) => `${e.status} ${e.response?.code ?? ''}`) };
  };
  const both = await raw(upper, upper);
  say('F', `raw Broker begin-turn, Session and identity uppercase: ${both.status} ${both.code} "${both.json?.error ?? ''}"; worker saw: ${JSON.stringify(both.worker)}`);
  check('F.3', 'Broker admits the uppercase identity (I6) and forwards it; the worker refuses it 409 identity_conflict',
    both.worker.length === 1 && both.status === 409 && both.code === 'managed_runtime_identity_conflict', `${both.status} ${both.code} worker=${both.worker}`);
  const mixed = await raw(upper, upper.toLowerCase());
  say('F', `raw Broker begin-turn, Session uppercase, identity lowercase: ${mixed.status} ${mixed.code} "${mixed.json?.error ?? ''}"; worker saw: ${JSON.stringify(mixed.worker)}`);
  check('F.4', 'a lowercase identity in the uppercase Session is refused by the Broker itself (strict equals), worker not asked', mixed.status >= 400 && mixed.worker.length === 0, `${mixed.status} ${mixed.code}`);
  const released = await attempt(() => provider.release(upper, request, { terminal: true }));
  check('F.5', 'the uppercase Session releases', released.ok && released.value === true, brief(released));
}

// G: can a history read reach the worker while a Broker release is in flight
// (the "late" path of the PR's second release test)? The proxy holds the
// release request 5 s before forwarding it to the worker.
async function sectionG() {
  const s = await open();
  await clearHooks();
  await hook({ kind: 'release', action: 'delay', delayMs: 5000 });
  const mark = ledgerMark();
  const releasing = s.release();
  await sleep(1500);
  const state = runtimeSession(s.runtimeSessionId)?.state;
  const history = await broker('POST', `tool-sessions/${encodeURIComponent(s.runtimeSessionId)}/control`, {
    protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness, operation: { kind: 'history' },
  });
  const released = await releasing;
  await clearHooks();
  const w = ledger(mark);
  say('G', `Session state while the release is held: ${state}; history via Broker -> ${history.status} ${history.code} "${history.json?.error ?? ''}"; worker saw: ${wire(w).join(' | ')}; release -> ${brief(released)}`);
  check('G.1', 'while a Broker release is in flight the Session record is RELEASING', state === 'RELEASING', state);
  check('G.2', 'a history control sent then is refused by the Broker (runtime_session_not_ready), the worker never sees it',
    history.status === 409 && history.code === 'runtime_session_not_ready' && !w.some((e) => e.kind === 'history'), `${history.status} ${history.code}`);
  check('G.3', 'the held release then completes', released.ok && released.value === true, brief(released));
}

// H: how close a fitted large result's envelope lands to the 1 MiB wire limit
// (bot review R1-2: '>' vs '>=' at the gate only matters at exactly the limit).
async function sectionH() {
  const s = await open();
  const out = [];
  for (const [tag, bytes] of [['h1', 2 * 1024 * 1024], ['h2', 1536 * 1024], ['h3', 3 * 1024 * 1024]]) {
    const script = path.join(s.cwd, `big-${tag}-${s.runtimeSessionId.slice(0, 8)}.cjs`);
    fs.writeFileSync(script, `process.stdout.write('a'.repeat(${bytes}) + '\\n');`);
    const { reference } = await ready(s, tag, 'run_shell_command', { command: `"${NODE}" "${script}"`, is_background: false });
    const mark = ledgerMark();
    const result = await attempt(() => s.client.startExecution(reference));
    const answers = ledger(mark).filter((e) => (e.kind === 'execute' || e.kind === 'status') && e.request?.operation?.reference?.invocationId === reference.invocationId && e.status === 200);
    const sizes = [...new Set(answers.map((e) => e.responseBytes))];
    out.push(`${tag} output=${bytes} -> ${result.ok ? result.value.executionStatus : brief(result)}; worker answer bytes=${sizes.join(',')} (limit 1048576, delta ${sizes.map((b) => b - 1048576).join(',')})`);
  }
  for (const l of out) say('H', l);
  check('H.1', 'measured', true);
  const released = await s.release();
  check('H.2', 'the Session releases', released.ok && released.value === true, brief(released));
}

const table = { H: sectionH, G: sectionG, A: sectionA, B: sectionB, B2: sectionB2, C: sectionC, C3: sectionC3, D: sectionD, E: sectionE, F: sectionF };
for (const s of sections) {
  try {
    await table[s]();
  } catch (error) {
    check(`${s}.X`, 'section completed', false, String(error?.stack ?? error));
  }
}
for (const p of providers) p.dispose?.();
const ok = summary();
process.exit(ok ? 0 : 1);
