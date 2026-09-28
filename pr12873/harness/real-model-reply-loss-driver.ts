/**
 * Verification-only driver for PR #12873 (not part of the PR): the same
 * packaged Harness / Spring / Broker / worker / SQL stack, but the model is a
 * real one (qwen3.8-max) behind a local relay that injects the provider key.
 * The Broker proxy loses the FIRST reply of EVERY prepare (per idempotency
 * key) after the Broker applied it, so each real tool call must go through the
 * PR's prepare retry.
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';

const configPath = process.argv[2];
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  tenantId: string;
  storeUrl: string;
  brokerUrl: string;
  sessions: Array<{ sessionId: string; workspaceId: string; directory: string; fault: string }>;
};
const REAL_MODEL = process.env['REAL_MODEL'] ?? 'qwen3.8-max';
const settings = JSON.parse(await readFile(path.join(homedir(), '.qwen', 'settings.json'), 'utf8'));
const provider = settings.modelProviders.openai.find((p: { id: string }) => p.id === REAL_MODEL);
const apiKey = settings.env[provider.envKey] as string;
assert(apiKey, 'provider key');

type Exchange = { operation: string; key?: string; requestId?: unknown; executionCallId?: string; state?: string; lost?: boolean; at: number };
const cli = new HostedHarnessProcess();
let sessionId = '';
let clientId = '';
let promptId = '';
let exchanges: Exchange[] = [];
let proxyFailure: unknown;
const modelCalls: Array<{ at: number; ms: number; toolCalls: string[]; text: string }> = [];
const t0 = Date.now();
const lostKeys = new Set<string>();

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

// Real-model relay: the Harness talks to it as if it were the fixture model.
const relay = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  body.model = REAL_MODEL;
  const started = Date.now();
  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
  let text = '';
  const reader = upstream.body!.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += Buffer.from(chunk.value).toString();
    res.write(chunk.value);
  }
  res.end();
  const toolCalls = [...text.matchAll(/"name"\s*:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const content = [...text.matchAll(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
  modelCalls.push({ at: started - t0, ms: Date.now() - started, toolCalls: [...new Set(toolCalls)], text: content.slice(0, 200) });
});
await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
const relayAddress = relay.address();
assert(relayAddress && typeof relayAddress !== 'string');

const proxy = createServer(async (req, res) => {
  try {
    const route = new URL(req.url!, config.brokerUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const fields = body.length ? (JSON.parse(body.toString()) as Record<string, unknown>) : Object.fromEntries(route.searchParams);
    const operation = req.method === 'GET' ? 'status' : route.pathname.split(':').at(-1)!;
    assert.equal(fields['harnessSessionId'], sessionId);
    assert.equal(fields['runtimeSessionId'], promptId);
    const upstream = await fetch(new URL(req.url!, config.brokerUrl), {
      method: body.length ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer hosted-tools-broker-token', 'Content-Type': 'application/json' },
      ...(body.length ? { body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await upstream.text();
    assert.equal(upstream.status, 200, `${req.url}: ${text}`);
    const reply = JSON.parse(text);
    const key = fields['idempotencyKey'] as string | undefined;
    const lose = operation === 'prepare' && key !== undefined && !lostKeys.has(key);
    exchanges.push({
      operation,
      key,
      requestId: fields['requestId'],
      executionCallId: reply.executionCallId,
      state: reply.status?.state,
      lost: lose || undefined,
      at: Date.now() - t0,
    });
    if (lose) {
      lostKeys.add(key!);
      res.destroy();
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

const reports: Array<Record<string, unknown>> = [];
try {
  await cli.start(`http://127.0.0.1:${relayAddress.port}/v1`, {
    extraArgs: ['--managed-runtime-broker-url', `http://127.0.0.1:${address.port}`, '--managed-runtime-broker-token', 'hosted-tools-broker-token'],
  });
  await writeFile(path.join(cli.root, 'proof.txt'), 'decoy');
  for (const session of config.sessions) {
    sessionId = session.sessionId;
    exchanges = [];
    const connection = { baseUrl: config.storeUrl, tenantId: config.tenantId, workspaceId: session.workspaceId, writerId: cli.bootId, leaseDurationMs: 60_000 };
    const created = await json('/session', { sessionId, sessionScope: 'thread', managedSessionStore: connection, toolProfile: 'hosted-workspace-files/1' });
    clientId = created.clientId;
    const prompt = [{ type: 'text', text: 'The file proof.txt in your working directory contains exactly one character: x. Make exactly one tool call: use the edit tool on proof.txt with old_string "x", new_string "xx" and replace_all true. Do not read the file and do not call any other tool. After the edit succeeds, reply with one short sentence saying what proof.txt now contains.' }];
    promptId = randomUUID();
    await json(`/session/${sessionId}/prompt`, { promptId, prompt, payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(prompt)).digest('hex')}` }, 202);
    await waitUntil(async () => {
      if (proxyFailure) throw proxyFailure;
      return !(await json(`/session/${sessionId}/status`)).hasActivePrompt;
    }, 170_000);
    const status = await json(`/session/${sessionId}/status`);
    const events: Array<{ type: string; promptId?: string; data: { record?: { type?: string } } }> = [];
    let cursor = '0';
    while (true) {
      const page = await json(`/session/${sessionId}/transcript?cursor=${cursor}&limit=256`);
      events.push(...page.events);
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    const terminal = events.filter((e) => e.promptId === promptId && e.type.startsWith('turn_')).map((e) => e.type);
    const toolResults = events.filter((e) => e.data.record?.type === 'tool_result').length;
    const prepares = exchanges.filter((e) => e.operation === 'prepare');
    const byKey = new Map<string, Exchange[]>();
    for (const e of prepares) byKey.set(e.key!, [...(byKey.get(e.key!) ?? []), e]);
    const file = await readFile(path.join(session.directory, 'proof.txt'), 'utf8');
    const summary = {
      model: REAL_MODEL,
      recoveryBlocked: status.recoveryBlocked,
      terminal,
      toolResults,
      modelCalls,
      reservations: [...byKey.values()].map((list) => ({ requests: list.length, lostReplies: list.filter((e) => e.lost).length, executionIds: [...new Set(list.map((e) => e.executionCallId))].length })),
      starts: exchanges.filter((e) => e.operation === 'start').length,
      releases: exchanges.filter((e) => e.operation === 'release').length,
      file,
      decoy: await readFile(path.join(cli.root, 'proof.txt'), 'utf8'),
      exchanges,
    };
    console.log(`REAL_SUMMARY ${JSON.stringify(summary)}`);
    assert.equal(status.recoveryBlocked, false);
    assert.deepEqual(terminal, ['turn_complete']);
    assert.equal(file, 'xx');
    assert.equal(summary.decoy, 'decoy');
    assert(byKey.size >= 1);
    for (const r of summary.reservations) assert.deepEqual(r, { requests: 2, lostReplies: 1, executionIds: 1 });
    assert.equal(summary.starts, byKey.size);
    reports.push({ fault: session.fault, promptId, executionCallId: prepares[0]?.executionCallId, idempotencyKey: prepares[0]?.key });
    await json(`/session/${sessionId}/detach`, {}, 204);
    console.log(`REAL ${session.fault}: OK tools=${byKey.size} file=${file}`);
  }
  await writeFile(`${configPath}.results`, JSON.stringify(reports));
  console.log('HOSTED_REPLY_LOSS_OK');
} catch (cause) {
  console.error('REAL_FAIL', JSON.stringify(exchanges), JSON.stringify(modelCalls), cli.output.slice(-5000));
  throw cause;
} finally {
  await cli.close();
  proxy.closeAllConnections();
  relay.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await new Promise<void>((resolve) => relay.close(() => resolve()));
}
