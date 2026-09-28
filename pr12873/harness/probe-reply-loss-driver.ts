/**
 * Verification-only probe driver for PR #12873 (not part of the PR).
 * Same Harness / Spring / Broker / worker stack as
 * hosted-broker-reply-loss-driver.ts, with prepare faults the PR's gate
 * does not exercise:
 *   prepare-timeout       Broker applies prepare, reply held > 30 s (TimeoutError branch)
 *   prepare-truncated     Broker applies prepare, reply cut after half the body
 *   prepare-request-lost  first prepare request never reaches the Broker
 *   prepare-late-original first request held, reaches the Broker after the retry
 *   prepare-gateway-502   Broker applies prepare, an intermediary answers 502 (HTML)
 *   prepare-gateway-504j  Broker applies prepare, an intermediary answers 504 (JSON)
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
type Reply = {
  executionCallId?: string;
  status?: { state: string; result?: { executionStatus: string } };
};
type Exchange = {
  operation: string;
  executionCallId?: string;
  fields: Record<string, unknown>;
  reply: Reply;
  note?: string;
  at: number;
};
const RECOVERED = new Set([
  'prepare-timeout',
  'prepare-truncated',
  'prepare-request-lost',
  'prepare-late-original',
]);
const cli = new HostedHarnessProcess();
let sessionId = '';
let clientId = '';
let promptId = '';
let fault = '';
let fired = 0;
let modelCalls = 0;
let proxyFailure: unknown;
let exchanges: Exchange[] = [];
let prepareSeen = 0;
let heldOriginal: { url: string; body: Buffer } | undefined;
const harnessErrors: string[] = [];
const t0 = Date.now();

async function json(route: string, body?: unknown, expected = 200) {
  const response = await cli.request(route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...cli.headers(clientId), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, expected, text + cli.output);
  return text ? JSON.parse(text) : undefined;
}

async function upstream(route: string, body?: Buffer) {
  const response = await fetch(new URL(route, config.brokerUrl), {
    method: body?.length ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer hosted-tools-broker-token',
      'Content-Type': 'application/json',
    },
    ...(body?.length ? { body } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `${route}: ${text}`);
  return { text, reply: JSON.parse(text) as Reply };
}

function closed(res: ServerResponse) {
  return new Promise<void>((resolve) => {
    if (res.socket?.destroyed) resolve();
    else res.on('close', () => resolve());
  });
}

const proxy = createServer(async (req, res) => {
  try {
    const route = new URL(req.url!, config.brokerUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const fields = body.length
      ? (JSON.parse(body.toString()) as Record<string, unknown>)
      : Object.fromEntries(route.searchParams);
    const operation =
      req.method === 'GET' ? 'status' : route.pathname.split(':').at(-1)!;
    const executionCallId = route.pathname.match(/\/executions\/([^/:]+)/)?.[1];
    assert.equal(fields['harnessSessionId'], sessionId);
    assert.equal(fields['runtimeSessionId'], promptId);
    const first = operation === 'prepare' && ++prepareSeen === 1;
    if (first && fault === 'prepare-request-lost') {
      fired++;
      exchanges.push({ operation, fields, reply: {}, note: 'request dropped before Broker', at: Date.now() - t0 });
      res.destroy();
      return;
    }
    if (first && fault === 'prepare-late-original') {
      fired++;
      heldOriginal = { url: req.url!, body };
      await closed(res); // the Harness gives up after its 30 s timeout
      exchanges.push({ operation, fields, reply: {}, note: `original held; client closed at ${Date.now() - t0} ms`, at: Date.now() - t0 });
      return;
    }
    const { text, reply } = await upstream(req.url!, body);
    exchanges.push({ operation, executionCallId, fields, reply, at: Date.now() - t0 });
    if (operation === 'prepare' && fault === 'prepare-late-original' && heldOriginal) {
      // Deliver the stale original to the Broker after the retry was applied
      // and before the Harness can start the execution.
      const late = await upstream(heldOriginal.url, heldOriginal.body);
      exchanges.push({
        operation: 'prepare',
        fields: JSON.parse(heldOriginal.body.toString()),
        reply: late.reply,
        note: 'late original delivered after retry',
        at: Date.now() - t0,
      });
      heldOriginal = undefined;
    }
    if (first && fault === 'prepare-timeout') {
      fired++;
      const started = Date.now();
      await closed(res);
      exchanges.at(-1)!.note = `reply held; Harness closed after ${Date.now() - started} ms`;
      return;
    }
    if (first && fault === 'prepare-truncated') {
      fired++;
      const bytes = Buffer.from(text);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(bytes.length),
      });
      res.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
      await delay(50);
      res.destroy();
      return;
    }
    if (first && fault === 'prepare-gateway-502') {
      fired++;
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>502 Bad Gateway</h1></body></html>');
      return;
    }
    if (first && fault === 'prepare-gateway-504j') {
      fired++;
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'gateway_timeout' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (cause) {
    proxyFailure = cause;
    res.destroy();
  }
});
await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const address = proxy.address();
assert(address && typeof address !== 'string');
const model = await startFakeOpenAIServer(({ body }) => {
  modelCalls++;
  const messages = body['messages'] as Array<{
    role: string;
    content: unknown;
  }>;
  const receipts = messages.filter((message) => message.role === 'tool');
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
  assert.equal(receipts.length, 1);
  assert.match(JSON.stringify(receipts[0].content), /has been updated/);
  return { content: 'FAULT_TURN_DONE' };
});
const reports: Array<{
  fault: string;
  promptId: string;
  executionCallId?: string;
  idempotencyKey?: unknown;
}> = [];

function input(text: string) {
  const prompt = [{ type: 'text', text }];
  return {
    promptId: randomUUID(),
    prompt,
    payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(prompt)).digest('hex')}`,
  };
}

try {
  await cli.start(model.baseUrl, {
    extraArgs: [
      '--managed-runtime-broker-url',
      `http://127.0.0.1:${address.port}`,
      '--managed-runtime-broker-token',
      'hosted-tools-broker-token',
    ],
  });
  await writeFile(path.join(cli.root, 'proof.txt'), 'decoy');
  for (const session of config.sessions) {
    ({ sessionId, fault } = session);
    fired = 0;
    modelCalls = 0;
    prepareSeen = 0;
    exchanges = [];
    const connection = {
      baseUrl: config.storeUrl,
      tenantId: config.tenantId,
      workspaceId: session.workspaceId,
      writerId: cli.bootId,
      leaseDurationMs: 60_000,
    };
    const created = await json('/session', {
      sessionId,
      sessionScope: 'thread',
      managedSessionStore: connection,
      toolProfile: 'hosted-workspace-files/1',
    });
    clientId = created.clientId;
    const command = input(fault);
    promptId = command.promptId;
    const began = Date.now();
    await json(`/session/${sessionId}/prompt`, command, 202);
    await waitUntil(async () => {
      if (proxyFailure) throw proxyFailure;
      return !(await json(`/session/${sessionId}/status`)).hasActivePrompt;
    }, 110_000);
    const turnMs = Date.now() - began;
    assert.equal(fired, 1, `${fault}: fault did not fire`);
    const recovered = RECOVERED.has(fault);
    const status = await json(`/session/${sessionId}/status`);
    const events: Array<{
      type: string;
      promptId?: string;
      data: { record?: { type?: string }; error?: unknown; message?: unknown };
    }> = [];
    let cursor = '0';
    while (true) {
      const page = await json(
        `/session/${sessionId}/transcript?cursor=${cursor}&limit=256`,
      );
      events.push(...page.events);
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    const terminals = events.filter(
      (event) => event.promptId === promptId && event.type.startsWith('turn_'),
    );
    const results = events.filter(
      (event) => event.data.record?.type === 'tool_result',
    );
    const prepared = exchanges.filter(
      (entry) => entry.operation === 'prepare' && entry.reply.executionCallId,
    );
    const executionCallId = prepared[0]?.reply.executionCallId;
    const idempotencyKey = prepared[0]?.fields['idempotencyKey'];
    const starts = exchanges.filter((entry) => entry.operation === 'start').length;
    const file = await readFile(path.join(session.directory, 'proof.txt'), 'utf8');
    const summary = {
      fault,
      turnMs,
      recoveryBlocked: status.recoveryBlocked,
      modelCalls,
      terminal: terminals.map((event) => event.type),
      toolResults: results.length,
      upstreamPrepares: prepared.length,
      distinctExecutionIds: [...new Set(prepared.map((entry) => entry.reply.executionCallId))],
      starts,
      releases: exchanges.filter((entry) => entry.operation === 'release').length,
      file,
      decoy: await readFile(path.join(cli.root, 'proof.txt'), 'utf8'),
      exchanges: exchanges.map((entry) => ({
        at: entry.at,
        operation: entry.operation,
        requestId: entry.fields['requestId'],
        idempotencyKey: entry.fields['idempotencyKey'],
        executionCallId: entry.reply.executionCallId,
        state: entry.reply.status?.state,
        note: entry.note,
      })),
    };
    console.log(`PROBE_SUMMARY ${JSON.stringify(summary)}`);
    for (const match of cli.output.matchAll(/[^\n]*(?:recovery|Recovery|Broker|TimeoutError|terminated|fetch failed)[^\n]*/g))
      harnessErrors.push(match[0].slice(0, 300));
    // Expectations
    assert.equal(summary.decoy, 'decoy');
    assert.equal(summary.distinctExecutionIds.length, 1, 'exactly one reservation identity');
    if (recovered) {
      assert.equal(status.recoveryBlocked, false, `${fault} should recover`);
      assert.deepEqual(summary.terminal, ['turn_complete']);
      assert.equal(modelCalls, 2);
      assert.equal(results.length, 1);
      assert.equal(starts, 1);
      assert.equal(file, 'xx');
      const retried = exchanges.filter((entry) => entry.operation === 'prepare' && !entry.note?.startsWith('late'));
      if (fault === 'prepare-late-original') assert.equal(exchanges.filter((entry) => entry.note?.startsWith('late')).length, 1, 'late original reached the Broker');
      assert.equal(retried.length, 2);
      assert.deepEqual(
        { ...retried[1].fields, requestId: 'x' },
        { ...retried[0].fields, requestId: 'x' },
      );
    } else {
      assert.equal(status.recoveryBlocked, true, `${fault} should block`);
      assert.deepEqual(summary.terminal, []);
      assert.equal(modelCalls, 1);
      assert.equal(starts, 0);
      assert.equal(file, 'x');
      assert.equal(exchanges.filter((entry) => entry.operation === 'prepare').length, 1);
      const rejected = await json(`/session/${sessionId}/prompt`, input('must remain blocked'), 409);
      assert.equal(rejected.error, 'hosted_turn_recovery_required');
    }
    const traffic = exchanges.length;
    await json(`/session/${sessionId}/detach`, {}, 204);
    const loaded = await json(
      `/session/${sessionId}/load`,
      { managedSessionStore: connection, toolProfile: 'hosted-workspace-files/1' },
      recovered ? 200 : 409,
    );
    if (recovered) {
      clientId = loaded.clientId;
      await json(`/session/${sessionId}/detach`, {}, 204);
    }
    assert.equal(exchanges.length, traffic, 'Reload must not replay Broker work');
    reports.push({ fault, promptId, executionCallId, idempotencyKey });
    console.log(`PROBE ${fault}: OK recovered=${recovered} turnMs=${turnMs}`);
  }
  await writeFile(`${configPath}.results`, JSON.stringify(reports));
  console.log(`PROBE_HARNESS_LOG ${JSON.stringify(harnessErrors.slice(0, 20))}`);
  console.log('HOSTED_REPLY_LOSS_OK');
} catch (cause) {
  console.error(`PROBE_FAIL ${fault}`, JSON.stringify(exchanges), cli.output.slice(-6000));
  throw cause;
} finally {
  await cli.close();
  await model.close();
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
}
