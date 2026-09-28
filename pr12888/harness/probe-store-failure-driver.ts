/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fakeToolCall, startFakeOpenAIServer } from '../fake-openai-server.js';
import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';

const configPath = process.argv[2];
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  tenantId: string;
  storeUrl: string;
  brokerUrl: string;
  sessions: Array<{
    sessionId: string;
    workspaceId: string;
    directory: string;
    fault: string;
  }>;
};
type Transaction = {
  transactionId: string;
  commandId: string;
  recordBytesBase64: string;
  latestCheckpointResourceId?: string;
  resources: Array<{
    resourceId: string;
    kind: string;
    bytesBase64?: string;
  }>;
};
type Event = { kind: string; payload: Record<string, unknown> };
type Receipt = { journalRevision: number; replayed: boolean };
const reports = config.sessions.map((session) => ({
  ...session,
  promptId: '',
  clientId: '',
  executionCallId: '',
  idempotencyKey: '',
  modelCalls: 0,
  faults: 0,
  commits: [] as string[],
  broker: [] as string[],
  operations: [] as string[],
  target: undefined as Transaction | undefined,
  receipt: undefined as Receipt | undefined,
  restoreTransactions: [] as Transaction[],
}));
let cli = new HostedHarnessProcess();
let current = reports[0];
let restoring = false;
let proxyFailure: unknown;

function events(transaction: Transaction): Event[] {
  return Buffer.from(transaction.recordBytesBase64, 'base64')
    .toString()
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((record) => record.subtype === 'managed_session_event_v1')
    .map((record) => record.managedSession);
}

// VERIFICATION PROBE (not part of PR): map probe names onto the PR's selection logic.
const BASE: Record<string, string> = {
  'intent-reply': 'intent',
  'await-runtime-reply': 'await-runtime',
  'result-checkpoint-reply': 'result-checkpoint',
  'batch-result-message': 'result-message',
};
function describe(transaction: Transaction) {
  const kinds = events(transaction).map((event) =>
    event.kind === 'message.committed' ? 'message:' + String(event.payload['role']) : event.kind,
  );
  const checkpoint = transaction.resources.find(
    (resource) => resource.resourceId === transaction.latestCheckpointResourceId && resource.bytesBase64,
  );
  const phase = checkpoint
    ? JSON.parse(Buffer.from(checkpoint.bytesBase64!, 'base64').toString()).continuation?.phase
    : undefined;
  return [(transaction as unknown as { operation: string }).operation, ...kinds, ...(phase ? ['phase=' + phase] : [])].join(' ');
}
function selected(transaction: Transaction, probe: string) {
  const committed = events(transaction);
  if (probe === 'assistant-reply')
    return committed.some((event) => event.kind === 'message.committed' && event.payload['role'] === 'assistant');
  const fault = BASE[probe] ?? probe;
  if (fault === 'arguments' || fault === 'intent') {
    const intent = committed.find((event) => event.kind === 'tool.intent');
    if (!intent) return false;
    const argument = transaction.resources.find(
      (resource) => resource.kind === 'managed-tool-input',
    );
    assert(argument?.bytesBase64);
    assert.equal(
      (intent.payload['argsRef'] as { resourceId: string }).resourceId,
      argument.resourceId,
    );
    return true;
  }
  if (fault === 'await-runtime' || fault === 'result-checkpoint') {
    const checkpoint = transaction.resources.find(
      (resource) =>
        resource.resourceId === transaction.latestCheckpointResourceId &&
        resource.kind === 'managed-checkpoint',
    );
    if (!checkpoint?.bytesBase64) return false;
    const state = JSON.parse(
      Buffer.from(checkpoint.bytesBase64, 'base64').toString(),
    );
    const matches =
      state.continuation.phase ===
      (fault === 'await-runtime' ? 'await_runtime' : 'results_ready');
    if (matches && fault === 'result-checkpoint')
      assert(
        transaction.resources.some(
          (resource) => resource.kind === 'managed-tool-outcome',
        ),
      );
    return matches;
  }
  return committed.some((event) =>
    fault === 'turn-reply'
      ? event.kind === 'turn.settled'
      : event.kind === 'message.committed' &&
        event.payload['role'] === 'tool_result',
  );
}

const proxy = createServer(async (req, res) => {
  try {
    const store = req.url!.startsWith('/internal/managed-session-store/');
    const url = new URL(req.url!, store ? config.storeUrl : config.brokerUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const fields = body.length
      ? JSON.parse(body.toString())
      : Object.fromEntries(url.searchParams);
    const sessionId = store
      ? url.pathname.match(/\/sessions\/([^/]+)/)?.[1]
      : fields.harnessSessionId;
    const report = reports.find((item) => item.sessionId === sessionId);
    assert(report, `Unexpected session: ${url}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value && !['host', 'connection', 'content-length'].includes(name))
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
    }
    const init = {
      method: req.method,
      headers,
      ...(body.length ? { body } : {}),
      signal: AbortSignal.timeout(30_000),
    };
    const commit = store && url.pathname.endsWith('/transactions:commit');
    const target = commit && !restoring && selected(fields, report.fault);
    if (target) {
      assert.equal(
        report.faults++,
        0,
        'Harness must not retry the failed write',
      );
      report.target = fields;
    }
    const upstream = await fetch(url, init);
    if (commit && !restoring) report.commits.push(describe(fields) + ' -> ' + upstream.status + (target ? (report.fault.endsWith('-reply') ? ' [REPLY DROPPED]' : ' [TARGET]') : ''));
    const bytes = Buffer.from(await upstream.arrayBuffer());
    const json = upstream.headers
      .get('content-type')
      ?.includes('application/json')
      ? JSON.parse(bytes.toString())
      : undefined;
    if (target) {
      if (report.fault.endsWith('-reply')) {
        assert.equal(upstream.status, 200, bytes.toString());
        assert.equal(json.replayed, false);
        report.receipt = json;
        // Probe the Store's exact-request replay contract without retrying the Harness write.
        const replay = await fetch(url, init);
        assert.equal(replay.status, 200, await replay.clone().text());
        assert.deepEqual(await replay.json(), { ...json, replayed: true });
        res.destroy();
        return;
      }
      assert.equal(upstream.status, 500, bytes.toString());
    } else assert.equal(upstream.status, 200, `${url}: ${bytes}`);
    if (restoring && store && url.pathname.endsWith('/transactions'))
      report.restoreTransactions.push(...json.transactions);
    if (!store) {
      assert.equal(fields.runtimeSessionId, report.promptId);
      const operation =
        req.method === 'GET' ? 'status' : url.pathname.split(':').at(-1)!;
      report.operations.push(operation);
      report.broker.push((restoring ? 'cold:' : '') + operation);
      if (operation === 'prepare') {
        if (!report.fault.startsWith('batch-')) assert.equal(report.executionCallId, '');
        else if (report.executionCallId) { report.broker.push('prepare#2 ' + json.executionCallId.slice(0, 8)); }
        if (!report.executionCallId) report.executionCallId = json.executionCallId;
        report.idempotencyKey = fields.idempotencyKey;
      }
      const executionId = url.pathname.match(/\/executions\/([^/:]+)/)?.[1];
      if (executionId && !report.fault.startsWith('batch-')) {
        assert.equal(executionId, report.executionCallId);
        assert.equal(json.executionCallId, report.executionCallId);
      }
    }
    for (const [name, value] of upstream.headers)
      if (!['content-length', 'transfer-encoding', 'connection'].includes(name))
        res.setHeader(name, value);
    res.writeHead(upstream.status);
    res.end(bytes);
  } catch (cause) {
    proxyFailure = cause;
    res.destroy();
  }
});
await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const address = proxy.address();
assert(address && typeof address !== 'string');
const proxyUrl = `http://127.0.0.1:${address.port}`;
const model = await startFakeOpenAIServer(({ body }) => {
  current.modelCalls++;
  const messages = body['messages'] as Array<{
    role: string;
    content: unknown;
  }>;
  const receipts = messages.filter((message) => message.role === 'tool');
  if (!receipts.length && current.fault.startsWith('batch-'))
    return {
      toolCalls: [
        fakeToolCall('edit', { file_path: 'proof.txt', old_string: 'x', new_string: 'xx', replace_all: true }, 'effect-1'),
        fakeToolCall('edit', { file_path: 'proof2.txt', old_string: 'y', new_string: 'yy', replace_all: true }, 'effect-2'),
      ],
    };
  if (!receipts.length)
    return {
      toolCalls: [
        fakeToolCall(
          'edit',
          {
            file_path: 'proof.txt',
            old_string: 'x',
            new_string: 'xx',
            replace_all: true,
          },
          'effect',
        ),
      ],
    };
  assert.equal(receipts.length, current.fault.startsWith('batch-') ? 2 : 1);
  assert.match(JSON.stringify(receipts[0].content), /has been updated/);
  return { content: 'STORE_FAULT_TURN_DONE' };
});

async function json(route: string, body?: unknown, expected = 200) {
  if (proxyFailure) throw proxyFailure;
  const response = await cli.request(route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...cli.headers(current.clientId),
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, expected, text + cli.output);
  if (proxyFailure) throw proxyFailure;
  return text ? JSON.parse(text) : undefined;
}

function connection() {
  return {
    managedSessionStore: {
      baseUrl: proxyUrl,
      tenantId: config.tenantId,
      workspaceId: current.workspaceId,
      writerId: cli.bootId,
      leaseDurationMs: 5_000,
    },
    toolProfile: 'hosted-workspace-files/1',
  };
}

function input(text: string) {
  const prompt = [{ type: 'text', text }];
  return {
    promptId: randomUUID(),
    prompt,
    payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(prompt)).digest('hex')}`,
  };
}

async function transcript() {
  const result: Array<{
    type: string;
    promptId?: string;
    data: { record?: { type: string } };
  }> = [];
  let cursor = '0';
  while (true) {
    const page = await json(
      `/session/${current.sessionId}/transcript?cursor=${cursor}&limit=256`,
    );
    result.push(...page.events);
    if (!page.hasMore) return result;
    cursor = page.nextCursor;
  }
}

async function start() {
  await cli.start(model.baseUrl, {
    extraArgs: [
      '--managed-runtime-broker-url',
      proxyUrl,
      '--managed-runtime-broker-token',
      'hosted-tools-broker-token',
    ],
  });
  await writeFile(path.join(cli.root, 'proof.txt'), 'decoy');
}

// VERIFICATION PROBE main loop: observe and report instead of asserting the PR's per-case expectations.
const summaries: Array<Record<string, unknown>> = [];
const read = (file: string) => readFile(file, 'utf8').catch(() => '(missing)');
try {
  await start();
  for (current of reports) {
    const summary: Record<string, unknown> = { fault: current.fault };
    summaries.push(summary);
    if (current.fault.startsWith('batch-'))
      await writeFile(path.join(current.directory, 'proof2.txt'), 'y');
    const created = await json('/session', {
      ...connection(),
      sessionId: current.sessionId,
      sessionScope: 'thread',
    });
    current.clientId = created.clientId;
    const command = input(current.fault);
    current.promptId = command.promptId;
    const route = `/session/${current.sessionId}`;
    const t0 = Date.now();
    await json(`${route}/prompt`, command, 202);
    await waitUntil(async () => !(await json(`${route}/status`)).hasActivePrompt);
    summary['turnMs'] = Date.now() - t0;
    summary['faultsFired'] = current.faults;
    summary['recoveryBlocked'] = (await json(`${route}/status`)).recoveryBlocked;
    summary['modelCalls'] = current.modelCalls;
    const records = await transcript();
    summary['liveTerminals'] = records.filter((event) => event.type.startsWith('turn_')).map((event) => event.type);
    summary['liveToolResults'] = records.filter((event) => event.data.record?.type === 'tool_result').length;
    summary['broker'] = [...current.broker];
    summary['file'] = await read(path.join(current.directory, 'proof.txt'));
    if (current.fault.startsWith('batch-'))
      summary['file2'] = await read(path.join(current.directory, 'proof2.txt'));
    summary['decoy'] = await read(path.join(cli.root, 'proof.txt'));
    const next = await cli.request(`${route}/prompt`, {
      method: 'POST',
      headers: { ...cli.headers(current.clientId), 'Content-Type': 'application/json' },
      body: JSON.stringify(input('must remain blocked')),
    });
    summary['nextPrompt'] = `${next.status} ${(await next.text()).slice(0, 80)}`;
    summary['commits'] = [...current.commits];
    summary['receiptReplayed'] = current.receipt ? true : undefined;
  }
  await cli.close();
  const leaseDeadline = Date.now() + 5_100;
  await waitUntil(() => Date.now() >= leaseDeadline);
  cli = new HostedHarnessProcess();
  await start();
  restoring = true;
  for (const [index, report] of reports.entries()) {
    current = report;
    const summary = summaries[index];
    const brokerBefore = current.broker.length;
    const calls = current.modelCalls;
    const response = await cli.request(`/session/${current.sessionId}/load`, {
      method: 'POST',
      headers: { ...cli.headers(current.clientId), 'Content-Type': 'application/json' },
      body: JSON.stringify(connection()),
    });
    const text = await response.text();
    summary['coldLoad'] = `${response.status} ${response.status === 200 ? '' : text.slice(0, 80)}`.trim();
    if (response.status === 200) {
      current.clientId = JSON.parse(text).clientId;
      const records = await transcript();
      summary['coldTerminals'] = records.filter((event) => event.type.startsWith('turn_')).map((event) => event.type);
      summary['coldToolResults'] = records.filter((event) => event.data.record?.type === 'tool_result').length;
      await json(`/session/${current.sessionId}/detach`, {}, 204);
    }
    summary['coldRestoredTransactions'] = current.restoreTransactions.length;
    summary['coldTargetRestored'] = current.target
      ? current.restoreTransactions.filter((transaction) => transaction.transactionId === current.target!.transactionId).length
      : 'no target';
    summary['coldBrokerCalls'] = current.broker.slice(brokerBefore);
    summary['coldModelCalls'] = current.modelCalls - calls;
    summary['fileAfterCold'] = await read(path.join(current.directory, 'proof.txt'));
    if (current.fault.startsWith('batch-'))
      summary['file2AfterCold'] = await read(path.join(current.directory, 'proof2.txt'));
    console.log('PROBE_SUMMARY ' + JSON.stringify(summary));
  }
  if (proxyFailure) throw proxyFailure;
  await writeFile(`${configPath}.results`, JSON.stringify(reports));
  console.log('HOSTED_STORE_FAILURES_OK');
} catch (cause) {
  console.error(`PROBE_FAIL ${current.fault}`, String(cause), JSON.stringify(current), cli.output);
  throw cause;
} finally {
  await cli.close();
  await model.close();
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
}
