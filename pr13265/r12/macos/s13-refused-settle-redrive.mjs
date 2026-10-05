// S13 (round 9, head 370d933332): the two witnesses c9009271dc added, replayed
// on the real stack — the PR's HostedShellPublisher, ManagedShellPublisherRegistry,
// HostedChildRunSession and HostedMonitorSession over the HTTP Managed Session
// store (Spring + MySQL), with the production toolResultResources. A background
// Shell and a Monitor end before their start receipt: the finalize is refused,
// then the attach lands. Re-drive arm: settleAttached (what the tool turn's
// accept arms now call). Control arm: the same attach without it (round-8
// behaviour).
import http from 'node:http';
import { createRequire } from 'node:module';
import { BINDING_1, WT, createPublicSession, javaRows, openSession, records, say, openLog } from './lib.mjs';

for (const d of ['child_run', 'monitor_run']) if (!records.MANAGED_SESSION_ENABLED_DOMAINS.includes(d)) records.MANAGED_SESSION_ENABLED_DOMAINS.push(d);
openLog('s13-refused-settle-redrive');
const CLI = `${WT}/packages/cli/dist/src/serve`;
const CORE = `${WT}/packages/core/dist/src/managed-runtime`;
const { HostedChildRunSession } = await import(`${CLI}/hosted-child-run-session.js`);
const { HostedMonitorSession } = await import(`${CLI}/hosted-monitor-session.js`);
const { HostedShellPublisher } = await import(`${CLI}/hosted-shell-publisher.js`);
const { ManagedShellPublisherRegistry } = await import(`${CLI}/managed-shell-publisher.js`);
const { MANAGED_TOOL_RESULT_PROTOCOL } = await import(`${CORE}/managed-tool-result.js`);
const { parseChildRun } = await import(`${CORE}/managed-child-run-record.js`);
const { parseMonitorRun } = await import(`${CORE}/managed-extension-record.js`);
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
  return { pub, session, sessionKey, childRuns, monitors, publisher, descriptor, registry, server };
}

function request(key, executionCallId, monitoring) {
  return {
    reference: { sessionId: 'runtime-a', promptId: 'prompt-a', callId: `worker-${executionCallId}`, argsDigest: `sha256:${'a'.repeat(64)}` },
    capture: { tenantId: key.tenantId, sessionId: key.sessionId, turnId: 'turn-a', ...(monitoring ? { monitoring: true } : {}), executionCallId, bindingGeneration: '1', capturePolicy: 'complete_required', background: true },
  };
}

async function finalize(s, executionCallId) {
  const res = await fetch(s.descriptor.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.descriptor.token}`, 'cache-control': 'no-store', 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'finalize', executionCallId, started: true, failed: false, process: { exitCode: 0, signal: null, previewBytes: 0 }, executionStatus: 'success', responseParts: [], previewTruncated: false, error: null }),
  });
  const text = await res.text();
  return `${res.status}${res.status >= 400 ? ' ' + (text.match(/"message":"([^"]{0,90})/)?.[1] ?? text.slice(0, 90)) : ''}`;
}

const javaRow = (s, id) => {
  const row = javaRows(s.pub.id).find((r) => r[0] === id);
  return row ? `rev${row[2]} ${row[4]}/${row[5]}` : 'NO ROW';
};

async function shellCase(redrive) {
  const s = await stack(`writer-s13-shell-${redrive ? 'r' : 'c'}`);
  const id = `exec-late-${redrive ? 'redrive' : 'control'}`;
  await s.childRuns.admit({ shellId: id, ownerScopeId: s.sessionKey.sessionId, executionCallId: id, args: { command: 'echo bye', is_background: true } });
  await s.childRuns.dispatchStarted(id, BINDING_1);
  const req = request(s.sessionKey, id, false);
  s.publisher.register({ reference: req.reference, capture: req.capture }, 'model-call-a', req.reference.sessionId);
  const prepared = await s.registry.prepare(req);
  prepared.sink.setStarted(7);
  await prepared.sink.write('stdout', Buffer.from('done\n'));
  prepared.sink.setProcessResult(PROCESS_OK);
  await prepared.sink.finish('stdout', true);
  await prepared.sink.finish('stderr', true);
  const first = await finalize(s, id);
  const before = parseChildRun(s.session.authority.extensionRecord('child_run', id).record);
  const javaBefore = javaRow(s, id);
  await s.childRuns.attach(id, BINDING_1, { pid: 7 });
  if (redrive) await s.publisher.settleAttached(id);
  const after = parseChildRun(s.session.authority.extensionRecord('child_run', id).record);
  const out = {
    finalizeBeforeAttach: first,
    beforeAttach: `${before.run.state}/${before.run.execution} stopReason=${before.stopReason}`,
    javaBeforeAttach: javaBefore,
    afterAttach: `${after.run.state}/${after.run.execution} stopReason=${after.stopReason} outputRef=${after.outputRef ? 'set' : 'null'}`,
    javaAfterAttach: javaRow(s, id),
  };
  s.server.close();
  await s.session.close();
  return out;
}

async function monitorCase(redrive) {
  const s = await stack(`writer-s13-mon-${redrive ? 'r' : 'c'}`);
  const id = `mon-late-${redrive ? 'redrive' : 'control'}`;
  await s.monitors.admit({ monitorId: id, ownerScopeId: s.sessionKey.sessionId, executionCallId: id, args: { command: 'tail -f log', description: 'log watch' }, maxEvents: 100, idleTimeoutMs: 60_000, debounceMs: 1_000 });
  await s.monitors.dispatchStarted(id, BINDING_1);
  const req = request(s.sessionKey, id, true);
  s.publisher.register({ reference: req.reference, capture: req.capture }, 'model-call-m', req.reference.sessionId);
  const prepared = await s.registry.prepare(req);
  prepared.sink.setStarted(9);
  await prepared.sink.write('stdout', Buffer.from('first\nlast\n'));
  prepared.sink.setProcessResult(PROCESS_OK);
  await prepared.sink.finish('stdout', true);
  const first = await finalize(s, id);
  const before = parseMonitorRun(s.session.authority.extensionRecord('monitor_run', id).record);
  const javaBefore = javaRow(s, id);
  await s.monitors.attach(id, BINDING_1, { pid: 9 });
  if (redrive) await s.publisher.settleAttached(id);
  const after = parseMonitorRun(s.session.authority.extensionRecord('monitor_run', id).record);
  let lines = null;
  if (after.lastObservationRef) lines = JSON.parse((await s.session.resources.read(after.lastObservationRef)).toString('utf8')).lines;
  const out = {
    finalizeBeforeAttach: first,
    beforeAttach: `obs ${before.observationSequence} notified ${before.notifiedThrough} stopReason=${before.stopReason}`,
    javaBeforeAttach: javaBefore,
    afterAttach: `${after.run.state}/${after.run.execution} obs ${after.observationSequence} notified ${after.notifiedThrough} stopReason=${after.stopReason}`,
    observedLines: lines,
    javaAfterAttach: javaRow(s, id),
  };
  s.server.close();
  await s.session.close();
  return out;
}

const result = {};
for (const [name, fn] of [['shellRedrive', () => shellCase(true)], ['shellControl', () => shellCase(false)], ['monitorRedrive', () => monitorCase(true)], ['monitorControl', () => monitorCase(false)]]) {
  try { result[name] = await fn(); } catch (e) { result[name] = { error: String(e?.message ?? e).slice(0, 200) }; }
}
say('RESULT', result);
process.exit(0);
