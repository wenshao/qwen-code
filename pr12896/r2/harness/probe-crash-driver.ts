/**
 * Verification-rig probe driver (not part of PR #12896). Derived from
 * hosted-process-crash-driver.ts; adds crash boundaries the PR does not cover
 * and records a wire ledger of every proxied Store/Broker exchange.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { lstat, open, readFile, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fakeToolCall, startFakeOpenAIServer } from '../fake-openai-server.js';
import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';

const configPath = process.argv[2];
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  tenantId: string;
  sessionId: string;
  workspaceId: string;
  directory: string;
  fault: string;
  storeUrl: string;
  brokerUrl: string;
  controlUrl: string;
};
type Transaction = { transactionId: string; recordBytesBase64: string };

// probe case -> PR base behaviour + expectations
const CASES: Record<
  string,
  {
    base: string;
    fifo: boolean;
    effect: 'x' | 'xx' | 'fifo';
    start: number;
    prepare: number;
    toolResults: number;
    loads: number;
  }
> = {
  'harness-acquire': { base: 'harness-acquire', fifo: false, effect: 'x', prepare: 0, start: 0, toolResults: 0, loads: 1 },
  'harness-intent': { base: 'harness-intent', fifo: false, effect: 'x', prepare: 1, start: 0, toolResults: 0, loads: 1 },
  'harness-before-start': { base: 'harness-before-start', fifo: false, effect: 'x', prepare: 1, start: 1, toolResults: 0, loads: 1 },
  'harness-result-committed': { base: 'harness-result-committed', fifo: false, effect: 'xx', prepare: 1, start: 1, toolResults: 1, loads: 1 },
  'harness-double-load': { base: 'harness-start', fifo: true, effect: 'xx', prepare: 1, start: 1, toolResults: 0, loads: 3 },
  'spring-kill-release': { base: 'spring-kill', fifo: true, effect: 'xx', prepare: 1, start: 1, toolResults: 0, loads: 1 },
  'spring-kill-slow': { base: 'spring-kill', fifo: true, effect: 'fifo', prepare: 1, start: 1, toolResults: 0, loads: 1 },
  'worker-stop-resume': { base: 'worker-stop', fifo: true, effect: 'xx', prepare: 1, start: 1, toolResults: 0, loads: 1 },
};
const spec = CASES[config.fault];
assert(spec, `unknown probe ${config.fault}`);
const base = spec.base;
const leaseDurationMs = 5_000; // round 2: same lease as the PR driver
const t0 = Date.now();
const report = {
  fault: config.fault,
  base,
  promptId: randomUUID(),
  executionCallId: '',
  idempotencyKey: '',
  modelCalls: 0,
  operations: [] as string[],
  signalEvidence: [] as unknown[],
  restoreTransactions: [] as Transaction[],
  loads: [] as unknown[],
  wire: [] as unknown[],
  notes: [] as unknown[],
};
const proof = path.join(config.directory, 'proof.txt');
if (spec.fifo) execFileSync('mkfifo', [proof]);
else await writeFile(proof, 'x');
let writer: FileHandle | undefined;
let cli = new HostedHarnessProcess();
let clientId = '';
let restoring = false;
let injected = false;
let serviceKilled = false;
let proxyFailure: unknown;

function events(transaction: Transaction) {
  return Buffer.from(transaction.recordBytesBase64, 'base64')
    .toString()
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((record) => record.subtype === 'managed_session_event_v1')
    .map((record) => record.managedSession);
}

async function control(operation: string) {
  const response = await fetch(`${config.controlUrl}/${operation}`, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

let firstHarnessOutput = '';
async function killHarness() {
  if (!firstHarnessOutput) firstHarnessOutput = cli.output;
  assert(cli.child?.pid);
  const pid = cli.child.pid;
  const exited = once(cli.child, 'exit');
  assert(cli.child.kill('SIGKILL'));
  const [code, signal] = await exited;
  assert.equal(code, null);
  assert.equal(signal, 'SIGKILL');
  report.signalEvidence.push({ process: 'harness', pid, signal, at: Date.now() - t0 });
}

async function enteredTool() {
  await waitUntil(async () => {
    try {
      writer = await open(proof, constants.O_WRONLY | constants.O_NONBLOCK);
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENXIO') throw cause;
      return false;
    }
  });
  assert((await lstat(proof)).isFIFO());
  const evidence = await control('evidence');
  assert.equal(evidence.executionState, 'EXECUTING');
  assert.equal(evidence.dispatchGeneration, 1);
}

async function releaseFifo() {
  await writer!.write('x');
  await writer!.close();
  writer = undefined;
}

const proxy = createServer(async (req, res) => {
  let entry: Record<string, unknown> = {};
  try {
    const store = req.url!.startsWith('/internal/managed-session-store/');
    const url = new URL(req.url!, store ? config.storeUrl : config.brokerUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const fields = body.length
      ? JSON.parse(body.toString())
      : Object.fromEntries(url.searchParams);
    const commit = store && url.pathname.endsWith('/transactions:commit');
    const kinds = commit
      ? events(fields).map((event) =>
          event.kind === 'message.committed'
            ? `${event.kind}:${event.payload.role}`
            : event.kind,
        )
      : [];
    const operation =
      req.method === 'GET' ? 'status' : url.pathname.split(':').at(-1)!;
    entry = {
      at: Date.now() - t0,
      side: store ? 'store' : 'broker',
      op: store ? url.pathname.split('/').at(-1) : operation,
      ...(kinds.length ? { kinds } : {}),
      restoring,
    };
    report.wire.push(entry);
    let killAfterForward = false;
    if (commit && !restoring && !injected) {
      if (
        base === 'harness-result-committed' &&
        kinds.includes('message.committed:tool_result')
      )
        killAfterForward = true;
      if (base === 'harness-intent' && kinds.includes('tool.intent'))
        killAfterForward = true;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value && !['host', 'connection', 'content-length'].includes(name))
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
    if (!store) {
      assert.equal(fields.harnessSessionId, config.sessionId);
      assert.equal(fields.runtimeSessionId, report.promptId);
      assert.notEqual(operation, 'release', 'Unsettled execution must retain its owner');
      report.operations.push(operation);
      const executionId = url.pathname.match(/\/executions\/([^/:]+)/)?.[1];
      if (executionId) assert.equal(executionId, report.executionCallId);
      if (base === 'harness-before-start' && operation === 'start' && !injected) {
        const evidence = await control('evidence');
        report.notes.push({ beforeStart: evidence });
        await killHarness();
        injected = true;
        entry['killed'] = 'harness (start request withheld)';
        res.destroy();
        return;
      }
    }
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      ...(body.length ? { body } : {}),
      signal: AbortSignal.timeout(40_000),
    });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    const json = upstream.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(bytes.toString())
      : undefined;
    entry['status'] = upstream.status;
    if (json?.code) entry['code'] = json.code;
    if (!store && json?.status?.state) entry['state'] = json.status.state;
    if (!serviceKilled) {
      if (upstream.status === 409) {
        assert(
          injected && !store && ['status', 'cancel'].includes(operation) && base.startsWith('worker-'),
          `${url}: ${bytes}`,
        );
        assert.equal(json.code, 'runtime_broker_execution_unknown');
      } else assert.equal(upstream.status, 200, `${url}: ${bytes}`);
    }
    if (restoring && store && url.pathname.endsWith('/transactions'))
      report.restoreTransactions.push(...json.transactions);
    if (killAfterForward) {
      const evidence = await control('evidence');
      report.notes.push({ atKill: evidence });
      await killHarness();
      injected = true;
      entry['killed'] = 'harness (Store committed, reply withheld)';
      res.destroy();
      return;
    }
    if (!store && operation === 'acquire' && base === 'harness-acquire' && !injected) {
      await killHarness();
      injected = true;
      entry['killed'] = 'harness (acquire reply withheld)';
      res.destroy();
      return;
    }
    if (!store && operation === 'prepare') {
      assert.equal(report.executionCallId, '');
      report.executionCallId = json.executionCallId;
      report.idempotencyKey = fields.idempotencyKey;
    }
    if (!store && operation === 'start' && spec.fifo) {
      assert.equal(injected, false);
      assert.equal(json.status.state, 'executing');
      await enteredTool();
      if (base === 'harness-start') {
        await killHarness();
        await releaseFifo();
        injected = true;
        entry['killed'] = 'harness (start reply withheld)';
        res.destroy();
        return;
      }
      serviceKilled = base === 'spring-kill';
      const signal = await control(base);
      report.signalEvidence.push({ process: base, ...signal, at: Date.now() - t0 });
      if (serviceKilled) {
        assert.notEqual(signal.pid, signal.newPid);
        config.storeUrl = signal.storeUrl;
        config.brokerUrl = signal.brokerUrl;
      }
      injected = true;
    }
    for (const [name, value] of upstream.headers)
      if (!['content-length', 'transfer-encoding', 'connection'].includes(name))
        res.setHeader(name, value);
    res.writeHead(upstream.status);
    res.end(bytes);
  } catch (cause) {
    entry['error'] = String(cause).slice(0, 200);
    if (!serviceKilled || !(cause instanceof TypeError)) proxyFailure = cause;
    res.destroy();
  }
});
await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const address = proxy.address();
assert(address && typeof address !== 'string');
const proxyUrl = `http://127.0.0.1:${address.port}`;
const model = await startFakeOpenAIServer(() => {
  report.modelCalls++;
  if (report.modelCalls > 1) return { content: 'UNEXPECTED_CONTINUATION' };
  return {
    toolCalls: [
      fakeToolCall(
        'edit',
        { file_path: 'proof.txt', old_string: 'x', new_string: 'xx', replace_all: true },
        'effect',
      ),
    ],
  };
});

async function json(route: string, body?: unknown, expected = 200) {
  if (proxyFailure) throw proxyFailure;
  const response = await cli.request(route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...cli.headers(clientId), 'Content-Type': 'application/json' },
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
      workspaceId: config.workspaceId,
      writerId: cli.bootId,
      leaseDurationMs,
    },
    toolProfile: 'hosted-workspace-files/1',
  };
}

async function start() {
  await cli.start(model.baseUrl, {
    extraArgs: ['--managed-runtime-broker-url', proxyUrl, '--managed-runtime-broker-token', 'hosted-tools-broker-token'],
  });
  await writeFile(path.join(cli.root, 'proof.txt'), 'decoy');
}

async function proofState() {
  return (await lstat(proof)).isFIFO() ? 'fifo' : await readFile(proof, 'utf8');
}

async function assertEffect() {
  assert.equal(await proofState(), spec.effect);
  assert.equal(await readFile(path.join(cli.root, 'proof.txt'), 'utf8'), 'decoy');
}

try {
  await start();
  const boot = cli.bootId;
  const route = `/session/${config.sessionId}`;
  const created = await json('/session', { ...connection(), sessionId: config.sessionId, sessionScope: 'thread' });
  clientId = created.clientId;
  const prompt = [{ type: 'text', text: config.fault }];
  await json(
    `${route}/prompt`,
    {
      promptId: report.promptId,
      prompt,
      payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(prompt)).digest('hex')}`,
    },
    202,
  );
  await waitUntil(() => {
    if (proxyFailure) throw proxyFailure;
    return injected;
  }, 60_000);
  if (base === 'harness-start')
    await waitUntil(async () => (await control('evidence')).executionState === 'SETTLED');
  if (!base.startsWith('harness-')) {
    await waitUntil(async () => !(await json(`${route}/status`)).hasActivePrompt, 90_000);
    const status = await json(`${route}/status`);
    report.notes.push({ liveStatus: { recoveryBlocked: status.recoveryBlocked, hasActivePrompt: status.hasActivePrompt } });
    assert.equal(status.recoveryBlocked, true);
    report.notes.push({ blockedEvidence: await control('evidence'), at: Date.now() - t0 });
    if (config.fault === 'worker-stop-resume') {
      report.signalEvidence.push({ process: 'worker', ...(await control('worker-cont')), at: Date.now() - t0 });
      await releaseFifo();
      await waitUntil(async () => (await proofState()) === 'xx', 20_000);
      report.notes.push({ lateEffectAt: Date.now() - t0 });
      // Give the Broker time to observe any late worker completion.
      const until = Date.now() + 8_000;
      const states = new Set<string>();
      await waitUntil(async () => {
        const evidence = await control('evidence');
        states.add(`${evidence.executionState}/${evidence.executionStatus ?? null}`);
        return Date.now() >= until;
      }, 20_000);
      report.notes.push({ afterLateCompletion: [...states] });
    }
    if (config.fault === 'spring-kill-release') {
      await releaseFifo();
      await waitUntil(async () => (await proofState()) === 'xx', 20_000);
      report.notes.push({ orphanEffectAt: Date.now() - t0 });
      const until = Date.now() + 5_000;
      await waitUntil(async () => Date.now() >= until, 10_000);
      report.notes.push({ afterOrphanCompletion: await control('evidence') });
    }
    await killHarness();
  }
  await assertEffect();
  assert.equal(report.modelCalls, 1);
  for (const [operation, count] of [
    ['acquire', 1],
    ['prepare', spec.prepare],
    ['start', spec.start],
  ] as const)
    assert.equal(report.operations.filter((value) => value === operation).length, count, operation);
  await cli.close();
  for (let load = 1; load <= spec.loads; load++) {
    const leaseDeadline = Date.now() + leaseDurationMs + 100;
    await waitUntil(() => Date.now() >= leaseDeadline);
    const previousBoot = cli.bootId;
    cli = new HostedHarnessProcess();
    await start();
    assert.notEqual(cli.bootId, previousBoot);
    assert.notEqual(cli.bootId, boot);
    restoring = true;
    report.restoreTransactions = [];
    const operations = report.operations.length;
    const loaded = await json(`${route}/load`, connection(), 409);
    const restored = report.restoreTransactions.flatMap(events);
    report.loads.push({
      load,
      error: loaded.error,
      restoreTransactions: report.restoreTransactions.length,
      restoredEvents: restored.length,
      kinds: restored.reduce((acc: Record<string, number>, event) => {
        const kind = event.kind === 'message.committed' ? `${event.kind}:${event.payload.role}` : event.kind;
        acc[kind] = (acc[kind] ?? 0) + 1;
        return acc;
      }, {}),
    });
    assert.equal(loaded.error, 'hosted_turn_recovery_required');
    assert(report.restoreTransactions.length > 0);
    assert.equal(restored.filter((event) => event.kind === 'input.accepted' && event.payload.turnId === report.promptId).length, 1);
    assert.equal(restored.filter((event) => event.kind === 'turn.settled').length, 0);
    assert.equal(
      restored.filter((event) => event.kind === 'message.committed' && event.payload.role === 'tool_result').length,
      spec.toolResults,
    );
    assert.equal(report.operations.length, operations, 'Cold load must not contact Broker');
    assert.equal(report.modelCalls, 1, 'Cold load must not call the model');
    await assertEffect();
    restoring = false;
    if (load < spec.loads) await cli.close();
  }
  if (proxyFailure) throw proxyFailure;
  const { restoreTransactions: _r, ...summary } = report;
  await writeFile(`${configPath}.results`, JSON.stringify(summary));
  console.log(`PROBE ${config.fault}: execution=${report.executionCallId}, loads=${JSON.stringify(report.loads)}`);
  console.log(`PROBE_WIRE ${config.fault} ${JSON.stringify(report.wire)}`);
  console.log(`PROBE_NOTES ${config.fault} ${JSON.stringify(report.notes)} signals=${JSON.stringify(report.signalEvidence)}`);
  console.log(`PROBE_HARNESS_LOG ${JSON.stringify(firstHarnessOutput.split("\n").filter((line) => /Hosted Harness|RIG|recovery/.test(line)))}`);
  console.log('HOSTED_PROCESS_CRASH_OK');
} catch (cause) {
  const { restoreTransactions: _r, ...summary } = report;
  console.error(`PROBE_FAIL ${config.fault}`, JSON.stringify(summary), cli.output);
  throw cause;
} finally {
  await cli.close();
  await writer?.close();
  await model.close();
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
}
