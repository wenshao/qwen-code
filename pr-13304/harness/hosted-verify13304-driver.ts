/**
 * PR #13304 maintainer verification driver (scratch, not part of the PR).
 *
 * Drives the packaged Hosted Harness CLI against the real Spring Session
 * Store, the real embedded Runtime Broker and the real bundled worker on
 * MySQL, through one recording proxy that injects two faults:
 *
 *  - ack-loss:      the Broker applies the first Shell acknowledgement, then
 *                   the proxy destroys the reply (R2-23).
 *  - drain-delete:  at acknowledgement time the proxy opens a request on the
 *                   turn's own Shell publisher and never finishes its body,
 *                   so the publisher drain cannot complete; the client then
 *                   tries DELETE /session/:id (R2-33).
 *  - drain-overlap: same held drain; the client submits the next prompt.
 *
 * It records observations only; arm expectations are judged afterwards.
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
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

const T0 = Date.now();
const now = () => Date.now() - T0;

type Hold = {
  openedAt: number;
  closedAt?: number;
  serverReply?: string;
  socket: net.Socket;
};

const reports = config.sessions.map((session) => ({
  ...session,
  promptIds: [] as string[],
  modelCalls: 0,
  broker: [] as Array<{
    at: number;
    op: string;
    status: number;
    replyDelivered: boolean;
    acknowledged?: unknown;
    code?: unknown;
    runtimeState?: unknown;
  }>,
  acks: [] as Array<{ at: number; receiptDigest: string }>,
  settledAt: [] as number[],
  receipts: 0,
  publishers: [] as string[],
  hold: undefined as Hold | undefined,
  timeline: [] as Array<Record<string, unknown>>,
  result: {} as Record<string, unknown>,
  cliTail: '',
}));
type Report = (typeof reports)[number];
let current: Report = reports[0];
let cli = new HostedHarnessProcess();
let clientId = '';
let proxyFailure: unknown;

function events(fields: { recordBytesBase64?: string }) {
  if (!fields.recordBytesBase64) return [];
  return Buffer.from(fields.recordBytesBase64, 'base64')
    .toString()
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((record) => record.subtype === 'managed_session_event_v1')
    .map((record) => record.managedSession);
}

function holdPublisher(report: Report, url: string, token: string) {
  const target = new URL(url);
  const socket = net.connect(Number(target.port), target.hostname);
  const hold: Hold = { openedAt: now(), socket };
  socket.on('data', (data) => {
    hold.serverReply = (hold.serverReply ?? '') + data.toString();
  });
  socket.on('error', () => undefined);
  socket.on('close', () => {
    hold.closedAt = now();
  });
  socket.write(
    `POST ${target.pathname} HTTP/1.1\r\nHost: ${target.host}\r\n` +
      `Authorization: Bearer ${token}\r\nContent-Type: application/json\r\n` +
      'Content-Length: 64\r\n\r\n{',
  );
  report.hold = hold;
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
    const report = reports.find((entry) => entry.sessionId === sessionId);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value && !['host', 'connection', 'content-length'].includes(name))
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const operation =
      req.method === 'GET' ? 'status' : url.pathname.split(':').at(-1)!;
    if (!store && report && operation === 'publisher') {
      report.publishers.push(fields.publisher.url);
      (report as Report & { publisher?: unknown }).publisher = fields.publisher;
    }
    if (!store && report && operation === 'acknowledge') {
      report.acks.push({
        at: now(),
        receiptDigest: createHash('sha256')
          .update(JSON.stringify(fields.receipt))
          .digest('hex')
          .slice(0, 16),
      });
      const publisher = (
        report as Report & { publisher?: { url: string; token: string } }
      ).publisher;
      if (
        report.fault.startsWith('drain-') &&
        report.acks.length === 1 &&
        publisher
      ) {
        holdPublisher(report, publisher.url, publisher.token);
        // Let the held request reach the publisher's route before replying.
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      ...(body.length ? { body } : {}),
      signal: AbortSignal.timeout(35_000),
    });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    const json = upstream.headers
      .get('content-type')
      ?.includes('application/json')
      ? JSON.parse(bytes.toString())
      : undefined;
    if (store && report && upstream.ok) {
      if (url.pathname.endsWith('/transactions:commit')) {
        for (const event of events(fields)) {
          if (event.kind === 'turn.settled') report.settledAt.push(now());
          if (event.kind === 'tool.receipt') report.receipts++;
        }
      }
    }
    let replyDelivered = true;
    if (
      !store &&
      report?.fault === 'ack-loss' &&
      operation === 'acknowledge' &&
      report.acks.length === 1
    ) {
      replyDelivered = false;
    }
    if (!store && report)
      report.broker.push({
        at: now(),
        op: operation,
        status: upstream.status,
        replyDelivered,
        ...(operation === 'acknowledge'
          ? {
              acknowledged: json?.acknowledged,
              code: json?.code,
              runtimeState: json?.status?.state,
            }
          : {}),
      });
    if (!replyDelivered) {
      // The Broker and the Runtime applied it; only the reply is lost.
      res.destroy();
      return;
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
const proxyUrl = 'http://127.0.0.1:' + address.port;

const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const model = await startFakeOpenAIServer(({ body }) => {
  current.modelCalls++;
  const messages = body['messages'] as Array<{ role: string }>;
  if (messages.at(-1)?.role === 'tool') return { content: 'shell turn done' };
  const producer =
    "require('fs').appendFileSync('proof.txt', 'x');" +
    "process.stdout.write('verify-13304-effect\\n');";
  return {
    toolCalls: [
      fakeToolCall(
        'run_shell_command',
        {
          command: quote(process.execPath) + ' -e ' + quote(producer),
          timeout: 60_000,
        },
        'shell-' + randomUUID().slice(0, 8),
      ),
    ],
  };
});

async function call(
  route: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
) {
  if (proxyFailure) throw proxyFailure;
  const response = await cli.request(route, {
    method,
    headers: { ...cli.headers(clientId), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

function promptInput(text: string) {
  const prompt = [{ type: 'text', text }];
  const promptId = randomUUID();
  current.promptIds.push(promptId);
  return {
    promptId,
    prompt,
    payloadDigest:
      'sha256:' +
      createHash('sha256').update(JSON.stringify(prompt)).digest('hex'),
  };
}

async function status(route: string) {
  return (await call(route + '/status', 'GET')).body as {
    hasActivePrompt: boolean;
    recoveryBlocked: boolean;
  };
}

async function proof() {
  return readFile(path.join(current.directory, 'proof.txt'), 'utf8').catch(
    () => '',
  );
}

async function waitIdle(route: string, timeout = 90_000) {
  const started = now();
  await waitUntil(async () => !(await status(route)).hasActivePrompt, timeout);
  return now() - started;
}

try {
  for (current of reports) {
    cli = new HostedHarnessProcess();
    await cli.start(model.baseUrl, {
      extraArgs: [
        '--managed-runtime-broker-url',
        proxyUrl,
        '--managed-runtime-broker-token',
        'hosted-tools-broker-token',
      ],
    });
    const route = '/session/' + current.sessionId;
    const created = await call('/session', 'POST', {
      managedSessionStore: {
        baseUrl: proxyUrl,
        tenantId: config.tenantId,
        workspaceId: current.workspaceId,
        writerId: cli.bootId,
        leaseDurationMs: 5_000,
      },
      toolProfile: 'hosted-workspace-shell/1',
      sessionId: current.sessionId,
      sessionScope: 'thread',
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    clientId = created.body['clientId'] as string;
    const first = await call(route + '/prompt', 'POST', promptInput('one'));
    assert.equal(first.status, 202, JSON.stringify(first.body));
    const result = current.result;

    if (current.fault === 'ack-loss') {
      result['turn1IdleAfterMs'] = await waitIdle(route);
      const after1 = await status(route);
      result['afterTurn1'] = after1;
      result['proofAfterTurn1'] = await proof();
      const second = await call(route + '/prompt', 'POST', promptInput('two'));
      result['prompt2'] = { status: second.status, body: second.body };
      if (second.status === 202) {
        await waitIdle(route);
        result['afterTurn2'] = await status(route);
      }
      result['proofFinal'] = await proof();
    } else {
      // Wait for the durable turn.settled of prompt 1, then probe availability.
      await waitUntil(() => current.settledAt.length >= 1, 90_000);
      const settled = current.settledAt[0]!;
      result['holdOpenedAt'] = current.hold?.openedAt;
      result['turn1SettledAt'] = settled;
      const WINDOW_MS = 75_000;
      const probe = async (
        name: string,
        attempt: () => Promise<{ status: number; body: Record<string, unknown> }>,
        success: number,
        limitMs: number,
      ) => {
        const started = now();
        while (true) {
          const outcome = await attempt();
          current.timeline.push({
            at: now(),
            sinceSettledMs: now() - settled,
            probe: name,
            status: outcome.status,
            error: outcome.body['error'],
            heldDrainOpen: current.hold?.closedAt === undefined,
          });
          if (outcome.status === success) return true;
          if (now() - started > limitMs) return false;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      };
      const releaseHold = async () => {
        result['holdReleasedByClientAt'] = now();
        current.hold?.socket.destroy();
        await waitUntil(() => current.hold?.closedAt !== undefined, 5_000);
      };
      if (current.fault === 'drain-linger') {
        const deleted = await probe(
          'DELETE',
          () => call(route, 'DELETE'),
          204,
          WINDOW_MS,
        );
        result['deletedWithinWindow'] = deleted;
        const lingerFrom = now();
        await new Promise((resolve) => setTimeout(resolve, 65_000));
        result['heldDrainOpen65sAfterDelete'] =
          current.hold?.closedAt === undefined;
        result['lingerCheckedAfterMs'] = now() - lingerFrom;
        await releaseHold();
      } else if (current.fault === 'drain-delete') {
        const deleted = await probe(
          'DELETE',
          () => call(route, 'DELETE'),
          204,
          WINDOW_MS,
        );
        result['deletedWithinWindow'] = deleted;
        if (!deleted) {
          await releaseHold();
          result['deletedAfterRelease'] = await probe(
            'DELETE after hold released',
            () => call(route, 'DELETE'),
            204,
            10_000,
          );
        }
      } else {
        const tryPrompt = async () => {
          const next = await call(route + '/prompt', 'POST', promptInput('two'));
          if (next.status !== 202) current.promptIds.pop();
          return next;
        };
        let admitted = await probe('POST prompt', tryPrompt, 202, WINDOW_MS);
        result['admittedWithinWindow'] = admitted;
        if (!admitted) {
          await releaseHold();
          admitted = await probe(
            'POST prompt after hold released',
            tryPrompt,
            202,
            10_000,
          );
        }
        if (admitted) {
          await waitIdle(route);
          result['afterTurn2'] = await status(route);
          result['turn2SettledAt'] = current.settledAt[1];
          result['heldDrainOpenWhenTurn2Settled'] =
            current.hold?.closedAt === undefined ||
            (current.settledAt[1] ?? Infinity) < current.hold.closedAt;
        }
        result['proofFinal'] = await proof();
        const deleted = await call(route, 'DELETE');
        result['finalDelete'] = deleted.status;
      }
      result['holdClosedAt'] = current.hold?.closedAt;
      result['holdServerReply'] = current.hold?.serverReply
        ?.split('\r\n')[0]
        ?.trim();
    }
    current.hold?.socket.destroy();
    if (current.fault === 'ack-loss') {
      const deleted = await call(route, 'DELETE');
      result['finalDelete'] = deleted.status;
    }
    current.cliTail = cli.output
      .split('\n')
      .filter((line) => line.includes('qwen serve:'))
      .join('\n');
    await cli.close();
    console.log(
      'VERIFY13304 ' + current.fault + ' ' + JSON.stringify(current.result),
    );
  }
  if (proxyFailure) throw proxyFailure;
  await writeFile(
    configPath + '.results',
    JSON.stringify(
      reports.map(({ hold, ...rest }) => ({
        ...Object.fromEntries(
          Object.entries(rest).filter(([key]) => key !== 'publisher'),
        ),
        hold: hold && {
          openedAt: hold.openedAt,
          closedAt: hold.closedAt,
          serverReply: hold.serverReply?.split('\r\n')[0],
        },
      })),
      null,
      2,
    ),
  );
  console.log('HOSTED_VERIFY13304_OK');
} catch (cause) {
  console.error('VERIFY13304 ' + current.fault, cause, cli.output);
  throw cause;
} finally {
  for (const report of reports) report.hold?.socket.destroy();
  await cli.close();
  await model.close();
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
}
