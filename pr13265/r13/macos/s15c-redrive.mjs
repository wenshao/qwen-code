// S15 (round 11, head abf9687ce6 "retry a thrown record forward"): one
// record forward is made to throw; does the next edge carry the record past
// the missed revision, and does the Java record validator (MySQL) accept the
// jump? Derived from S14 (round 9, head b95765da88 "let only the same capture's lineage advance
// a record's output"): the funnel now demands revision + 1 of the same
// capture. Does the real publisher ever forward a skipped revision? A
// background Shell, attached first (the normal order), whose capture takes
// stdout and stderr writes — sequentially (control) and concurrently — over
// the PR's HostedShellPublisher + ManagedShellPublisherRegistry, against the
// HTTP Managed Session store (Spring + MySQL). Every advanceOutput the
// publisher makes is logged with its revision and outcome.
import http from 'node:http';
import { createRequire } from 'node:module';
import { BINDING_1, WT, createPublicSession, javaRows, openSession, records, say, openLog } from './lib.mjs';

for (const d of ['child_run', 'monitor_run']) if (!records.MANAGED_SESSION_ENABLED_DOMAINS.includes(d)) records.MANAGED_SESSION_ENABLED_DOMAINS.push(d);
openLog('s15c-redrive');
const FAIL_SET = new Set(String(process.env.FAIL_SET ?? '3').split(',').map(Number));
const FAIL_FOR_MS = Number(process.env.FAIL_FOR_MS ?? 0);
let failUntil = 0;
const CLI = `${WT}/packages/cli/dist/src/serve`;
const CORE = `${WT}/packages/core/dist/src/managed-runtime`;
const { HostedChildRunSession } = await import(`${CLI}/hosted-child-run-session.js`);
const { HostedMonitorSession } = await import(`${CLI}/hosted-monitor-session.js`);
const { HostedShellPublisher } = await import(`${CLI}/hosted-shell-publisher.js`);
const { ManagedShellPublisherRegistry } = await import(`${CLI}/managed-shell-publisher.js`);
const { MANAGED_TOOL_RESULT_PROTOCOL, parseToolResultManifestBytes } = await import(`${CORE}/managed-tool-result.js`);
const { parseChildRun } = await import(`${CORE}/managed-child-run-record.js`);
const { createManagedHarnessHandle } = await import(`${CORE}/managed-harness-factory.js`);
const express = createRequire(`${WT}/packages/cli/package.json`)('express');

const PROCESS_OK = { rawOutput: Buffer.alloc(0), output: '', error: null, aborted: false, exitCode: 0, signal: null, pid: undefined, executionMethod: 'child_process' };

async function stack(writerId) {
  const pub = await createPublicSession();
  const { session, stores, sessionKey } = await openSession({ sessionId: pub.id, writerId, create: true });
  await createManagedHarnessHandle(session).ensureRunnable();
  const parts = { authority: session.authority, resources: session.resources };
  const childRuns = new HostedChildRunSession(parts, sessionKey);
  const monitors = new HostedMonitorSession(parts, sessionKey);
  const advances = [];
  const original = childRuns.advanceOutput.bind(childRuns);
  let calls = 0;
  childRuns.advanceOutput = async (id, ref) => {
    calls++;
    let revision = null;
    try { revision = parseToolResultManifestBytes(await session.resources.read(ref)).revision; } catch (e) { revision = `unreadable: ${e.message.slice(0, 60)}`; }
    try {
      if (FAIL_SET.has(calls)) { if (FAIL_FOR_MS) failUntil = Date.now() + FAIL_FOR_MS; throw new Error('injected forward failure'); }
      if (Date.now() < failUntil) throw new Error('injected forward outage');
      const out = await original(id, ref);
      advances.push({ revision, ok: true });
      return out;
    } catch (e) {
      advances.push({ revision, ok: false, error: e.message.slice(0, 100) });
      throw e;
    }
  };
  const publisher = new HostedShellPublisher(session, stores.toolResultResources, async () => {}, childRuns, monitors);
  const descriptor = await publisher.start();
  const registry = new ManagedShellPublisherRegistry();
  const app = express();
  registry.register(app, { token: 'runtime-token', leaseId: 'lease-a', epoch: 1 }, (id) => id === 'runtime-a');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const answer = await fetch(`http://127.0.0.1:${server.address().port}/internal/managed-runtime/v3/publisher`, {
    method: 'POST',
    headers: { authorization: 'Bearer runtime-token', 'cache-control': 'no-store', 'content-type': 'application/json', 'x-qwen-managed-lease-id': 'lease-a', 'x-qwen-managed-lease-epoch': '1' },
    body: JSON.stringify({ protocolVersion: 3, toolResult: MANAGED_TOOL_RESULT_PROTOCOL, sessionId: 'runtime-a', publisher: descriptor }),
  });
  if (answer.status !== 200) throw new Error(`publisher registration ${answer.status}`);
  return { pub, session, sessionKey, childRuns, publisher, descriptor, registry, server, advances };
}

async function finalize(s, executionCallId) {
  const res = await fetch(s.descriptor.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.descriptor.token}`, 'cache-control': 'no-store', 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'finalize', executionCallId, started: true, failed: false, process: { exitCode: 0, signal: null, previewBytes: 0 }, executionStatus: 'success', responseParts: [], previewTruncated: false, error: null }),
  });
  const text = await res.text();
  return `${res.status}${res.status >= 400 ? ' ' + text.slice(0, 120) : ''}`;
}

async function writes(sink, stream, chunk, count, errors) {
  for (let i = 0; i < count; i++) {
    try { await sink.write(stream, Buffer.alloc(chunk, stream === 'stdout' ? 0x61 : 0x62)); } catch (e) { errors.push(`${stream}#${i}: ${e.message.slice(0, 100)}`); }
  }
}

async function scenario(label, plan) {
  const s = await stack(`writer-s14-${label}`);
  const id = `exec-s14-${label}`;
  await s.childRuns.admit({ shellId: id, ownerScopeId: s.sessionKey.sessionId, executionCallId: id, args: { command: 'producer', is_background: true } });
  await s.childRuns.dispatchStarted(id, BINDING_1);
  await s.childRuns.attach(id, BINDING_1, { pid: 11 });
  const req = {
    reference: { sessionId: 'runtime-a', promptId: 'prompt-a', callId: `worker-${id}`, argsDigest: `sha256:${'a'.repeat(64)}` },
    capture: { tenantId: s.sessionKey.tenantId, sessionId: s.sessionKey.sessionId, turnId: 'turn-a', executionCallId: id, bindingGeneration: '1', capturePolicy: 'complete_required', background: true },
  };
  s.publisher.register({ reference: req.reference, capture: req.capture }, 'model-call-a', req.reference.sessionId);
  const prepared = await s.registry.prepare(req);
  prepared.sink.setStarted(11);
  const errors = [];
  const t0 = Date.now();
  await plan(prepared.sink, errors);
  prepared.sink.setProcessResult(PROCESS_OK);
  for (const stream of ['stdout', 'stderr']) {
    try { await prepared.sink.finish(stream, true); } catch (e) { errors.push(`finish ${stream}: ${e.message.slice(0, 100)}`); }
  }
  const fin = await finalize(s, id);
  const waitMs = Number(process.env.WAIT_MS ?? 0);
  const tFin = Date.now();
  let settledAfterMs = null;
  while (Date.now() - tFin < waitMs) {
    const r0 = parseChildRun(s.session.authority.extensionRecord('child_run', id).record);
    if (r0.run.state === 'settled') { settledAfterMs = Date.now() - tFin; break; }
    await new Promise((r) => setTimeout(r, 25));
  }
  const recordAfterWait = (() => { const r0 = parseChildRun(s.session.authority.extensionRecord('child_run', id).record); return `${r0.run.state}/${r0.run.execution} stopReason=${r0.stopReason}`; })();
  const retry = process.env.RETRY === '1' ? await finalize(s, id) : 'not retried';
  const record = parseChildRun(s.session.authority.extensionRecord('child_run', id).record);
  let manifest = null;
  if (record.outputRef) {
    const m = parseToolResultManifestBytes(await s.session.resources.read(record.outputRef));
    const bytes = (x) => (x && typeof x === "object" ? (x.byteLength ?? x.bytes ?? x.totalBytes ?? null) : x ?? null);
    manifest = { revision: m.revision, captureStatus: m.captureStatus, keys: Object.keys(m).join(","), stdout: bytes(m.stdout ?? m.streams?.stdout), stderr: bytes(m.stderr ?? m.streams?.stderr) };
  }
  const row = javaRows(s.pub.id).find((r) => r[0] === id);
  const revisions = s.advances.map((a) => a.revision);
  const skips = revisions.filter((r, i) => i > 0 && typeof r === 'number' && typeof revisions[i - 1] === 'number' && r !== revisions[i - 1] + 1).length;
  const out = {
    ms: Date.now() - t0,
    writeErrors: errors.length,
    firstErrors: errors.slice(0, 3),
    advances: s.advances.length,
    advanceRefusals: s.advances.filter((a) => !a.ok).length,
    firstRefusal: s.advances.find((a) => !a.ok) ?? null,
    revisionsForwarded: revisions.length > 12 ? [...revisions.slice(0, 6), '…', ...revisions.slice(-4)] : revisions,
    nonConsecutiveForwards: skips,
    finalize: fin,
    recordAfterWait,
    settledAfterMs,
    retryFinalize: retry,
    record: `${record.run.state}/${record.run.execution} stopReason=${record.stopReason}`,
    manifest,
    javaRow: row ? `rev${row[2]} ${row[4]}/${row[5]}` : 'NO ROW',
  };
  s.server.close();
  await s.session.close();
  return out;
}

const KB64 = 64 * 1024;
const result = {
  sequential: await scenario('rd-seq', async (sink, errors) => {
    await writes(sink, 'stdout', KB64, 16, errors);
    await writes(sink, 'stderr', KB64, 64, errors);
  }),
};
say('RESULT', result);
process.exit(0);
