// PR #12868 A/B: the same provider walk on the merge-base arm and the PR arm.
// Every step is attempted; nothing is asserted — the table is the evidence.
// usage: ARM=<base|pr> DB=.. HTTP_PORT=.. BROKER_PORT=.. PROXY_PORT=.. node s4-ab.mjs <v1|letter>
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, broker, createSession, executions, ledger, ledgerMark,
  loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry, wire,
} from './lib.mjs';

const mode = process.argv[2] ?? 'v1';
openLog(`s4-ab-${ARM}-${mode}`);
const { BrokerManagedRuntimeProvider } = await loadProvider();
const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
let harness;
let cwd;
if (mode === 'v1') {
  harness = await createSession();
  cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
} else {
  const ws = `ws-${mode}-${Date.now()}`;
  seedRegistry(ws, `st-${mode}`);
  harness = await createSession(ws);
  cwd = fs.realpathSync(path.join(ROOTS, mode, 'child'));
}
const runtimeSessionId = randomUUID();
const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
const mark = ledgerMark();
const rows = [];
const step = async (name, fn) => {
  const a = await attempt(fn);
  const text = a.ok ? 'ok' : `HTTP ${a.status ?? '-'} ${a.code ?? a.message}`;
  rows.push([name, text]);
  say('step', `${name.padEnd(28)} ${text}`);
  return a;
};
const got = await step('acquire (provider)', () => provider.getToolV2Client(request, { harnessSessionId: harness }));
const client = got.value;
const file = path.join(cwd, `ab-${ARM}-${runtimeSessionId.slice(0, 8)}.txt`);
const fake = { sessionId: runtimeSessionId, promptId: 'p1', callId: 'c1', capabilityDigest: 'a'.repeat(64), policyRevision: 'r1' };
let manifest;
let prepared;
if (client) {
  await step('bind-history', () => client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] }));
  manifest = await step('manifest', () => client.manifest());
  const identity = manifest.ok ? { ...fake, capabilityDigest: manifest.value.capabilityDigest, policyRevision: manifest.value.policyRevision } : fake;
  await step('begin-turn', () => client.beginTurn({ ...identity, callId: 'turn' }));
  prepared = await step('prepare write_file', () => client.prepare(identity, 'write_file', { file_path: file, content: 'ab\n' }));
  const reference = prepared.ok
    ? Object.fromEntries(['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'].map((k) => [k, prepared.value[k]]))
    : { ...identity, invocationId: randomUUID(), argsDigest: 'b'.repeat(64) };
  await step('confirmation', () => client.confirmation(reference));
  const reserved = await step('reserve (7-field reference)', () => client.prepareExecution(reference));
  await step('confirm proceed_once', () => client.confirm(reference, 'proceed_once'));
  await step('preflight', () => client.preflight(reference));
  if (reserved.ok) await step('start', () => client.startExecution(reference, reserved.value.executionCallId));
  await step('checkpoint', () => client.fileHistory.checkpoint('p2'));
  await step('history', () => client.fileHistory.snapshot());
}
const released = await step('release (provider)', () => provider.release(runtimeSessionId, request, { terminal: true }));
const rawRelease = await broker('POST', `tool-sessions/${runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: harness });
say('step', `${'release (Broker HTTP)'.padEnd(28)} HTTP ${rawRelease.status} ${rawRelease.code ?? JSON.stringify(rawRelease.json).slice(0, 80)}`);
say('state', `file written=${fs.existsSync(file)} session=${runtimeSession(runtimeSessionId)?.state} executions=${JSON.stringify(executions(runtimeSessionId).map((r) => `${Object.keys(r.reference).length}-field ${r.state}/${r.status}`))}`);
say('wire', wire(ledger(mark)).join(', ') || '<no Broker -> worker request>');
provider.dispose();
