// PR #12868: what a worker keeps after provider Sessions are released.
// One Harness Session (= one worker), N sequential Runtime Sessions, each:
// acquire -> bind-history -> manifest -> begin-turn -> prepare -> reserve ->
// (approve) -> preflight -> start (write_file) -> release.
// usage: node s3-retention.mjs <v1|v2> <count> [storage letter]
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, createSession, loadProvider, openLog, prepareRequest, say, seedRegistry,
  sleep, workerPids, runtimeSession, sql,
} from './lib.mjs';

const mode = process.argv[2] ?? 'v1';
const count = Number(process.argv[3] ?? 200);
const letter = process.argv[4] ?? 'k';
// CONTENT_BYTES: what each turn writes. The file history of a Session keeps
// the contents of the files its turn touched.
const CONTENT = Number(process.env.CONTENT_BYTES ?? 4096);
openLog(`s3-retention-${ARM}-${mode}-${count}x${Math.round(CONTENT / 1024)}KiB`);
const { BrokerManagedRuntimeProvider } = await loadProvider();
const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
const before = new Set(workerPids().map((w) => w.pid));
let harness;
let cwd;
if (mode === 'v1') {
  harness = await createSession();
  cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
} else {
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  harness = await createSession(ws);
  cwd = fs.realpathSync(path.join(ROOTS, letter, 'child'));
}
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
let worker;
const samples = [];
const file = path.join(cwd, `retention-${Date.now()}.txt`);
const t0 = Date.now();
for (let i = 1; i <= count; i++) {
  const runtimeSessionId = randomUUID();
  const request = prepareRequest(runtimeSessionId, i === 1 ? 'bootstrap' : 'continuation', cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: harness });
  await client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] });
  const manifest = await client.manifest();
  const identity = { sessionId: runtimeSessionId, promptId: `p-${i}`, callId: `c-${i}`, capabilityDigest: manifest.capabilityDigest, policyRevision: manifest.policyRevision };
  await client.beginTurn({ ...identity, callId: 'turn' });
  const prepared = await client.prepare(identity, 'write_file', { file_path: file, content: `turn ${i}\n${'x'.repeat(CONTENT)}\n` });
  const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
  const reserved = await client.prepareExecution(reference);
  if (mode === 'v1') await client.confirm(reference, 'proceed_once');
  await client.preflight(reference);
  const result = await client.startExecution(reference, reserved.executionCallId);
  if (result.executionStatus !== 'success') throw new Error(`turn ${i}: ${JSON.stringify(result).slice(0, 200)}`);
  const released = await provider.release(runtimeSessionId, request, { terminal: true });
  if (!released) throw new Error(`turn ${i}: release returned false`);
  if (i === 1) {
    worker = workerPids().filter((w) => !before.has(w.pid));
    if (worker.length !== 1) throw new Error(`expected one new worker, saw ${JSON.stringify(worker)}`);
  }
  if (i === 1 || i % Math.max(1, Math.floor(count / 10)) === 0) {
    const now = workerPids().find((w) => w.pid === worker[0].pid);
    samples.push({ turn: i, rssMb: Math.round(now.rssKb / 1024) });
    say('sample', `released Sessions=${i} worker pid=${now.pid} RSS=${Math.round(now.rssKb / 1024)} MiB elapsed=${Math.round((Date.now() - t0) / 1000)}s`);
  }
}
await sleep(15_000);
const idle = workerPids().find((w) => w.pid === worker[0].pid);
say('idle', `15 s after the last release: RSS=${Math.round(idle.rssKb / 1024)} MiB`);
const first = samples[0].rssMb;
const last = Math.round(idle.rssKb / 1024);
say('result', `mode=${mode} each turn writes ${Math.round(CONTENT / 1024)} KiB | released=${count} RSS ${first} -> ${last} MiB (+${last - first} MiB, ${(((last - first) * 1024) / (count - 1)).toFixed(1)} KiB per released Session)`);
say('result', `Runtime Session rows for this Harness Session: ${JSON.stringify(sql(`SELECT session_state, COUNT(*) FROM qwen_runtime_session WHERE harness_session_id='${harness}' GROUP BY 1`))}`);
provider.dispose();
