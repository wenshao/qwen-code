/**
 * Verification-only probe driver (not part of PR #12924).
 * Cases:
 *   batch - two Edit calls in one assistant message; cancel while call 1 is
 *           parked in its FIFO read. Call 2 must never start.
 *   crash - cancel while the Edit is parked, SIGKILL the Harness while the
 *           Broker still says cancel_requested, then let the Edit finish and
 *           cold-load the Session in a fresh Harness.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fakeToolCall, startFakeOpenAIServer } from '../fake-openai-server.js';
import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';

const configPath = process.argv[2];
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  tenantId: string;
  storeUrl: string;
  brokerUrl: string;
  statusGateUrl: string;
  sessions: Array<{ sessionId: string; workspaceId: string; directory: string; fault: string }>;
};
const reports: unknown[] = [];
let cli = new HostedHarnessProcess();
let sessionId = '';
let clientId = '';
let promptId = '';
let fault = '';
let proof = '';
let proof2 = '';
let modelCalls = 0;
let statusHeld = false;
let writer: FileHandle | undefined;
let resumeStatus = () => {};
let operations: string[] = [];
let executionIds: string[] = [];
let proxyFailure: unknown;
let cancelledOnce = false;

async function json(route: string, body?: unknown, expected = 200) {
  if (proxyFailure) throw proxyFailure;
  const response = await cli.request(route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...cli.headers(clientId), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, expected, text + cli.output);
  return text ? JSON.parse(text) : undefined;
}

async function evidence(phase: string) {
  const url = new URL(`/cancellation/${sessionId}/${phase}`, config.statusGateUrl);
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

const proxy = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, config.brokerUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const operation = req.method === 'GET' ? 'status' : url.pathname.split(':').at(-1)!;
    const id = url.pathname.match(/\/executions\/([^/:]+)/)?.[1];
    operations.push(id ? `${operation}#${executionIds.indexOf(id) + 1}` : operation);
    const upstream = await fetch(url, {
      method: req.method,
      headers: { Authorization: 'Bearer hosted-tools-broker-token', 'Content-Type': 'application/json' },
      ...(body.length ? { body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await upstream.text();
    const reply = JSON.parse(text);
    if (operation === 'prepare') executionIds.push(reply.executionCallId);
    if (operation === 'start' && executionIds.indexOf(id!) === 0 && !cancelledOnce) {
      // Park call 1 in its real FIFO read, then cancel through the Harness API.
      await waitUntil(async () => {
        try {
          writer = await open(proof, constants.O_WRONLY | constants.O_NONBLOCK);
          return true;
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ENXIO') throw cause;
          return false;
        }
      });
      cancelledOnce = true;
      await json(`/session/${sessionId}/cancel`, {}, 204);
    }
    if (operation === 'status' && id === executionIds[0] && reply.status?.state === 'cancel_requested' && !statusHeld) {
      await new Promise<void>((resolve) => {
        resumeStatus = resolve;
        statusHeld = true;
      });
    }
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (cause) {
    proxyFailure ??= cause;
    res.destroy();
  }
});
await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const address = proxy.address();
assert(address && typeof address !== 'string');
const proxyUrl = `http://127.0.0.1:${address.port}`;
const model = await startFakeOpenAIServer(() => {
  modelCalls++;
  const edit = (file: string, id: string) =>
    fakeToolCall('edit', { file_path: file, old_string: 'x', new_string: 'xx', replace_all: true }, id);
  return {
    toolCalls: fault === 'batch' ? [edit('proof.txt', 'effect-1'), edit('proof2.txt', 'effect-2')] : [edit('proof.txt', 'effect')],
  };
});

async function start() {
  await cli.start(model.baseUrl, {
    extraArgs: ['--managed-runtime-broker-url', proxyUrl, '--managed-runtime-broker-token', 'hosted-tools-broker-token'],
  });
}

async function transcript() {
  const events: Array<{ type: string; data: { stopReason?: string; record?: { type?: string } } }> = [];
  let cursor = '0';
  while (true) {
    const page = await json(`/session/${sessionId}/transcript?cursor=${cursor}&limit=256`);
    events.push(...page.events);
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  return {
    ends: events.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}:${e.data.stopReason}`),
    toolResults: events.filter((e) => e.data.record?.type === 'tool_result').length,
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

try {
  for (const session of config.sessions) {
    ({ sessionId, fault } = session);
    proof = path.join(session.directory, 'proof.txt');
    proof2 = path.join(session.directory, 'proof2.txt');
    modelCalls = 0;
    statusHeld = false;
    cancelledOnce = false;
    operations = [];
    executionIds = [];
    await unlink(proof);
    execFileSync('mkfifo', [proof]);
    if (fault === 'batch') await writeFile(proof2, 'x');
    await start();
    const connection = () => ({
      managedSessionStore: {
        baseUrl: config.storeUrl,
        tenantId: config.tenantId,
        workspaceId: session.workspaceId,
        writerId: cli.bootId,
        leaseDurationMs: fault === 'crash' ? 5_000 : 60_000,
      },
      toolProfile: 'hosted-workspace-files/1',
    });
    const created = await json('/session', { ...connection(), sessionId, sessionScope: 'thread' });
    clientId = created.clientId;
    const command = input(fault);
    promptId = command.promptId;
    await json(`/session/${sessionId}/prompt`, command, 202);
    await waitUntil(async () => statusHeld);
    const live = await json(`/session/${sessionId}/status`);
    console.log(`PROBE ${fault} held: hasActivePrompt=${live.hasActivePrompt} recoveryBlocked=${live.recoveryBlocked} ops=${JSON.stringify(operations)}`);
    assert((await lstat(proof)).isFIFO());
    let killed = '';
    let killedAt = 0;
    if (fault === 'crash') {
      const pid = cli.child!.pid;
      cli.child!.kill('SIGKILL');
      killedAt = Date.now();
      await waitUntil(async () => cli.child!.signalCode !== null);
      killed = `SIGKILL harness pid ${pid}`;
      console.log(`PROBE ${fault} ${killed} while Broker state=${(await evidence('state')).state}`);
    }
    await writer!.write('x');
    await writer!.close();
    writer = undefined;
    resumeStatus();
    if (fault === 'crash') {
      await waitUntil(async () => (await evidence('state')).state === 'SETTLED');
      await cli.close();
    } else {
      await waitUntil(async () => !(await json(`/session/${sessionId}/status`)).hasActivePrompt);
    }
    const liveAfter = fault === 'crash' ? undefined : await json(`/session/${sessionId}/status`);
    const liveTranscript = fault === 'crash' ? undefined : await transcript();
    const traffic = operations.length;
    if (fault !== 'crash') {
      await json(`/session/${sessionId}/detach`, {}, 204);
      await cli.close();
    }
    cli = new HostedHarnessProcess();
    await start();
    let early = '';
    if (fault === 'crash') {
      const first = await cli.request(`/session/${sessionId}/load`, {
        method: 'POST',
        headers: { ...cli.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(connection()),
      });
      early = `${first.status} ${(JSON.parse(await first.text())).error ?? 'loaded'} at +${Date.now() - killedAt}ms`;
      await waitUntil(async () => Date.now() >= killedAt + 5_100);
    }
    const response = await cli.request(`/session/${sessionId}/load`, {
      method: 'POST',
      headers: { ...cli.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(connection()),
    });
    const loadedText = await response.text();
    const loaded = JSON.parse(loadedText);
    let coldTranscript: unknown;
    if (response.status === 200) {
      clientId = loaded.clientId;
      coldTranscript = await transcript();
      await json(`/session/${sessionId}/detach`, {}, 204);
    }
    const summary = {
      fault,
      killed,
      live: liveAfter && { hasActivePrompt: liveAfter.hasActivePrompt, recoveryBlocked: liveAfter.recoveryBlocked },
      liveTranscript,
      ...(early ? { coldWithinLease: early } : {}),
      cold: `${response.status} ${loaded.error ?? 'loaded'}`,
      coldTranscript,
      brokerOpsDuringColdLoad: operations.length - traffic,
      operations,
      modelCalls,
      proof: await readFile(proof, 'utf8'),
      ...(fault === 'batch' ? { proof2: await readFile(proof2, 'utf8') } : {}),
      executions: executionIds,
    };
    console.log(`PROBE_RESULT ${JSON.stringify(summary)}`);
    await cli.close();
    cli = new HostedHarnessProcess();
    reports.push(summary);
  }
  await writeFile(`${configPath}.results`, JSON.stringify(reports));
  console.log('HOSTED_CANCELLATION_OK');
} catch (cause) {
  console.error(`PROBE ${fault}`, JSON.stringify(operations), cli.output);
  throw cause;
} finally {
  resumeStatus();
  await cli.close();
  await writer?.close();
  await model.close();
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
}
