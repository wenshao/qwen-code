// Shared helpers for the PR 12946 rig scenarios. Copied into
// integration-tests/helpers/ of the tree under test so relative imports work.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
} from '../fake-openai-server.js';
import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';

export { assert, randomUUID, delay, fakeToolCall, waitUntil };
export const RUN = process.env['RIG_RUN']!;
export const rig = JSON.parse(readFileSync(`${RUN}/root/rig.json`, 'utf8')) as {
  tenantId: string;
  storeUrl: string;
  brokerUrl: string;
  adminUrl: string;
  root: string;
};
export const manifest = JSON.parse(
  readFileSync(`${RUN}/manifest.json`, 'utf8'),
) as {
  servers: Array<{
    workspaceId: string;
    serverId: string;
    serverRevision: number;
    definitionDigest: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    url?: string;
    command?: string;
  }>;
};
export function pin(workspace: number, serverId: string, revision = 1) {
  const s = manifest.servers.find(
    (x) =>
      x.workspaceId === `workspace-${workspace}` &&
      x.serverId === serverId &&
      x.serverRevision === revision,
  )!;
  return {
    serverId: s.serverId,
    serverRevision: s.serverRevision,
    definitionDigest: s.definitionDigest,
  };
}
export const t0 = Date.now();
export function say(...parts: unknown[]) {
  console.log(
    `[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`,
    ...parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))),
  );
}
export function ledger(): Array<Record<string, unknown>> {
  const file = `${RUN}/ledger.jsonl`;
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
export function effects(filter: (e: Record<string, unknown>) => boolean = () => true) {
  return ledger().filter(
    (e) =>
      ['tools/call', 'resources/read', 'prompts/get'].includes(String(e['method'])) &&
      filter(e),
  );
}
export async function admin(route: string, body: unknown) {
  const r = await fetch(rig.adminUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`admin ${route}: ${JSON.stringify(json)}`);
  return json as Record<string, any>;
}
export async function sql(query: string, args: unknown[] = []) {
  return (await admin('/sql/query', { sql: query, args })).rows as Array<Record<string, string | null>>;
}
export async function sqlUpdate(query: string, args: unknown[] = []) {
  return (await admin('/sql/update', { sql: query, args })).count as number;
}
export async function publicCatalog(sessionId: string) {
  const r = await fetch(`${rig.storeUrl}/v1/agents/sessions/${sessionId}/mcp-catalog`, {
    headers: { 'X-Qwen-Tenant-Id': rig.tenantId, 'X-Rig-Actor': 'actor' },
  });
  return { status: r.status, text: await r.text() };
}

// ---- Broker proxy with a request ledger and injectable faults -------------
export interface BrokerCall {
  t: number;
  method: string;
  url: string;
  status: number;
  kind?: string;
  fault?: string;
}
export type Fault = {
  match: (url: string, body: string) => boolean;
  action: 'drop-response' | '503' | 'hold';
  remaining: number;
  release?: Promise<void>;
  label: string;
};
export const brokerCalls: BrokerCall[] = [];
export const faults: Fault[] = [];
export let brokerDown = false;
export function setBrokerDown(value: boolean) {
  brokerDown = value;
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}
export async function startBrokerProxy() {
  const proxy = createServer(async (req, res) => {
    const raw = await body(req);
    const text = raw.toString('utf8');
    let kind: string | undefined;
    try {
      kind = JSON.parse(text)?.operation?.kind ?? JSON.parse(text)?.kind;
    } catch {}
    const call: BrokerCall = { t: Date.now(), method: req.method!, url: req.url!, status: 0, kind };
    brokerCalls.push(call);
    if (brokerDown) {
      call.status = 503;
      call.fault = 'down';
      res.writeHead(503).end('{"code":"rig_down"}');
      return;
    }
    const fault = faults.find((f) => f.remaining > 0 && f.match(req.url!, text));
    if (fault) {
      fault.remaining--;
      call.fault = fault.label;
      if (fault.action === '503') {
        call.status = 503;
        res.writeHead(503).end('{"code":"rig_fault"}');
        return;
      }
      if (fault.action === 'hold') await fault.release;
    }
    try {
      const response = await fetch(new URL(req.url!, rig.brokerUrl), {
        method: req.method,
        headers: {
          Authorization: 'Bearer hosted-tools-broker-token',
          'Content-Type': 'application/json',
        },
        ...(raw.length ? { body: raw } : {}),
        signal: AbortSignal.timeout(60_000),
      });
      const out = await response.text();
      call.status = response.status;
      if (fault?.action === 'drop-response') {
        res.destroy();
        return;
      }
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(out);
    } catch (cause) {
      call.status = 599;
      res.writeHead(503).end(String(cause));
    }
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    },
  };
}

// ---- Fake model -----------------------------------------------------------
export type ModelCtx = {
  body: Record<string, unknown>;
  tools: Array<{ name: string; description: string; parameters: unknown }>;
  receipts: Array<{ role: string; content: unknown; tool_call_id?: string }>;
  marker: string;
};
export let script: (ctx: ModelCtx) => FakeOpenAIResponse | Promise<FakeOpenAIResponse> = () => ({ content: 'DONE' });
export function setScript(fn: (ctx: ModelCtx) => FakeOpenAIResponse | Promise<FakeOpenAIResponse>) {
  script = fn;
}
export const modelRequests: Array<{ t: number; marker: string; tools: string[]; receipts: number }> = [];
let currentMarker = '';
export function toolFor(ctx: ModelCtx, needle: string) {
  const tool = ctx.tools.find((t) => t.description?.includes(needle));
  assert(tool, `no tool with description containing ${needle}: ${JSON.stringify(ctx.tools.map((t) => [t.name, t.description?.slice(0, 50)]))}`);
  return tool.name;
}
export async function startModel() {
  return startFakeOpenAIServer(({ body }) => {
    const tools = ((body['tools'] as Array<{ function: any }>) ?? []).map((t) => t.function);
    const messages = body['messages'] as Array<{ role: string; content: unknown; tool_call_id?: string }>;
    const last = messages.findLastIndex(
      (m) => m.role === 'user' && JSON.stringify(m.content).includes(currentMarker),
    );
    const receipts = messages.slice(last + 1).filter((m) => m.role === 'tool');
    modelRequests.push({ t: Date.now(), marker: currentMarker, tools: tools.map((t) => t.name), receipts: receipts.length });
    return script({ body, tools, receipts, marker: currentMarker });
  });
}

// ---- Harness --------------------------------------------------------------
export class Harness {
  cli = new HostedHarnessProcess();
  clientIds = new Map<string, string>();
  async start(modelUrl: string, brokerUrl: string) {
    await this.cli.start(modelUrl, {
      extraArgs: [
        '--managed-runtime-broker-url',
        brokerUrl,
        '--managed-runtime-broker-token',
        'hosted-tools-broker-token',
      ],
    });
    return this;
  }
  async call(sessionId: string, route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', timeout = 150_000) {
    const r = await this.cli.request(route, {
      method,
      headers: { ...this.cli.headers(this.clientIds.get(sessionId)), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await r.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: r.status, json };
  }
  connection(sessionId: string, workspaceId: string) {
    return {
      baseUrl: rig.storeUrl,
      tenantId: rig.tenantId,
      workspaceId,
      writerId: this.cli.bootId,
      leaseDurationMs: 60_000,
    };
  }
  async open(
    sessionId: string,
    workspaceId: string,
    profile: Record<string, unknown>,
    route: '/session' | 'load' = '/session',
  ) {
    const r =
      route === '/session'
        ? await this.call(sessionId, '/session', {
            sessionId,
            sessionScope: 'thread',
            managedSessionStore: this.connection(sessionId, workspaceId),
            ...profile,
          })
        : await this.call(sessionId, `/session/${sessionId}/load`, {
            managedSessionStore: this.connection(sessionId, workspaceId),
            ...profile,
          });
    if (r.status === 200) this.clientIds.set(sessionId, r.json.clientId);
    return r;
  }
  async prompt(sessionId: string, marker: string, opts: { wait?: boolean; timeout?: number } = {}) {
    currentMarker = marker;
    const blocks = [{ type: 'text', text: marker }];
    const promptId = randomUUID();
    const r = await this.call(sessionId, `/session/${sessionId}/prompt`, {
      promptId,
      prompt: blocks,
      payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(blocks)).digest('hex')}`,
    });
    if (r.status !== 202 || opts.wait === false) return { promptId, admit: r, terminal: undefined as any, status: undefined as any };
    await waitUntil(async () => !(await this.call(sessionId, `/session/${sessionId}/status`)).json.hasActivePrompt, opts.timeout ?? 150_000);
    return { promptId, admit: r, ...(await this.outcome(sessionId, promptId)) };
  }
  async outcome(sessionId: string, promptId: string) {
    const status = (await this.call(sessionId, `/session/${sessionId}/status`)).json;
    const events = await this.transcript(sessionId);
    const terminal = events.filter((e) => e.promptId === promptId && String(e.type).startsWith('turn_'));
    return { status, terminal: terminal.map((e) => ({ type: e.type, stopReason: e.data?.stopReason, error: e.data?.error ?? e.data?.message })), events };
  }
  async transcript(sessionId: string) {
    const events: any[] = [];
    let cursor = '0';
    while (true) {
      const page = (await this.call(sessionId, `/session/${sessionId}/transcript?cursor=${cursor}&limit=256`)).json;
      events.push(...page.events);
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    return events;
  }
  toolResults(events: any[], promptId: string) {
    return events
      .filter((e) => e.promptId === promptId)
      .flatMap((e) => e.data?.record?.message?.parts ?? [])
      .filter((p: any) => p.functionResponse)
      .map((p: any) => p.functionResponse);
  }
  async close() {
    await this.cli.close();
  }
}
export async function newSession(workspace: number) {
  return (await admin('/session', { workspace })) as { sessionId: string; workspaceId: string; directory: string };
}
export function mcpProfile(workspace: number, servers: Array<[string, number?]>) {
  return {
    toolProfile: 'hosted-workspace-mcp/1',
    mcpServers: servers.map(([id, rev]) => pin(workspace, id, rev ?? 1)),
  };
}
export function result(name: string, value: unknown) {
  console.log(`RESULT ${name} ${JSON.stringify(value)}`);
}

// Owner IDs are opaque digests since 9b4886 merge (d472033c): check the
// Workspace storage lease directly. storage_key = sha256(tenant \0 storage-W).
export async function leaseHeld(workspace: number): Promise<number> {
  const key = createHash('sha256').update(`${rig.tenantId}\u0000storage-${workspace}`).digest('hex');
  const rows = await sql('SELECT holder_key FROM managed_workspace_execution_lease WHERE storage_key = ?', [key]);
  return rows.filter((r) => r['holder_key'] !== null).length;
}
