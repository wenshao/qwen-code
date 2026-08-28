/**
 * Drives the real DingTalk channel presenter + status-card controller + card
 * client (loaded from the worktree under test) against the local fake Card
 * OpenAPI, on real timers, over real HTTP.
 *
 *   SRC_DIR=<worktree>/packages/channels/dingtalk/src \
 *   OUT_DIR=... VARIANT=head npx tsx harness.mts <scenario>
 */
import fs from 'node:fs';
import path from 'node:path';
import { FakeDingtalkServer } from './server.mts';

const SRC = process.env['SRC_DIR']!;
const OUT = process.env['OUT_DIR']!;
const VARIANT = process.env['VARIANT']!;
const SCENARIO = process.argv[2]!;

const { DingtalkInteractiveCardClient } = await import(
  `${SRC}/interactive-card-client.ts`
);
const { StatusCardController } = await import(`${SRC}/status-card-controller.ts`);
const { DingtalkInteractionPresenter } = await import(
  `${SRC}/interaction-presenter.ts`
);

const target = { chatId: 'cid-1', isGroup: true };

function segment(segmentId = 'segment-1') {
  return {
    channelName: 'dingtalk',
    sessionId: 'session-1',
    runId: 'run-1',
    segmentId,
    owner: { kind: 'channel_user', id: 'owner-1' },
    target: {
      channelName: 'dingtalk',
      chatId: 'cid-1',
      senderId: 'owner-1',
      isGroup: true,
    },
  } as never;
}

interface Check {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

async function boot() {
  const server = new FakeDingtalkServer();
  await server.start();
  const clientA = server.addClient('A');
  const clientB = server.addClient('B');
  const errors: Array<{ t: number; op: string; message: string }> = [];
  const fallbacks: Array<{ t: number; text: string }> = [];

  const cardClient = new DingtalkInteractiveCardClient({
    robotCode: 'robot-1',
    getAccessToken: async () => 'access-token',
    fetch: ((url: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(
        String(url).replace('https://api.dingtalk.com', server.baseUrl),
        init,
      )) as typeof fetch,
  });
  const controller = new StatusCardController({
    client: cardClient,
    cancelRun: async () => true,
    model: 'qwen3-max',
    onError: (op: string, error: unknown) =>
      errors.push({
        t: server.now(),
        op,
        message: String((error as Error)?.message ?? error).slice(0, 160),
      }),
  });
  const presenter = new DingtalkInteractionPresenter({
    statusCards: controller,
    sendFallback: async (_chatId: string, text: string) => {
      fallbacks.push({ t: server.now(), text });
    },
  });
  presenter.registerRun('run-1', 'owner-1', target, 'session-1');
  return { server, clientA, clientB, controller, presenter, errors, fallbacks };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Env = Awaited<ReturnType<typeof boot>>;

async function until(server: Env['server'], ms: number): Promise<void> {
  const remaining = ms - server.now();
  if (remaining > 0) await sleep(remaining);
}

/** Accumulates model output and hands it to the presenter, chunk by chunk. */
function makeStream(env: Env, chunkChars = 0) {
  let produced = '';
  const emitted: Array<{ t: number; len: number }> = [];
  let n = 0;
  const push = () => {
    n += 1;
    let chunk = `line ${String(n).padStart(2, '0')}: scanning packages/channels/dingtalk step ${n}\n`;
    if (chunkChars > 0) {
      chunk = `${chunk}${'x'.repeat(Math.max(0, chunkChars - chunk.length - 1))}\n`;
    }
    produced += chunk;
    env.presenter.appendOutput(segment(), chunk);
    emitted.push({ t: env.server.now(), len: produced.length });
  };
  return {
    push,
    get produced() {
      return produced;
    },
    emitted,
  };
}

function contentRegressions(history: { content: string; t: number }[]) {
  const bad: Array<{ t: number; from: number; to: number }> = [];
  let prev = '';
  for (const entry of history) {
    if (prev && !entry.content.startsWith(prev)) {
      bad.push({ t: entry.t, from: prev.length, to: entry.content.length });
    }
    prev = entry.content;
  }
  return bad;
}

function summary(env: Env) {
  const byPath = new Map<string, number>();
  let bytes = 0;
  for (const r of env.server.requests) {
    byPath.set(`${r.method} ${r.path}`, (byPath.get(`${r.method} ${r.path}`) ?? 0) + 1);
    bytes += r.bytes;
  }
  return {
    requestCount: env.server.requests.length,
    requestsByPath: Object.fromEntries(byPath),
    totalRequestBytes: bytes,
    errors: env.errors,
    fallbacks: env.fallbacks,
    clientA: {
      content: env.clientA.card['content'] ?? '',
      statusLine: env.clientA.card['statusLine'] ?? '',
      flowStatus: env.clientA.card['flowStatus'] ?? '',
      stopAction: env.clientA.card['stop_action'] ?? '',
      delivered: env.clientA.delivered,
      historyLen: env.clientA.history.length,
      regressions: contentRegressions(env.clientA.history),
    },
    clientB: {
      content: env.clientB.card['content'] ?? '',
      statusLine: env.clientB.card['statusLine'] ?? '',
      flowStatus: env.clientB.card['flowStatus'] ?? '',
      stopAction: env.clientB.card['stop_action'] ?? '',
      delivered: env.clientB.delivered,
      historyLen: env.clientB.history.length,
      regressions: contentRegressions(env.clientB.history),
    },
  };
}

function write(result: Record<string, unknown>) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, `${VARIANT}-${SCENARIO}.json`),
    JSON.stringify(result, null, 2),
  );
  const checks = (result['checks'] ?? []) as Check[];
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} [${VARIANT}/${SCENARIO}] ${c.name}: ${c.actual}`);
  }
}

// --------------------------------------------------------------------------
// Scenarios
// --------------------------------------------------------------------------

async function scenarioReconnect() {
  const env = await boot();
  const stream = makeStream(env);
  const samples: Array<{ t: number; a: number; b: number; produced: number }> = [];
  const sampler = setInterval(() => {
    samples.push({
      t: env.server.now(),
      a: (env.clientA.card['content'] ?? '').length,
      b: (env.clientB.card['content'] ?? '').length,
      produced: stream.produced.length,
    });
  }, 250);

  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 400);
  stream.push();

  await until(env.server, 2_000);
  env.clientA.setOnline(false); // DingTalk client A loses connectivity
  const contentAtDisconnect = (env.clientA.card['content'] ?? '').length;
  await until(env.server, 5_300);
  env.clientA.setOnline(true); // ... and comes back mid-interval
  const reconnectAt = env.server.now();

  await until(env.server, 11_800);
  clearInterval(chunkTimer);
  const runningSample = {
    t: env.server.now(),
    a: env.clientA.card['content'] ?? '',
    b: env.clientB.card['content'] ?? '',
    produced: stream.produced,
  };
  const clientAAtSample = { ...env.clientA.card };
  const clientBAtSample = { ...env.clientB.card };
  const repairedAt = env.clientA.history.find(
    (h) => h.t > reconnectAt && h.content.length > contentAtDisconnect,
  )?.t;
  // How far behind the live card client A is, expressed in seconds of output.
  const staleChars = runningSample.b.length - runningSample.a.length;
  const staleSeconds = Number(
    (
      staleChars /
      Math.max(1, runningSample.produced.length / (runningSample.t / 1000))
    ).toFixed(1),
  );

  await until(env.server, 12_000);
  await env.presenter.closeOutput('segment-1', stream.produced, 'completed');
  await until(env.server, 14_000);
  clearInterval(sampler);

  const checks: Check[] = [
    {
      name: 'reconnected client A is repaired while the task is still running',
      expected: 'A content grows again after reconnect',
      actual:
        repairedAt === undefined
          ? `frozen at ${contentAtDisconnect} chars (content from the moment it went offline)`
          : `repaired at t=${repairedAt}ms, ${runningSample.a.length} chars`,
      pass: repairedAt !== undefined,
    },
    {
      name: 'time from reconnect to the first content repair',
      expected: '<= one 5s checkpoint interval',
      actual:
        repairedAt === undefined
          ? 'never repaired while running'
          : `${repairedAt - reconnectAt} ms`,
      pass: repairedAt !== undefined && repairedAt - reconnectAt <= 6_000,
    },
    {
      name: 'staleness of client A at t=11.8s',
      expected: 'at most one checkpoint interval behind',
      actual: `${staleChars} chars behind (~${staleSeconds}s of output)`,
      pass: staleSeconds <= 5.5,
    },
    {
      name: 'client A content stays a prefix of the live card (no divergence)',
      expected: 'A content is a prefix of B content',
      actual: runningSample.b.startsWith(runningSample.a)
        ? 'prefix'
        : 'diverged',
      pass: runningSample.b.startsWith(runningSample.a),
    },
    {
      name: 'continuously connected client B never regresses',
      expected: 'no content regression',
      actual: `${contentRegressions(env.clientB.history).length} regressions`,
      pass: contentRegressions(env.clientB.history).length === 0,
    },
    {
      name: 'both clients end on the complete terminal card',
      expected: 'flowStatus=3 and full content on A and B',
      actual: `A(flow=${env.clientA.card['flowStatus']}, ${(env.clientA.card['content'] ?? '').length} chars) B(flow=${env.clientB.card['flowStatus']}, ${(env.clientB.card['content'] ?? '').length} chars)`,
      pass:
        env.clientA.card['flowStatus'] === '3' &&
        env.clientB.card['flowStatus'] === '3' &&
        (env.clientA.card['content'] ?? '').length >= stream.produced.length,
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    reconnectAt,
    contentAtDisconnect,
    repairedAt,
    staleChars,
    staleSeconds,
    clientModel: process.env['CLIENT_MODEL'] ?? 'm2',
    clientAAtSample,
    clientBAtSample,
    runningSample: {
      t: runningSample.t,
      aLen: runningSample.a.length,
      bLen: runningSample.b.length,
      producedLen: runningSample.produced.length,
      aTail: runningSample.a.trim().split('\n').slice(-1)[0],
      bTail: runningSample.b.trim().split('\n').slice(-1)[0],
    },
    samples,
    checks,
    ...summary(env),
    clientAHistory: env.clientA.history.map((h) => ({
      t: h.t,
      via: h.via,
      len: h.content.length,
      statusLine: h.statusLine,
    })),
    finalCards: {
      A: env.clientA.card,
      B: env.clientB.card,
    },
  });
  await env.server.stop();
}

async function scenarioContentOutage() {
  const env = await boot();
  const stream = makeStream(env);
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 400);
  stream.push();

  await until(env.server, 2_000);
  env.server.setFault({ paths: 'all', mode: 'blackhole' }); // host network cut
  await until(env.server, 5_000);
  env.server.setFault(null); // network restored
  const restoredAt = env.server.now();
  const producedDuringOutage = stream.produced.length;

  await until(env.server, 9_500);
  clearInterval(chunkTimer);
  const producedAtBoundary = stream.produced;
  const recoveredAt = env.clientB.history.find(
    (h) => h.t > restoredAt && h.content.length >= producedDuringOutage,
  )?.t;
  const boundaryDelivered = await env.presenter.closeOutput(
    'segment-1',
    producedAtBoundary,
    'response_boundary',
  );
  await until(env.server, 11_000);

  const cardContent = env.clientB.card['content'] ?? '';
  const checks: Check[] = [
    {
      name: 'card returns to the latest snapshot after the outage',
      expected: 'card content === produced output',
      actual:
        cardContent.length >= producedAtBoundary.length
          ? `recovered (${cardContent.length} chars)`
          : `stuck at ${cardContent.length}/${producedAtBoundary.length} chars`,
      pass: cardContent.length >= producedAtBoundary.length,
    },
    {
      name: 'recovery latency after connectivity returns',
      expected: 'card carries the output written during the outage',
      actual:
        recoveredAt === undefined
          ? 'never recovered'
          : `${recoveredAt - restoredAt} ms`,
      pass: recoveredAt !== undefined,
    },
    {
      name: 'response boundary is delivered by the card, not by a text fallback',
      expected: 'no sendFallback',
      actual: `delivered=${boundaryDelivered}, fallbacks=${env.fallbacks.length}`,
      pass: boundaryDelivered && env.fallbacks.length === 0,
    },
    {
      name: 'status line keeps ticking after recovery',
      expected: 'statusLine advances past the outage',
      actual: env.clientB.card['statusLine'] ?? '(none)',
      pass: /\b(9|10|11)s\b/.test(env.clientB.card['statusLine'] ?? ''),
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    outage: { from: 2_000, to: 5_000 },
    restoredAt,
    recoveredAt,
    producedDuringOutage,
    producedLen: producedAtBoundary.length,
    boundaryDelivered,
    checks,
    ...summary(env),
    clientBHistory: env.clientB.history.map((h) => ({
      t: h.t,
      via: h.via,
      len: h.content.length,
      statusLine: h.statusLine,
    })),
    finalCards: { A: env.clientA.card, B: env.clientB.card },
  });
  await env.server.stop();
}

async function scenarioTerminalOutage() {
  const env = await boot();
  const stream = makeStream(env);
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 400);
  stream.push();

  await until(env.server, 2_000);
  clearInterval(chunkTimer);
  env.server.setFault({ paths: 'all', mode: 'blackhole' });
  await until(env.server, 2_400);
  const closed = env.presenter.closeOutput(
    'segment-1',
    stream.produced,
    'completed',
  );
  await until(env.server, 5_000);
  env.server.setFault(null);
  const restoredAt = env.server.now();
  const closeResult = await Promise.race([
    closed,
    until(env.server, 12_000).then(() => 'timeout' as const),
  ]);
  await until(env.server, 12_000);

  const card = env.clientB.card;
  const terminalAt = env.clientB.history.find((h) => h.flowStatus === '3')?.t;
  const checks: Check[] = [
    {
      name: 'card reaches a terminal state after the outage',
      expected: 'flowStatus=3',
      actual: `flowStatus=${card['flowStatus']}${terminalAt ? ` at ${terminalAt}ms` : ''}`,
      pass: card['flowStatus'] === '3',
    },
    {
      name: 'Stop action is withdrawn',
      expected: 'stop_action=false',
      actual: `stop_action=${card['stop_action']}`,
      pass: card['stop_action'] === 'false',
    },
    {
      name: 'terminal card shows the complete answer',
      expected: `${stream.produced.length} chars`,
      actual: `${(card['content'] ?? '').length} chars`,
      pass: (card['content'] ?? '').length >= stream.produced.length,
    },
    {
      name: 'terminal status line is not inflated by the outage',
      expected: 'Completed · ~2s (time of completion, not of recovery)',
      actual: card['statusLine'] ?? '(none)',
      pass: /Completed/.test(card['statusLine'] ?? ''),
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    outage: { from: 2_000, to: 5_000 },
    restoredAt,
    terminalAt,
    closeResult,
    producedLen: stream.produced.length,
    checks,
    ...summary(env),
    clientBHistory: env.clientB.history.map((h) => ({
      t: h.t,
      via: h.via,
      len: h.content.length,
      statusLine: h.statusLine,
      flowStatus: h.flowStatus,
    })),
    finalCards: { A: env.clientA.card, B: env.clientB.card },
  });
  await env.server.stop();
}

async function scenarioCreateOutage() {
  const env = await boot();
  const stream = makeStream(env);
  env.server.setFault({ paths: 'all', mode: 'blackhole' });
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 400);
  stream.push();

  await until(env.server, 2_500);
  env.server.setFault(null);
  await until(env.server, 2_600);
  const firstBoundaryText = stream.produced;
  const boundaryDelivered = await env.presenter.closeOutput(
    'segment-1',
    firstBoundaryText,
    'response_boundary',
  );
  await until(env.server, 6_000);
  clearInterval(chunkTimer);
  // Second turn of the same run continues into a fresh output segment.
  const secondSegment = segment('segment-2');
  env.presenter.appendOutput(secondSegment, 'final: done with the scan\n');
  await until(env.server, 6_400);
  await env.presenter.closeOutput(
    'segment-2',
    'final: done with the scan\n',
    'completed',
    secondSegment,
  );
  await until(env.server, 9_000);

  const card = env.clientB.card;
  const fallbackText = env.fallbacks.map((f) => f.text).join('');
  const fallbackHead = fallbackText.trim().split('\n')[0] ?? '';
  // Was text the user already received as a plain message ALSO rendered inside
  // the card at any point?
  const duplicateSnapshots = fallbackHead
    ? env.clientB.history.filter((h) => h.content.includes(fallbackHead))
    : [];
  const duplicated = env.fallbacks.length > 0 && duplicateSnapshots.length > 0;
  const checks: Check[] = [
    {
      name: 'a transiently rejected card creation is retried',
      expected: 'card delivered after the outage',
      actual: `delivered=${env.clientB.delivered}`,
      pass: env.clientB.delivered,
    },
    {
      name: 'the response boundary is not blocked by the creation backoff',
      expected: 'boundary resolves without waiting out the backoff',
      actual: `delivered=${boundaryDelivered}, fallbacks=${env.fallbacks.length}`,
      pass: boundaryDelivered,
    },
    {
      name: 'the user is not shown the same text twice',
      expected: 'fallback text is not repeated inside the card',
      actual: duplicated
        ? `duplicate: the ${fallbackText.length}-char fallback text is also rendered in the card from t=${duplicateSnapshots[0]!.t}ms (${duplicateSnapshots.length} snapshots)`
        : 'no duplicate',
      pass: !duplicated,
    },
    {
      name: 'card ends terminal',
      expected: 'flowStatus=3',
      actual: `flowStatus=${card['flowStatus'] ?? '(no card)'}`,
      pass: card['flowStatus'] === '3',
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    outage: { from: 0, to: 2_500 },
    boundaryDelivered,
    duplicateSnapshotCount: duplicateSnapshots.length,
    checks,
    ...summary(env),
    clientBHistory: env.clientB.history.map((h) => ({
      t: h.t,
      via: h.via,
      len: h.content.length,
      content: h.content,
      statusLine: h.statusLine,
      flowStatus: h.flowStatus,
    })),
    finalCards: { A: env.clientA.card, B: env.clientB.card },
  });
  await env.server.stop();
}

async function scenarioNonRetryable() {
  const env = await boot();
  const stream = makeStream(env);
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 400);
  stream.push();

  await until(env.server, 2_000);
  env.server.setFault({
    paths: ['/v1.0/card/streaming'],
    mode: 'status',
    status: 403,
  });
  const faultAt = env.server.now();
  await until(env.server, 8_000);
  clearInterval(chunkTimer);
  const streamRequestsAfterFault = env.server.requests.filter(
    (r) => r.t >= faultAt && r.path === '/v1.0/card/streaming',
  ).length;
  const boundaryDelivered = await env.presenter.closeOutput(
    'segment-1',
    stream.produced,
    'completed',
  );
  await until(env.server, 10_000);

  const checks: Check[] = [
    {
      name: 'a permanently rejected stream is not retried in a loop',
      expected: '<= 4 streaming requests in 6s after the rejection',
      actual: `${streamRequestsAfterFault} requests`,
      pass: streamRequestsAfterFault <= 4,
    },
    {
      name: 'the run still reaches a terminal card',
      expected: 'flowStatus=3',
      actual: `closed=${boundaryDelivered}, flowStatus=${env.clientB.card['flowStatus']}`,
      pass: env.clientB.card['flowStatus'] === '3',
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    faultAt,
    streamRequestsAfterFault,
    boundaryDelivered,
    checks,
    ...summary(env),
    finalCards: { A: env.clientA.card, B: env.clientB.card },
  });
  await env.server.stop();
}

async function scenarioDispose() {
  const env = await boot();
  const stream = makeStream(env);
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 400);
  stream.push();

  await until(env.server, 3_000);
  clearInterval(chunkTimer);
  // The channel goes away mid-run (disconnect / process teardown) without the
  // run ever reaching a terminal card.
  const hasDispose =
    typeof (env.controller as { dispose?: unknown }).dispose === 'function';
  if (hasDispose) (env.controller as { dispose(): void }).dispose();
  const disposedAt = env.server.now();
  await until(env.server, 15_000);

  const after = env.server.requests.filter((r) => r.t > disposedAt + 200);
  const checks: Check[] = [
    {
      name: 'no Card OpenAPI traffic after the channel disconnects',
      expected: '0 requests after disconnect',
      actual: `${after.length} requests in the ${(15_000 - disposedAt) / 1000}s after disconnect`,
      pass: after.length === 0,
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    hasDispose,
    disposedAt,
    requestsAfterDispose: after.length,
    checks,
    ...summary(env),
  });
  await env.server.stop();
}

async function scenarioCost() {
  const env = await boot();
  const stream = makeStream(env);
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 400);
  stream.push();
  await until(env.server, 15_000);
  clearInterval(chunkTimer);
  await env.presenter.closeOutput('segment-1', stream.produced, 'completed');
  await until(env.server, 16_500);

  const instanceRequests = env.server.requests.filter(
    (r) => r.path === '/v1.0/card/instances' && r.method === 'PUT',
  );
  const withContent = instanceRequests.filter((r) => (r.contentLen ?? 0) > 0);
  const checks: Check[] = [
    {
      name: 'card renders the whole answer on the happy path',
      expected: `${stream.produced.length} chars`,
      actual: `${(env.clientB.card['content'] ?? '').length} chars`,
      pass: (env.clientB.card['content'] ?? '').length >= stream.produced.length,
    },
    {
      name: 'no content regression on a continuously connected client',
      expected: '0 regressions',
      actual: `${contentRegressions(env.clientB.history).length}`,
      pass: contentRegressions(env.clientB.history).length === 0,
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    durationMs: 16_500,
    producedLen: stream.produced.length,
    instanceRequestCount: instanceRequests.length,
    instanceRequestsCarryingContent: withContent.length,
    contentCarryingTimes: withContent.map((r) => r.t),
    maxRequestBytes: Math.max(...env.server.requests.map((r) => r.bytes)),
    checks,
    ...summary(env),
    finalCards: { A: env.clientA.card, B: env.clientB.card },
  });
  await env.server.stop();
}

async function scenarioLatencyOrder() {
  const env = await boot();
  const stream = makeStream(env);
  env.server.setLatency('PUT /v1.0/card/instances', 700);
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 300);
  stream.push();
  await until(env.server, 14_000);
  clearInterval(chunkTimer);
  await env.presenter.closeOutput('segment-1', stream.produced, 'completed');
  await until(env.server, 16_000);

  const regressions = contentRegressions(env.clientB.history);
  const checks: Check[] = [
    {
      name: 'slow instance updates never rewind the card content',
      expected: '0 content regressions on a connected client',
      actual:
        regressions.length === 0
          ? 'none'
          : regressions
              .map((r) => `t=${r.t}ms ${r.from}->${r.to} chars`)
              .join('; '),
      pass: regressions.length === 0,
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    latency: { 'PUT /v1.0/card/instances': 700 },
    regressions,
    checks,
    ...summary(env),
    clientBHistory: env.clientB.history.map((h) => ({
      t: h.t,
      via: h.via,
      len: h.content.length,
    })),
    finalCards: { A: env.clientA.card, B: env.clientB.card },
  });
  await env.server.stop();
}

/** A realistic Card OpenAPI round trip for createAndDeliver, no faults at all. */
async function scenarioSlowCreate() {
  const env = await boot();
  const stream = makeStream(env);
  env.server.setLatency('POST /v1.0/card/instances/createAndDeliver', 700);
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 300);
  stream.push();
  await until(env.server, 8_000);
  clearInterval(chunkTimer);
  await env.presenter.closeOutput('segment-1', stream.produced, 'completed');
  await until(env.server, 10_000);

  const regressions = contentRegressions(env.clientB.history);
  const rewindMs = regressions.map((r) => {
    const next = env.clientB.history.find(
      (h) => h.t > r.t && h.content.length >= r.from,
    );
    return next ? next.t - r.t : -1;
  });
  const checks: Check[] = [
    {
      name: 'a slow card creation never rewinds the card content',
      expected: '0 content regressions on a healthy run',
      actual:
        regressions.length === 0
          ? 'none'
          : regressions
              .map(
                (r, i) =>
                  `t=${r.t}ms ${r.from}->${r.to} chars, restored after ${rewindMs[i]}ms`,
              )
              .join('; '),
      pass: regressions.length === 0,
    },
    {
      name: 'card shows the whole answer at the end',
      expected: `${stream.produced.length} chars`,
      actual: `${(env.clientB.card['content'] ?? '').length} chars`,
      pass: (env.clientB.card['content'] ?? '').length >= stream.produced.length,
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    latency: { 'POST /v1.0/card/instances/createAndDeliver': 700 },
    regressions,
    rewindMs,
    checks,
    ...summary(env),
    clientBHistory: env.clientB.history.map((h) => ({
      t: h.t,
      via: h.via,
      len: h.content.length,
    })),
    finalCards: { A: env.clientA.card, B: env.clientB.card },
  });
  await env.server.stop();
}

/** Same as `cost`, but with an answer long enough to hit the 20k content cap. */
async function scenarioCostLarge() {
  const env = await boot();
  const stream = makeStream(env, 1_200);
  env.presenter.startStatusCard('run-1');
  const chunkTimer = setInterval(() => stream.push(), 500);
  stream.push();
  await until(env.server, 25_000);
  clearInterval(chunkTimer);
  await env.presenter.closeOutput('segment-1', stream.produced, 'completed');
  await until(env.server, 26_500);

  const instanceRequests = env.server.requests.filter(
    (r) => r.path === '/v1.0/card/instances' && r.method === 'PUT',
  );
  const withContent = instanceRequests.filter((r) => (r.contentLen ?? 0) > 0);
  const regressions = contentRegressions(env.clientB.history);
  const unexplained = regressions.filter((r) => {
    const snapshot = env.clientB.history.find((h) => h.t === r.t);
    return !snapshot?.content.startsWith('[Earlier output truncated]');
  });
  const checks: Check[] = [
    {
      name: 'long answer still renders (bounded at the 20k cap)',
      expected: 'card content <= 20000 chars and non-empty',
      actual: `${(env.clientB.card['content'] ?? '').length} chars of ${stream.produced.length} produced`,
      pass:
        (env.clientB.card['content'] ?? '').length > 0 &&
        (env.clientB.card['content'] ?? '').length <= 20_100,
    },
    {
      name: 'no content regression beyond the documented 20k front truncation',
      expected: '0 unexplained regressions',
      actual: `${unexplained.length} unexplained (${regressions.length - unexplained.length} are the [Earlier output truncated] rewrite)`,
      pass: unexplained.length === 0,
    },
  ];

  write({
    scenario: SCENARIO,
    variant: VARIANT,
    producedLen: stream.produced.length,
    instanceRequestCount: instanceRequests.length,
    instanceRequestsCarryingContent: withContent.length,
    checkpointBytes: withContent.map((r) => r.bytes),
    maxRequestBytes: Math.max(...env.server.requests.map((r) => r.bytes)),
    checks,
    ...summary(env),
  });
  await env.server.stop();
}

const scenarios: Record<string, () => Promise<void>> = {
  reconnect: scenarioReconnect,
  'content-outage': scenarioContentOutage,
  'terminal-outage': scenarioTerminalOutage,
  'create-outage': scenarioCreateOutage,
  nonretryable: scenarioNonRetryable,
  dispose: scenarioDispose,
  cost: scenarioCost,
  'latency-order': scenarioLatencyOrder,
  'slow-create': scenarioSlowCreate,
  'cost-large': scenarioCostLarge,
};

const run = scenarios[SCENARIO];
if (!run) {
  console.error(`unknown scenario ${SCENARIO}`);
  process.exit(2);
}
await run();
process.exit(0);
