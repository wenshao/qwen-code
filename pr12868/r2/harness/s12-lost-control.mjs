// PR #12868 round 2: a lost CONTROL reply (not execute), then the same request
// again; and whether the TypeScript and Java sides agree on the confirm
// outcome enumeration and the operation kinds.
// usage: node s12-lost-control.mjs <groups K,L> <storage letters>
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, WT, attempt, brief, broker, check, clearHooks, createSession, executions,
  holders, hook, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry,
  sleep, summary, wire,
} from './lib.mjs';

const groups = (process.argv[2] ?? 'K,L').split(',');
const letters = (process.argv[3] ?? 'q,r,s,t').split(',');
let letterIndex = 0;
openLog(`s12-lost-control-${ARM}-${groups.join('')}`);
const { BrokerManagedRuntimeProvider } = await loadProvider();
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];

async function open(mode, { bind = true, begin = true } = {}) {
  let harness;
  let cwd;
  if (mode === 'v1') {
    harness = await createSession();
    cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
  } else {
    const letter = letters[letterIndex++ % letters.length];
    const ws = `ws-${letter}-${Date.now()}`;
    seedRegistry(ws, `st-${letter}`);
    harness = await createSession(ws);
    cwd = fs.realpathSync(path.join(ROOTS, letter, 'child'));
  }
  const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  providers.push(provider);
  const runtimeSessionId = randomUUID();
  const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: harness });
  const s = { mode, provider, harness, cwd, runtimeSessionId, request, client };
  s.control = (operation) => broker('POST', `tool-sessions/${runtimeSessionId}/control`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: harness, operation });
  s.binding = { ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] };
  if (bind) await client.fileHistory.bind(s.binding);
  s.manifest = await client.manifest();
  s.identity = (callId) => ({ sessionId: runtimeSessionId, promptId: 'p1', callId, capabilityDigest: s.manifest.capabilityDigest, policyRevision: s.manifest.policyRevision });
  if (begin) await client.beginTurn(s.identity('turn'));
  s.rawRelease = () => broker('POST', `tool-sessions/${runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: harness });
  return s;
}
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;

// K: lose the worker's reply to one control, then send the same control again.
async function groupK(mode) {
  const tag = `K-${mode}`;
  const s = await open(mode, { bind: false, begin: false });
  const file = path.join(s.cwd, `k-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const lose = async (kind, operation) => {
    await hook({ kind, action: 'drop-reply', count: 1 });
    const mark = ledgerMark();
    const lost = await s.control(operation);
    await clearHooks();
    const again = await s.control(operation);
    const reached = ledger(mark).filter((e) => e.kind === kind).map((e) => `${e.status}${e.fault ? `(${e.fault})` : ''}`);
    say(tag, `${kind.padEnd(13)} reply lost -> caller ${answer(lost)} | same request again -> ${answer(again)} | worker saw ${kind} x${reached.length}: ${reached.join(', ')}`);
    return { lost, again };
  };
  const bind = await lose('bind-history', { kind: 'bind-history', binding: s.binding });
  const manifest = await lose('manifest', { kind: 'manifest' });
  const m = manifest.again.json.result;
  const identity = (callId) => ({ sessionId: s.runtimeSessionId, promptId: 'p1', callId, capabilityDigest: m.capabilityDigest, policyRevision: m.policyRevision });
  const begin = await lose('begin-turn', { kind: 'begin-turn', identity: identity('turn') });
  const prepareOp = { kind: 'prepare', identity: identity('k1'), toolName: 'write_file', input: { file_path: file, content: 'k\n' } };
  const prepare = await lose('prepare', prepareOp);
  check(`${tag}.1`, 'bind-history, manifest and begin-turn answer the repeated request after a lost reply',
    [bind, manifest, begin].every((r) => r.lost.status >= 500 && r.again.status === 200),
    [bind, manifest, begin].map((r) => `${answer(r.lost)} → ${answer(r.again)}`).join(' | '));
  const first = prepare.again.status === 200 ? prepare.again.json.result : null;
  check(`${tag}.2`, 'prepare repeated after a lost reply yields a usable invocation and no effect',
    first !== null && !fs.existsSync(file), `${answer(prepare.lost)} → ${answer(prepare.again)}`);
  if (!first) {
    say(tag, `prepare cannot be repeated under the same call identity: ${JSON.stringify(prepare.again.json).slice(0, 200)}`);
    const other = await s.control({ ...prepareOp, identity: identity('k1-second') });
    say(tag, `prepare under a NEW call identity after the lost one: ${answer(other)}`);
    const released = await s.rawRelease();
    say(tag, `release afterwards: ${answer(released)} session=${runtimeSession(s.runtimeSessionId)?.state}`);
    return;
  }
  const reference = ref(first);
  const confirm = s.mode === 'v1' ? await lose('confirm', { kind: 'confirm', reference, outcome: 'proceed_once' }) : null;
  const preflight = await lose('preflight', { kind: 'preflight', reference });
  check(`${tag}.3`, 'confirm and preflight answer the repeated request after a lost reply',
    [confirm, preflight].filter(Boolean).every((r) => r.again.status === 200) && !fs.existsSync(file),
    [confirm, preflight].filter(Boolean).map((r) => `${answer(r.lost)} → ${answer(r.again)}`).join(' | '));
  const reserved = await s.client.prepareExecution(reference);
  const result = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  check(`${tag}.4`, 'the invocation then executes exactly once',
    result.ok && result.value.executionStatus === 'success' && fs.readFileSync(file, 'utf8') === 'k\n' && executions(s.runtimeSessionId).length === 1, brief(result).slice(0, 80));
  // Lost release acknowledgement.
  await hook({ kind: 'release', action: 'drop-reply', count: 1 });
  const mark = ledgerMark();
  const lost = await s.rawRelease();
  await clearHooks();
  const state = runtimeSession(s.runtimeSessionId)?.state;
  const held = holders().some(([, holder]) => holder === s.runtimeSessionId);
  const probe = await s.control({ kind: 'manifest' });
  const again = await s.rawRelease();
  await sleep(300);
  const after = runtimeSession(s.runtimeSessionId)?.state;
  const heldAfter = holders().some(([, holder]) => holder === s.runtimeSessionId);
  say(tag, `release reply lost -> caller ${answer(lost)} session=${state} storageHeld=${held} | a control in between -> ${answer(probe)} | release again -> ${answer(again)} session=${after} storageHeld=${heldAfter}`);
  say(tag, `wire: ${wire(ledger(mark)).join(', ')}`);
  check(`${tag}.5`, 'a lost release acknowledgement admits no new work and a repeated release completes (storage dropped)',
    lost.status >= 500 && probe.status >= 400 && again.status === 200 && after === 'RELEASED' && !heldAfter,
    `lost=${answer(lost)} between=${answer(probe)} again=${answer(again)} session=${after} held=${heldAfter}`);
}

// L: do both sides accept the same confirm outcomes and operation kinds?
async function groupL() {
  const tag = 'L-v1';
  const tools = await import(pathToFileURL(path.join(WT, 'packages/core/dist/src/tools/tools.js')).href);
  const outcomes = Object.values(tools.ToolConfirmationOutcome);
  say(tag, `core ToolConfirmationOutcome has ${outcomes.length} values: ${outcomes.join(', ')}`);
  const s = await open('v1');
  const rows = [];
  let n = 0;
  for (const outcome of [...outcomes, 'approve', 'PROCEED_ONCE', '']) {
    n++;
    const prepared = await s.client.prepare(s.identity(`l${n}`), 'write_file', { file_path: path.join(s.cwd, `l-${s.runtimeSessionId.slice(0, 6)}-${n}.txt`), content: 'l\n' });
    const mark = ledgerMark();
    const atBroker = await s.control({ kind: 'confirm', reference: ref(prepared), outcome });
    const entry = ledger(mark).find((e) => e.kind === 'confirm');
    const worker = entry ? `${entry.status}${entry.response?.code ? ` ${entry.response.code}` : ''}` : 'not reached';
    rows.push({ outcome, broker: atBroker.status, worker });
    say(tag, `confirm outcome ${JSON.stringify(outcome).padEnd(38)} Broker -> ${answer(atBroker).padEnd(40)} worker -> ${worker}${entry?.response?.error ? ` :: ${entry.response.error}` : ''}`);
  }
  const inEnum = rows.filter((r) => outcomes.includes(r.outcome));
  const refusedByBroker = inEnum.filter((r) => r.broker === 400 && r.worker === 'not reached').map((r) => r.outcome);
  const refusedByWorkerOnly = inEnum.filter((r) => r.worker.startsWith('400')).map((r) => r.outcome);
  check(`${tag}.1`, 'no outcome is accepted by one side and rejected as malformed by the other',
    refusedByWorkerOnly.length === 0, `Broker refuses ${JSON.stringify(refusedByBroker)}; worker-only 400: ${JSON.stringify(refusedByWorkerOnly)}`);
  check(`${tag}.2`, 'values outside the enumeration are refused before any worker request',
    rows.filter((r) => !outcomes.includes(r.outcome)).every((r) => r.broker === 400 && r.worker === 'not reached'));
  const kinds = ['manifest', 'history', 'begin-turn', 'prepare', 'confirmation', 'confirm', 'preflight', 'bind-history', 'checkpoint', 'acquire', 'release', 'execute', 'status', 'cancel', 'dispose', 'MANIFEST'];
  const publicKinds = [];
  for (const kind of kinds) {
    const mark = ledgerMark();
    const r = await s.control({ kind });
    const reached = ledger(mark).some((e) => e.kind === kind);
    // A public kind without its required fields is refused for its shape, which still shows that the kind is known.
    if (reached || (r.status === 200) || r.code !== 'runtime_control_operation_invalid') publicKinds.push(kind);
  }
  say(tag, `kinds that reached the worker when sent bare through the public control route: ${JSON.stringify(publicKinds)}`);
  check(`${tag}.3`, 'only manifest and history are admitted bare; transport-only and unknown kinds never reach the worker',
    JSON.stringify(publicKinds) === JSON.stringify(['manifest', 'history']), JSON.stringify(publicKinds));
  say(tag, `release ${brief(await attempt(() => s.provider.release(s.runtimeSessionId, s.request, { terminal: true })))}`);
}

const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
for (const group of groups) {
  for (const mode of group === 'L' ? ['v1'] : modes) {
    say('GROUP', `${group} ${mode} arm=${ARM}`);
    try {
      if (group === 'K') await groupK(mode);
      if (group === 'L') await groupL();
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
