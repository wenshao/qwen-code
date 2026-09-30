// Shared helpers for the PR 12946 rig scenarios. Copied into
// integration-tests/helpers/ of the tree under test so relative imports work.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
} from '../fake-openai-server.js';
import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOSTED_HOME_PREFIX } from '../scratch-dir.js';
import { LISTENING_LINE_RE } from './daemon-process.js';

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
  response?: string;
  opId?: string;
  rsid?: string;
  state?: string;
  code?: string;
}
export type Fault = {
  match: (url: string, body: string) => boolean;
  action: 'drop-response' | '503' | 'hold' | 'reply' | 'reset';
  reply?: { status: number; body: unknown };
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
    let opId: string | undefined;
    let rsid: string | undefined;
    try {
      const parsed = JSON.parse(text);
      kind = parsed?.operation?.kind ?? parsed?.kind;
      opId = parsed?.operation?.operationId ?? parsed?.operationId;
      rsid = parsed?.runtimeSessionId;
    } catch {}
    const call: BrokerCall = { t: Date.now(), method: req.method!, url: req.url!, status: 0, kind, opId, rsid };
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
      if (fault.action === 'reply') {
        call.status = fault.reply!.status;
        call.code = String((fault.reply!.body as any)?.code ?? '');
        res.writeHead(fault.reply!.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(fault.reply!.body));
        return;
      }
      if (fault.action === 'reset') {
        call.status = 0;
        res.destroy();
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
      call.response = out.slice(0, 4000);
      try {
        const parsed = JSON.parse(out);
        call.state = parsed?.result?.state ?? parsed?.state;
        const err = parsed?.result?.error;
        call.code = parsed?.code ?? (err === undefined ? undefined : typeof err === 'string' ? err : (err?.code ?? JSON.stringify(err)));
      } catch {}
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
  storeUrl = rig.storeUrl;
  // cliPath: run another tree's packaged CLI as the Harness (old-writer arm).
  async start(modelUrl: string, brokerUrl: string, opts: { cliPath?: string; storeUrl?: string } = {}) {
    if (opts.storeUrl) this.storeUrl = opts.storeUrl;
    const extraArgs = [
      '--managed-runtime-broker-url',
      brokerUrl,
      '--managed-runtime-broker-token',
      'hosted-tools-broker-token',
    ];
    // RIG_HARNESS_CLI: run every Harness of this scenario from another build (mutant arm).
    if (!opts.cliPath && process.env['RIG_HARNESS_CLI']) opts = { ...opts, cliPath: process.env['RIG_HARNESS_CLI'] };
    if (!opts.cliPath) {
      await this.cli.start(modelUrl, { extraArgs });
      return this;
    }
    // Same launch as HostedHarnessProcess.start, with a different CLI entry.
    const cli = this.cli;
    cli.root = await mkdtemp(path.join(tmpdir(), HOSTED_HOME_PREFIX));
    const config = path.join(cli.root, '.qwen');
    await mkdir(config);
    await writeFile(path.join(config, 'settings.json'), JSON.stringify({
      security: { auth: { selectedType: 'openai' } },
      model: { name: 'hosted-fixture' },
      telemetry: { enabled: false },
      modelProviders: { openai: [{ id: 'hosted-fixture', envKey: 'OPENAI_API_KEY', baseUrl: modelUrl }] },
    }));
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env))
      if (/^(PATH|TMP|TEMP|TMPDIR)$/i.test(key)) env[key] = value;
    cli.child = spawn(process.execPath, [
      opts.cliPath, 'serve', '--profile', 'hosted-harness', '--http-bridge', '--no-web',
      '--hostname', '127.0.0.1', '--port', '0', '--token', 'hosted-process-fixture-token',
      '--hosted-harness-capability-digest', `sha256:${'a'.repeat(64)}`, '--workspace', cli.root, ...extraArgs,
    ], {
      cwd: cli.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...env, HOME: cli.root, USERPROFILE: cli.root, QWEN_HOME: config,
        QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(cli.root, 'system-settings.json'),
        QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(cli.root, 'system-defaults.json'),
        QWEN_RUNTIME_DIR: path.join(cli.root, 'runtime'),
        OPENAI_API_KEY: 'local-fixture-key', OPENAI_BASE_URL: modelUrl, OPENAI_MODEL: 'hosted-fixture',
        QWEN_MODEL: 'hosted-fixture', QWEN_SANDBOX: 'false', NO_COLOR: '1',
      },
    });
    const append = (data: Buffer) => { cli.output = (cli.output + data.toString()).slice(-16_384); };
    cli.child.stdout!.on('data', append);
    cli.child.stderr!.on('data', append);
    await waitUntil(() => {
      if (cli.child!.exitCode !== null || cli.child!.signalCode !== null) throw new Error(`Hosted CLI exited: ${cli.output}`);
      const port = cli.output.match(LISTENING_LINE_RE)?.groups?.['port'];
      if (port) cli.baseUrl = `http://127.0.0.1:${port}`;
      return !!port;
    }, 60_000);
    await waitUntil(async () => {
      const capabilities = await cli.request('/capabilities');
      const text = await capabilities.text();
      if (capabilities.status === 503) return false;
      if (!capabilities.ok) throw new Error(`Capabilities returned ${capabilities.status}: ${text}`);
      cli.bootId = JSON.parse(text).hostedHarness.bootId;
      return true;
    }, 60_000);
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
      baseUrl: this.storeUrl,
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
  // Raw ledgers next to the log, for evidence.
  try {
    mkdirSync(`${RUN}/ledgers`, { recursive: true });
    writeFileSync(`${RUN}/ledgers/${process.env['RIG_NAME'] ?? name}-${process.pid}.json`, JSON.stringify({ broker: brokerCalls.map((c) => ({ ...c, response: c.response?.slice(0, 600) })), store: storeCalls }, null, 1));
  } catch {}
}

// Owner IDs are opaque digests since 9b4886 merge (d472033c): check the
// Workspace storage lease directly. storage_key = sha256(tenant \0 storage-W).
export async function leaseHeld(workspace: number): Promise<number> {
  const key = createHash('sha256').update(`${rig.tenantId}\u0000storage-${workspace}`).digest('hex');
  const rows = await sql('SELECT holder_key FROM managed_workspace_execution_lease WHERE storage_key = ?', [key]);
  return rows.filter((r) => r['holder_key'] !== null).length;
}

// ---- Session store proxy: ledger of committed MCP release states + faults ---
export interface StoreCall {
  t: number;
  method: string;
  url: string;
  status: number;
  fault?: string;
  releases?: string[]; // "serverId:releaseState" per MCP configuration record in the commit
  error?: string;
}
export type StoreFault = {
  label: string;
  remaining: number;
  action: '503' | 'drop-response' | 'reset';
  match: (url: string, decoded: string) => boolean;
};
export const storeCalls: StoreCall[] = [];
export const storeFaults: StoreFault[] = [];
function decodeCommit(text: string): string {
  try {
    const parsed = JSON.parse(text);
    // Stage H record bodies travel as resources[].bytesBase64, one JSON per line here.
    if (Array.isArray(parsed?.resources))
      return parsed.resources
        .filter((r: any) => typeof r?.bytesBase64 === 'string')
        .map((r: any) => Buffer.from(r.bytesBase64, 'base64').toString('utf8').replace(/\n/g, ' '))
        .join('\n');
  } catch {}
  return text;
}
export async function startStoreProxy() {
  const proxy = createServer(async (req, res) => {
    const raw = await body(req);
    const decoded = decodeCommit(raw.toString('utf8'));
    const call: StoreCall = { t: Date.now(), method: req.method!, url: req.url!.replace(/^.*\/sessions\/[^/]+/, ''), status: 0 };
    if (req.url!.includes('/transactions:commit')) {
      const found = [...decoded.matchAll(/"serverId":"([^"]+)"[^\n]*?"releaseState":"([a-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
      const alt = [...decoded.matchAll(/"releaseState":"([a-z]+)"[^\n]*?"serverId":"([^"]+)"/g)].map((m) => `${m[2]}:${m[1]}`);
      if (found.length || alt.length) call.releases = found.length ? found : alt;
      if (process.env['RIG_DUMP_COMMITS'] && decoded.includes('releaseState')) console.log('COMMIT', decoded.slice(0, 1500));
    }
    const fault = storeFaults.find((f) => f.remaining > 0 && f.match(req.url!, decoded));
    if (fault) {
      fault.remaining--;
      call.fault = fault.label;
      if (fault.action === '503') {
        call.status = 503;
        storeCalls.push(call);
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"code":"rig_store_fault","message":"rig"}');
        return;
      }
      if (fault.action === 'reset') {
        storeCalls.push(call);
        res.destroy();
        return;
      }
    }
    try {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers))
        if (!['host', 'connection', 'content-length', 'transfer-encoding'].includes(k) && typeof v === 'string') headers[k] = v;
      const response = await fetch(new URL(req.url!, process.env['RIG_STORE_URL'] ?? rig.storeUrl), {
        method: req.method,
        headers,
        ...(raw.length ? { body: raw } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      });
      const out = Buffer.from(await response.arrayBuffer());
      call.status = response.status;
      if (response.status >= 400) call.error = out.toString('utf8').slice(0, 400);
      storeCalls.push(call);
      if (fault?.action === 'drop-response') {
        res.destroy();
        return;
      }
      const back: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        if (!['connection', 'content-length', 'transfer-encoding', 'content-encoding', 'keep-alive'].includes(k)) back[k] = v;
      });
      res.writeHead(response.status, back);
      res.end(out);
    } catch (cause) {
      call.status = 599;
      call.error = String(cause);
      storeCalls.push(call);
      res.destroy();
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
// Commits that carried an MCP release state since index `from`.
export function releaseCommits(from = 0) {
  return storeCalls.slice(from).filter((c) => c.releases).map((c) => `${c.releases!.join(',')}→${c.status}${c.fault ? '!' + c.fault : ''}`);
}
// Compact Broker ledger since index `from`.
export function brokerKinds(from = 0) {
  return brokerCalls.slice(from).map((c) => {
    const tail = c.url.split('?')[0]!.split('/').pop()!;
    const name = c.kind ?? (tail.endsWith(':acquire') ? 'owner-acquire' : tail.endsWith(':release') ? 'owner-release' : tail.replace(/^[^:]{20,}:/, '<id>:'));
    const extra = c.status >= 400 ? ` ${c.code ?? ''}` : c.state ? ` ${c.state}${c.code ? '/' + c.code : ''}` : '';
    return `${name}:${c.status}${c.fault ? '!' + c.fault : ''}${extra}`.trim();
  });
}
// Workspace storage lease row (holder_key NULL = free) and the Broker's
// runtime Session rows behind it.
export async function leaseRow(workspace: number) {
  const key = createHash('sha256').update(`${rig.tenantId}\u0000storage-${workspace}`).digest('hex');
  return (await sql('SELECT holder_key, binding_id, runtime_generation, runtime_session_id FROM managed_workspace_execution_lease WHERE storage_key = ?', [key]))[0] ?? null;
}
export async function runtimeSessions(workspace: number) {
  return (await sql('SELECT runtime_session_id, session_state, turn_kind, record_version FROM qwen_runtime_session WHERE workspace_id = ? ORDER BY last_active_at', [`workspace-${workspace}`]))
    .map((r) => `${String(r['runtime_session_id']).slice(0, 12)}…:${r['session_state']}`);
}
export function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
// Latest durable MCP configuration records of a Session, read from SQL:
// "serverId:releaseState@rev<revision>".
export async function mcpRecords(sessionId: string) {
  const rows = await sql(
    'SELECT e.record_id, e.revision, CONVERT(r.inline_bytes USING utf8mb4) AS body' +
      ' FROM qwen_managed_session_extension_record e JOIN qwen_managed_session_resource r' +
      ' ON r.tenant_id = e.tenant_id AND r.session_id = e.session_id AND r.resource_id = e.record_resource_id' +
      " WHERE e.session_id = ? AND e.domain = 'mcp_configuration' ORDER BY e.created_at, e.record_id",
    [sessionId],
  );
  return rows.map((r) => {
    const b = String(r['body']);
    return `${/"serverId":"([^"]+)"/.exec(b)?.[1]}:${/"releaseState":"([a-z]+)"/.exec(b)?.[1]}@rev${r['revision']}`;
  });
}
// Broker requests (B) and MCP release-state commits (S) since the given
// indexes, merged in arrival order.
export function timeline(fromBroker = 0, fromStore = 0) {
  const b = brokerCalls.slice(fromBroker).map((c, i) => ({ t: c.t, s: `B ${brokerKinds(fromBroker)[i]}` }));
  const s = storeCalls.slice(fromStore).filter((c) => c.releases).map((c) => ({ t: c.t, s: `S ${c.releases!.join(',')}→${c.status}${c.fault ? '!' + c.fault : ''}` }));
  return [...b, ...s].sort((x, y) => x.t - y.t).map((x) => x.s);
}
