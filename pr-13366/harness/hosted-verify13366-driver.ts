/**
 * PR #13366 maintainer verification driver (scratch, not part of the PR).
 *
 * Two Workspace-bound Hosted Sessions (A, B) share ONE Workspace mount on the
 * real Spring Session Store, the real embedded Runtime Broker (MySQL lease
 * row) and the real bundled worker. A single packaged `qwen serve` process
 * hosts both Sessions, as in production. One recording proxy fronts both the
 * Store and the Broker.
 *
 * Cases (each on its own Workspace mount):
 *  - pair:     A's shell tool holds the mount ~4 s; B prompts once A holds it.
 *  - long:     same, A holds ~40 s (8x the Store writer lease duration).
 *  - stranded: A's `:release` never reaches the Broker (proxy drops it), so A
 *              is recovery-blocked and its holder row is never cleared — the
 *              end state of #12937. B then prompts; after 30 s the client
 *              cancels B; B prompts again and the client DELETEs B mid-wait.
 *
 * It records observations only; arm expectations are judged afterwards.
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
  cases: Array<{
    name: string;
    workspaceId: string;
    directory: string;
    sessions: Array<{ role: 'A' | 'B'; sessionId: string }>;
  }>;
};

const T0 = Date.now();
const now = () => Date.now() - T0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Role = 'A' | 'B';
type SessionReport = {
  role: Role;
  sessionId: string;
  clientId: string;
  promptIds: string[];
  broker: Array<{ at: number; op: string; status: number; code?: unknown }>;
  droppedReleases: number[];
  settled: Array<{ at: number; payload: unknown }>;
  statusSamples: Array<{ at: number; active: boolean; blocked: boolean }>;
  transcript?: unknown;
  midQueueTranscript?: unknown;
};
type CaseReport = {
  name: string;
  directory: string;
  holdMs: number;
  sessions: Record<Role, SessionReport>;
  stderr: Array<{ at: number; line: string }>;
  result: Record<string, unknown>;
};

const HOLD: Record<string, number> = { pair: 4_000, long: 40_000, stranded: 1_000 };
const reports: CaseReport[] = config.cases.map((entry) => ({
  name: entry.name,
  directory: entry.directory,
  holdMs: HOLD[entry.name] ?? 4_000,
  sessions: Object.fromEntries(
    entry.sessions.map((session) => [
      session.role,
      {
        role: session.role,
        sessionId: session.sessionId,
        clientId: '',
        promptIds: [],
        broker: [],
        droppedReleases: [],
        settled: [],
        statusSamples: [],
      } satisfies SessionReport,
    ]),
  ) as Record<Role, SessionReport>,
  stderr: [],
  result: {},
}));
let current = reports[0]!;
let cli = new HostedHarnessProcess();
let proxyFailure: unknown;

function lookup(sessionId: unknown) {
  for (const report of reports)
    for (const session of Object.values(report.sessions))
      if (session.sessionId === sessionId) return { report, session };
  return undefined;
}

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
    const found = lookup(sessionId);
    const operation =
      req.method === 'GET'
        ? 'status'
        : url.pathname.includes('/control')
          ? 'control'
          : url.pathname.split(':').at(-1)!;
    if (
      !store &&
      found &&
      found.report.name === 'stranded' &&
      found.session.role === 'A' &&
      operation === 'release'
    ) {
      // The release never reaches the Broker: the holder row stays set.
      found.session.droppedReleases.push(now());
      res.destroy();
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value && !['host', 'connection', 'content-length'].includes(name))
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
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
      ? (JSON.parse(bytes.toString()) as Record<string, unknown>)
      : undefined;
    if (store && found && upstream.ok) {
      if (url.pathname.endsWith('/transactions:commit'))
        for (const event of events(fields))
          if (event.kind === 'turn.settled')
            found.session.settled.push({ at: now(), payload: event.payload });
    }
    if (!store && found)
      found.session.broker.push({
        at: now(),
        op: operation,
        status: upstream.status,
        ...(upstream.ok ? {} : { code: json?.['code'] }),
      });
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
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const marker = JSON.stringify(messages).match(
    /VERIFY13366 case=(\w+) role=(\w) n=(\d+)/,
  );
  if (messages.at(-1)?.role === 'tool' || !marker)
    return { content: 'turn done ' + (marker?.[2] ?? '?') };
  const [, name, role, n] = marker;
  const holdMs = role === 'A' ? (HOLD[name!] ?? 4_000) : 300;
  const label = role! + n!;
  const producer =
    "const fs=require('fs');" +
    `fs.appendFileSync('proof.txt','${label}-start '+Date.now()+'\\n');` +
    `setTimeout(()=>{fs.appendFileSync('proof.txt','${label}-end '+Date.now()+'\\n');` +
    `process.stdout.write('verify-13366-${label}\\n');},${holdMs});`;
  return {
    toolCalls: [
      fakeToolCall(
        'run_shell_command',
        {
          command: quote(process.execPath) + ' -e ' + quote(producer),
          timeout: 120_000,
        },
        'shell-' + randomUUID().slice(0, 8),
      ),
    ],
  };
});

async function call(
  session: SessionReport,
  route: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
) {
  if (proxyFailure) throw proxyFailure;
  const started = now();
  const response = await cli.request('/session/' + session.sessionId + route, {
    method,
    headers: {
      ...cli.headers(session.clientId || undefined),
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  return {
    status: response.status,
    ms: now() - started,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function prompt(
  session: SessionReport,
  n: number,
  extra: Record<string, unknown> = {},
) {
  const content = [
    {
      type: 'text',
      text: `VERIFY13366 case=${current.name} role=${session.role} n=${n}`,
    },
  ];
  const promptId = randomUUID();
  session.promptIds.push(promptId);
  const admitted = await call(session, '/prompt', 'POST', {
    promptId,
    prompt: content,
    payloadDigest:
      'sha256:' +
      createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    ...extra,
  });
  return { at: now(), status: admitted.status, body: admitted.body };
}

async function status(session: SessionReport) {
  const body = (await call(session, '/status', 'GET')).body as {
    hasActivePrompt: boolean;
    recoveryBlocked: boolean;
  };
  session.statusSamples.push({
    at: now(),
    active: body.hasActivePrompt,
    blocked: body.recoveryBlocked,
  });
  return body;
}

async function transcript(session: SessionReport) {
  const page = (await call(session, '/transcript?limit=256', 'GET')).body as {
    events: Array<Record<string, unknown>>;
  };
  return page.events.map((event) => {
    const data = (event['data'] ?? {}) as Record<string, unknown>;
    return {
      type: event['type'],
      ...(event['type'] === 'turn_error' ? { code: data['code'] } : {}),
      ...(event['type'] === 'turn_complete'
        ? { stopReason: data['stopReason'] }
        : {}),
      ...(typeof event['promptId'] === 'string'
        ? { promptId: (event['promptId'] as string).slice(0, 8) }
        : {}),
      ...(data['record'] && typeof data['record'] === 'object'
        ? {
            record: (data['record'] as Record<string, unknown>)['type'],
            subtype: (data['record'] as Record<string, unknown>)['subtype'],
          }
        : {}),
    };
  });
}

async function waitIdle(session: SessionReport, timeout: number) {
  const started = now();
  try {
    await waitUntil(async () => !(await status(session)).hasActivePrompt, timeout);
  } catch {
    return { idle: false, afterMs: now() - started };
  }
  return { idle: true, afterMs: now() - started };
}

const acquireOk = (session: SessionReport) =>
  session.broker.some((entry) => entry.op === 'acquire' && entry.status === 200);

async function proof() {
  return readFile(path.join(current.directory, 'proof.txt'), 'utf8').catch(
    () => '',
  );
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
    const report = current;
    cli.child!.stderr!.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n'))
        if (line.includes('qwen serve:'))
          report.stderr.push({ at: now(), line: line.trim() });
    });
    const caseEntry = config.cases.find((entry) => entry.name === report.name)!;
    const { A, B } = report.sessions;
    for (const session of [A, B]) {
      const response = await cli.request('/session', {
        method: 'POST',
        headers: { ...cli.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managedSessionStore: {
            baseUrl: proxyUrl,
            tenantId: config.tenantId,
            workspaceId: caseEntry.workspaceId,
            writerId: cli.bootId,
            leaseDurationMs: 5_000,
          },
          toolProfile: 'hosted-workspace-shell/1',
          sessionId: session.sessionId,
          sessionScope: 'thread',
        }),
      });
      const created = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200, JSON.stringify(created));
      session.clientId = created['clientId'] as string;
    }
    const result = report.result;
    result['promptA'] = await prompt(A, 1);
    await waitUntil(() => acquireOk(A), 60_000);
    result['aAcquiredAt'] = A.broker.find(
      (entry) => entry.op === 'acquire' && entry.status === 200,
    )!.at;

    if (report.name === 'pair' || report.name === 'long') {
      result['promptB'] = await prompt(B, 1);
      const [a, b] = await Promise.all([
        waitIdle(A, report.holdMs + 60_000),
        (async () => {
          const started = now();
          const out = await waitIdle(B, report.holdMs + 60_000);
          return { ...out, sinceBPromptMs: now() - started };
        })(),
      ]);
      result['aIdle'] = a;
      result['bIdle'] = b;
      result['statusAfter'] = { A: await status(A), B: await status(B) };
    } else {
      // stranded: A's release is dropped; wait until A is idle and blocked.
      result['aIdle'] = await waitIdle(A, 60_000);
      result['aStatus'] = await status(A);
      result['promptB1'] = await prompt(B, 1);
      const bStart = now();
      // Observe B for up to 30 s.
      while (now() - bStart < 30_000) {
        const sample = await status(B);
        if (!sample.hasActivePrompt) break;
        if (!B.midQueueTranscript && now() - bStart > 10_000)
          B.midQueueTranscript = await transcript(B);
        await sleep(1_000);
      }
      result['bActiveAfter30s'] = (await status(B)).hasActivePrompt;
      result['bAcquire409sIn30s'] = B.broker.filter(
        (entry) => entry.op === 'acquire' && entry.status === 409,
      ).length;
      if (result['bActiveAfter30s']) {
        const cancelled = await call(B, '/cancel', 'POST');
        result['bCancel'] = { status: cancelled.status, ms: cancelled.ms };
        result['bIdleAfterCancel'] = await waitIdle(B, 30_000);
      }
      result['bStatusAfterCancel'] = await status(B);
      result['bTranscriptAfterCancel'] = await transcript(B);
      // A client-supplied prompt deadline also ends the queued wait.
      result['promptB3deadline'] = await prompt(B, 3, { deadlineMs: 3_000 });
      const deadlineStarted = now();
      result['bIdleAfterDeadline'] = await waitIdle(B, 20_000);
      result['bDeadlineElapsedMs'] = now() - deadlineStarted;
      result['bStatusAfterDeadline'] = await status(B);
      result['bTranscriptAfterDeadline'] = await transcript(B);
      result['promptB2'] = await prompt(B, 2);
      await sleep(5_000);
      result['bActive5sIntoPrompt2'] = (await status(B)).hasActivePrompt;
      const deleted = await call(B, '', 'DELETE');
      result['bDelete'] = { status: deleted.status, ms: deleted.ms, body: deleted.body };
      if (deleted.status !== 204) {
        const detached = await call(B, '/detach', 'POST');
        result['bDetach'] = { status: detached.status, ms: detached.ms, body: detached.body };
        result['bTranscriptQueued2'] = await transcript(B);
      }
    }
    A.transcript = await transcript(A).catch((cause) => String(cause));
    if (report.name !== 'stranded') B.transcript = await transcript(B);
    result['proof'] = await proof();
    result['deleteA'] = (await call(A, '', 'DELETE')).status;
    if (report.name !== 'stranded') result['deleteB'] = (await call(B, '', 'DELETE')).status;
    const queuedAtClose =
      report.name === 'stranded' &&
      result['bDelete'] !== undefined &&
      (result['bDelete'] as { status: number }).status !== 204 &&
      (await status(B)).hasActivePrompt;
    const closeStarted = now();
    const child = cli.child!;
    await cli.close();
    result['close'] = {
      queuedTurnAtSigterm: queuedAtClose,
      ms: now() - closeStarted,
      exitCode: child.exitCode,
      signal: child.signalCode,
    };
    console.log('VERIFY13366 ' + report.name + ' ' + JSON.stringify(result));
  }
  if (proxyFailure) throw proxyFailure;
  await writeFile(configPath + '.results', JSON.stringify(reports, null, 2));
  console.log('HOSTED_VERIFY13366_OK');
} catch (cause) {
  console.error('VERIFY13366 ' + current.name, cause, cli.output);
  await writeFile(configPath + '.results', JSON.stringify(reports, null, 2));
  throw cause;
} finally {
  await cli.close();
  await model.close();
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
}
