// Smoke: learn the real shapes before writing assertions.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, attempt, brief, createSession, executions, ledger, ledgerMark,
  loadProvider, openLog, prepareRequest, runtimeSession, say, wire, launches, seedRegistry,
} from './lib.mjs';

openLog('s0-smoke');
const mode = process.argv[2] ?? 'plain';
const { BrokerManagedRuntimeProvider } = await loadProvider();
const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });

let harness;
let cwd;
if (mode === 'plain') {
  harness = await createSession();
  cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
} else {
  const ws = `ws-smoke-${Date.now()}`;
  seedRegistry(ws, `st-${mode}`);
  harness = await createSession(ws);
  cwd = fs.realpathSync(path.join(ROOTS, mode, 'child'));
}
say('harness', harness);
const runtimeSessionId = randomUUID();
const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
const mark = ledgerMark();
const t0 = Date.now();
const got = await attempt(() => provider.getToolV2Client(request, { harnessSessionId: harness }));
say('acquire', `${brief(got).slice(0, 80)} ${Date.now() - t0}ms`);
say('session', runtimeSession(runtimeSessionId));
say('launches', launches().slice(-2));
if (!got.ok) process.exit(1);
const client = got.value;

const bind = await attempt(() =>
  client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] }),
);
say('bind', brief(bind));
const manifest = await attempt(() => client.manifest());
say('manifest', manifest.ok ? { tools: manifest.value.tools.map((t) => t.name), capabilityDigest: manifest.value.capabilityDigest, policyRevision: manifest.value.policyRevision } : brief(manifest));
const identity = {
  sessionId: runtimeSessionId,
  promptId: 'prompt-1',
  callId: 'call-1',
  capabilityDigest: manifest.value.capabilityDigest,
  policyRevision: manifest.value.policyRevision,
};
say('begin', brief(await attempt(() => client.beginTurn(identity))));
const target = path.join(cwd, `smoke-${runtimeSessionId.slice(0, 8)}.txt`);
const prepared = await attempt(() => client.prepare(identity, 'write_file', { file_path: target, content: 'hello\n' }));
say('prepare', prepared.ok ? prepared.value : brief(prepared));
say('file-after-prepare', fs.existsSync(target));
const reference = Object.fromEntries(
  ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'].map((k) => [k, prepared.value[k]]),
);
const confirmation = await attempt(() => client.confirmation(reference));
say('confirmation', confirmation.ok ? { type: confirmation.value.type, title: confirmation.value.title } : brief(confirmation));
const reserved = await attempt(() => client.prepareExecution(reference));
say('reserve', brief(reserved));
say('rows', executions(runtimeSessionId));
say('file-after-reserve', fs.existsSync(target));
say('confirm', brief(await attempt(() => client.confirm(reference, 'proceed_once'))));
say('preflight', brief(await attempt(() => client.preflight(reference))));
const started = await attempt(() => client.startExecution(reference, reserved.value?.executionCallId));
say('start', brief(started));
say('file-after-start', fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '<missing>');
say('rows', executions(runtimeSessionId).map((r) => ({ id: r.id, state: r.state, status: r.status, generation: r.generation, referenceKeys: Object.keys(r.reference) })));
say('status', brief(await attempt(() => client.status(reference))));
say('history', brief(await attempt(() => client.fileHistory.snapshot())));
const released = await attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
say('release', brief(released));
say('session', runtimeSession(runtimeSessionId));
for (const line of wire(ledger(mark))) say('wire', line);
provider.dispose();
