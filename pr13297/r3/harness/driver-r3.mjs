// PR 13297 broker E2E driver: the BUILT BrokerManagedRuntimeProvider of one arm
// against the real Runtime Broker HTTP face (JDBC on MySQL behind the fault
// proxy) and a real managed-runtime-worker. fetch is wrapped only to record
// each request (path + status); responses are the Broker's own.
// usage: node driver.mjs <repo> <brokerPort> <token> <proxyControlPort> <ws>
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, brokerPort, token, controlPort, ws] = process.argv.slice(2);
setTimeout(() => {
  console.log('RESULT driver_timeout = true');
  process.exit(3);
}, 600_000).unref();
const { BrokerManagedRuntimeProvider } = await import(
  pathToFileURL(path.join(repo, 'packages/cli/dist/src/serve/broker-managed-runtime-provider.js')).href
);
const result = (key, value) => console.log(`RESULT ${key} = ${JSON.stringify(value)}`);
const log = [];
const base = `http://127.0.0.1:${brokerPort}`;
const recordingFetch = async (input, init) => {
  const url = new URL(String(input));
  const entry = { route: url.pathname.replace(/^\/internal\/runtime-broker\/v1/, ''), method: init?.method ?? 'GET' };
  log.push(entry);
  try {
    const response = await fetch(input, init);
    entry.status = response.status;
    if (!response.ok) {
      const text = await response.clone().text();
      try {
        const body = JSON.parse(text);
        entry.code = body.code;
        entry.retryable = body.retryable;
      } catch {
        entry.code = text.slice(0, 60);
      }
    }
    return response;
  } catch (error) {
    entry.status = `transport:${error?.name}`;
    throw error;
  }
};
const store = async (mode) => (await fetch(`http://127.0.0.1:${controlPort}/${mode}`)).json();
const settle = (p) =>
  p.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error: `${error?.code ?? ''} ${error?.status ?? ''} ${error?.message ?? error}`.trim() }),
  );
const window = (from) =>
  log.slice(from).map((e) => `${e.method} ${e.route} -> ${e.status}${e.code ? ` ${e.code}` : ''}${e.retryable === undefined ? '' : ` retryable=${e.retryable}`}`);

const provider = new BrokerManagedRuntimeProvider({ baseUrl: base, token, fetch: recordingFetch });
const harnessSessionId = randomUUID();
const runtimeSessionId = randomUUID();
const request = {
  protocolVersion: 1,
  tenantId: 'tenant-rig',
  workspaceId: 'workspace-rig',
  workspaceCwd: ws,
  sessionId: runtimeSessionId,
  turnKind: 'bootstrap',
};
const client = await provider.getToolV2Client(request, { harnessSessionId });
const manifest = await client.manifest();
result('manifest_tools', manifest.tools.length);
const identity = (callId) => ({
  sessionId: runtimeSessionId,
  promptId: 'turn-1',
  callId,
  capabilityDigest: manifest.capabilityDigest,
  policyRevision: manifest.policyRevision,
});
// E0 (R2-1): a restore snapshot whose tracked path climbs out with a
// backslash, sent through the Broker control route to the real worker.
const now = new Date().toISOString();
const binding = (snapshots) => ({
  ownerSessionId: harnessSessionId,
  ownerRuntimeSessionId: runtimeSessionId,
  executionCwd: ws,
  snapshots,
});
const climb = (key) => [
  {
    promptId: 'turn-0',
    timestamp: now,
    trackedFileBackups: { [key]: { backupFileName: null, version: 1, backupTime: now } },
  },
];
for (const key of ['..\\outside.txt', '../outside.txt', 'sub\\..\\..\\outside.txt']) {
  const bound = await settle(client.fileHistory.bind(binding(climb(key))));
  result(`e0_bind_${JSON.stringify(key)}`, bound.ok ? 'accepted' : bound.error);
}
const clean = await settle(client.fileHistory.bind(binding([])));
result('e0_bind_clean', clean.ok ? 'accepted' : clean.error);
await client.beginTurn(identity('call-1'));
const prepare = async (callId, file) => {
  const prepared = await client.prepare(identity(callId), 'write_file', {
    file_path: path.join(ws, file),
    content: `written by ${callId}\n`,
  });
  const reference = {
    sessionId: prepared.sessionId,
    promptId: prepared.promptId,
    callId: prepared.callId,
    capabilityDigest: prepared.capabilityDigest,
    policyRevision: prepared.policyRevision,
    invocationId: prepared.invocationId,
    argsDigest: prepared.argsDigest,
  };
  await client.preflight(reference);
  return reference;
};

// E1 (R1-3 + the Java mapFailure): the reservation fails during a real store
// outage; after the store heals, the same invocation is executed again.
const ref1 = await prepare('call-1', 'e1.txt');
let mark = log.length;
result('store', await store('down'));
const t0 = Date.now();
const first = await settle(client.execute(ref1));
result('e1_execute_during_outage', first.ok ? first.value.executionStatus : first.error);
result('e1_execute_during_outage_ms', Date.now() - t0);
result('e1_wire_during_outage', window(mark));
mark = log.length;
const read = await settle(client.status(ref1));
result('e1_status_during_outage', read.ok ? read.value.state : read.error);
result('e1_status_wire', window(mark));
result('store', await store('up'));
mark = log.length;
const second = await settle(client.execute(ref1));
result('e1_execute_after_heal', second.ok ? second.value.executionStatus : second.error);
result('e1_wire_after_heal', window(mark));
result('e1_file', await readFile(path.join(ws, 'e1.txt'), 'utf8').then((t) => t.trim(), () => 'absent'));

// E2: a settled execution's read/cancel routes during a store outage, sent
// raw to the Broker so every route's own answer is visible.
const ref2 = await prepare('call-2', 'e2.txt');
const done = await settle(client.execute(ref2));
result('e2_execute', done.ok ? done.value.executionStatus : done.error);
const prepared2 = log.findLast((e) => e.route === '/executions:prepare' && e.status === 200);
result('e2_prepare_seen', Boolean(prepared2));
result('store', await store('down'));
mark = log.length;
const read2 = await settle(client.status(ref2));
result('e2_status_during_outage', read2.ok ? read2.value.state : read2.error);
const cancel2 = await settle(client.cancel(ref2));
result('e2_cancel_during_outage', cancel2.ok ? cancel2.value?.state ?? 'ok' : cancel2.error);
result('e2_wire_during_outage', window(mark));
result('store', await store('up'));
mark = log.length;
const read3 = await settle(client.status(ref2));
result('e2_status_after_heal', read3.ok ? read3.value.state : read3.error);
result('e2_wire_after_heal', window(mark));

// E3: reservation lands, then the store goes down before start; after the
// heal the same invocation runs again (start-path eviction).
const ref3 = await prepare('call-3', 'e3.txt');
const reserved3 = await settle(client.prepareExecution(ref3));
result('e3_reserved', reserved3.ok ? 'ok' : reserved3.error);
result('store', await store('down'));
mark = log.length;
const start3 = reserved3.ok ? await settle(client.startExecution(ref3, reserved3.value.executionCallId)) : { ok: false, error: 'no reservation' };
result('e3_start_during_outage', start3.ok ? start3.value.executionStatus : start3.error);
result('e3_wire_during_outage', window(mark));
result('store', await store('up'));
mark = log.length;
const again3 = await settle(client.execute(ref3));
result('e3_execute_after_heal', again3.ok ? again3.value.executionStatus : again3.error);
result('e3_wire_after_heal', window(mark));
result('e3_file', await readFile(path.join(ws, 'e3.txt'), 'utf8').then((t) => t.trim(), () => 'absent'));

// E4 (R7-1): a deterministic client-input error on the start route, raw
// over HTTP: a deferred reservation whose payload carries 1e309.
const { createHash } = await import('node:crypto');
const raw = async (method, route, body) => {
  const response = await fetch(`${base}/internal/runtime-broker/v1${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 80) }; }
  return { status: response.status, code: parsed.code, retryable: parsed.retryable, executionCallId: parsed.executionCallId };
};
const payload = '{"toolName":"write_file","input":{"x":1e309}}';
const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
const ids = { protocolVersion: 1, harnessSessionId, runtimeSessionId };
const reserve4 = await raw('POST', '/executions:prepare', {
  ...ids, requestId: 'e4-prepare', idempotencyKey: `e4-${runtimeSessionId}`, turnId: 'turn-e4', toolCallId: 'call-e4', requestDigest: digest,
  reference: { sessionId: runtimeSessionId, promptId: 'turn-e4', callId: 'call-e4', argsDigest: digest },
});
result('e4_reserve', `${reserve4.status}${reserve4.code ? ' ' + reserve4.code : ''}`);
if (reserve4.executionCallId) {
  const start4 = await raw('POST', `/executions/${reserve4.executionCallId}:start`, { ...ids, requestId: 'e4-start', payloadJson: payload });
  result('e4_start_1e309', `${start4.status} ${start4.code} retryable=${start4.retryable}`);
  const again4 = await raw('POST', `/executions/${reserve4.executionCallId}:start`, { ...ids, requestId: 'e4-start-2', payloadJson: payload });
  result('e4_start_1e309_again', `${again4.status} ${again4.code} retryable=${again4.retryable}`);
}

// E5 (open Suggestion R1-23): the two routes the PR left outside the store
// mapping, :acknowledge and :publisher, under the same real JDBC outage.
const started1 = log.find((e) => /^\/executions\/[^/:]+:start$/.test(e.route) && e.status === 200);
const e5Id = started1 ? started1.route.slice('/executions/'.length, -':start'.length) : 'none';
result('e5_execution', e5Id);
const e5Ack = (tag) => raw('POST', `/executions/${e5Id}:acknowledge`, { ...ids, requestId: `e5-ack-${tag}`, receipt: { executionCallId: e5Id } });
const e5Pub = (tag) => raw('POST', `/tool-sessions/${runtimeSessionId}:publisher`, { ...ids, requestId: `e5-pub-${tag}`, publisher: { kind: 'rig' } });
const e5Fmt = (r) => `${r.status} ${r.code} retryable=${r.retryable}`;
result('store', await store('down'));
result('e5_acknowledge_during_outage', e5Fmt(await e5Ack('down')));
result('e5_publisher_during_outage', e5Fmt(await e5Pub('down')));
result('store', await store('up'));
result('e5_acknowledge_after_heal', e5Fmt(await e5Ack('up')));
result('e5_publisher_after_heal', e5Fmt(await e5Pub('up')));

const released = await settle(provider.release(runtimeSessionId, request));
result('release', released.ok ? released.value : released.error);
provider.dispose?.();
process.exit(0);
