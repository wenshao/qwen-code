// VERIFICATION RIG ONLY (PR #13129, Hosted Hooks H2).
// Real MySQL 8.4.7 + server fat jar (Session Store + embedded Runtime Broker +
// local-process workers) + packaged Hosted Harness (dist/cli.js). The model is
// either a scripted local OpenAI-compatible server or a real provider.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

export const RIG = '/Users/wenshao/pr13129-rig';
const env = Object.fromEntries(
  fs
    .readFileSync(`${RIG}/rig.env`, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
export const DB = process.env.DB ?? 'hk';
export const RUN = `${RIG}/run/${DB}`;
export const SPRING_PORT = Number(process.env.SPORT ?? env.SPRING_PORT);
export const BROKER_PORT = Number(process.env.BPORT ?? env.BROKER_PORT);
export const STORE = `http://127.0.0.1:${SPRING_PORT}`;
export const BROKER = `http://127.0.0.1:${BROKER_PORT}`;
export const TENANT = env.TENANT;
export const NODE = env.NODE;
export const FILES = 'hosted-workspace-files/1';
export const SHELL = 'hosted-workspace-shell/1';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const j = (v) => JSON.stringify(v);
export const sha = (b) => createHash('sha256').update(b).digest('hex');

export function sql(query, db = DB) {
  const out = execFileSync(env.MYSQL, ['-uroot', `-p${env.DBPASS}`, '-h127.0.0.1', `-P${env.DBPORT}`, '-N', '-B', db, '-e', query], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter((l) => l.length)
    .map((l) => l.split('\t'));
}
export const one = (q, db) => sql(q, db)[0]?.[0];

export function seedRegistry(workspace, storage, actors = ['alice']) {
  sql(
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`,
  );
  for (const actor of actors)
    sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}',CAST('${actor}' AS BINARY),TRUE,TRUE)`);
}

export async function api(method, url, { actor = 'alice', idem, body } = {}) {
  const headers = { 'content-type': 'application/json', 'X-Qwen-Tenant-Id': TENANT };
  if (actor) headers['X-Rig-Actor'] = actor;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(`${STORE}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

// A Workspace Session row is created through the public API; the turn itself is driven on the Harness.
export async function createWorkspaceSession(workspace, cwd = 'child', actor = 'alice') {
  const res = await api('POST', '/v1/agents/sessions', {
    actor,
    idem: randomUUID(),
    body: { agent_id: 'qwen-code', workspace: { workspace_id: workspace, cwd_relative: cwd } },
  });
  if (res.status >= 300) throw new Error(`create session: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id ?? res.json.session_id ?? res.json.sessionId;
}

// Workspace + Session for a storage letter. Returns ids and the execution directory on disk.
export async function workspace(letter, name = `ws-${letter}-${Date.now().toString(36)}`) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${name}'`) === '0') seedRegistry(name, `st-${letter}`);
  return { workspaceId: name, storage: `st-${letter}`, dir: `${RUN}/ws/${letter}/child` };
}

export const leaseHolders = () =>
  sql('SELECT storage_key, IFNULL(holder_key,"<none>"), IFNULL(runtime_session_id,"<none>") FROM managed_workspace_execution_lease ORDER BY storage_key');
export const storageKey = (letter) => sha(`${TENANT}\0st-${letter}`);
export function holderOf(letter) {
  const row = sql(`SELECT IFNULL(runtime_session_id,'<none>') FROM managed_workspace_execution_lease WHERE storage_key='${storageKey(letter)}'`)[0];
  return row ? row[0] : '<no row>';
}

// ---------------------------------------------------------------------------
// Scripted model. A prompt carries `SCRIPT:<base64 json>:END`; json = { steps: [[{name,args,id?}]...], final }.
// The reply for a request is steps[n], n = number of assistant tool-call messages after the last scripted user message.
export const script = (steps, final = 'DONE') => `SCRIPT:${Buffer.from(JSON.stringify({ steps, final })).toString('base64')}:END`;
export const call = (name, args, id) => ({ name, args, id });
const text = (content) => (typeof content === 'string' ? content : JSON.stringify(content ?? ''));
export async function startModel(logFile) {
  const requests = [];
  const state = { hook: null };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400).end('bad json');
      return;
    }
    const messages = body.messages ?? [];
    let last = -1;
    messages.forEach((m, i) => {
      if (m.role === 'user' && /SCRIPT:[A-Za-z0-9+/=]+:END/.test(text(m.content))) last = i;
    });
    let reply = { content: 'OK' };
    let step = -1;
    const whole = JSON.stringify(messages);
    const ph = whole.match(/RIGPH:([A-Za-z0-9+/=]+):END/);
    if (ph) {
      reply = { content: Buffer.from(ph[1], 'base64').toString() };
    } else if (last >= 0) {
      const all = [...text(messages[last].content).matchAll(/SCRIPT:([A-Za-z0-9+/=]+):END/g)];
      const spec = JSON.parse(Buffer.from(all.at(-1)[1], 'base64').toString());
      step = messages.slice(last + 1).filter((m) => m.role === 'assistant' && m.tool_calls?.length).length;
      reply =
        step < spec.steps.length
          ? { toolCalls: spec.steps[step].map((c, i) => ({ id: c.id ?? `call-${step}-${i}-${randomUUID().slice(0, 8)}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : { content: spec.final };
    }
    const entry = {
      t: new Date().toISOString(),
      tools: (body.tools ?? []).map((t) => t.function?.name),
      step,
      toolResults: messages.filter((m) => m.role === 'tool').map((m) => ({ id: m.tool_call_id, content: text(m.content).slice(0, 600) })),
      reply: reply.content ?? reply.toolCalls.map((c) => `${c.function.name}(${c.function.arguments.slice(0, 120)})`),
      promptHook: Boolean(ph),
      markers: [...whole.matchAll(/(?:PRE|POST|BATCH|UPS|START|NOTIFY|ONCE|REV1|REV2|PROMPT-UPS|PROMPT-NOTIFY|CMD|DETACH)-CTX(?::[A-Za-z0-9_./-]*)?|RIG-[A-Z-]+/g)].map((m) => m[0]),
      nMessages: messages.length,
    };
    requests.push(entry);
    if (logFile) fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    await state.hook?.(entry, body);
    const id = `chatcmpl-${randomUUID()}`;
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model ?? 'rig-model' };
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
      if (reply.toolCalls) {
        reply.toolCalls.forEach((c, index) => send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index, ...c }] }, finish_reason: null }] }));
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        send({ ...base, choices: [{ index: 0, delta: { content: reply.content }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      send({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ...base,
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: reply.content ?? null, ...(reply.toolCalls ? { tool_calls: reply.toolCalls } : {}) }, finish_reason: reply.toolCalls ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests, state, close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

// ---------------------------------------------------------------------------
// Hosted Harness process (packaged dist/cli.js of the chosen arm).
const HTOKEN = env.HTOKEN;
export class Harness {
  constructor({ name, modelUrl, brokerUrl = BROKER, arm = process.env.ARM ?? 'head', realModel = false }) {
    Object.assign(this, { name, modelUrl, brokerUrl, arm, realModel });
    this.root = path.join(RUN, `harness-${name}`);
  }
  async start({ keep = false } = {}) {
    if (!keep) fs.rmSync(this.root, { recursive: true, force: true });
    const qwenHome = path.join(this.root, '.qwen');
    fs.mkdirSync(qwenHome, { recursive: true });
    fs.writeFileSync(path.join(this.root, 'proof.txt'), 'decoy');
    const extra = {};
    if (this.realModel) {
      // Real provider: private QWEN_HOME with one provider entry; the key is read from the
      // maintainer's settings env block at launch and never written into the rig.
      const real = JSON.parse(fs.readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
      const provider = real.modelProviders.openai.find((p) => p.id === this.realModel);
      if (!provider) throw new Error(`no provider ${this.realModel}`);
      fs.writeFileSync(
        path.join(qwenHome, 'settings.json'),
        JSON.stringify({ security: { auth: { selectedType: 'openai' } }, model: { name: this.realModel }, telemetry: { enabled: false }, modelProviders: { openai: [{ id: provider.id, envKey: provider.envKey, baseUrl: process.env.REAL_BASEURL ?? provider.baseUrl }] } }),
      );
      extra[provider.envKey] = real.env[provider.envKey];
    } else {
      fs.writeFileSync(
        path.join(qwenHome, 'settings.json'),
        JSON.stringify({ security: { auth: { selectedType: 'openai' } }, model: { name: 'rig-model' }, telemetry: { enabled: false }, modelProviders: { openai: [{ id: 'rig-model', envKey: 'OPENAI_API_KEY', baseUrl: this.modelUrl }] } }),
      );
      Object.assign(extra, { OPENAI_API_KEY: 'local-fixture-key', OPENAI_BASE_URL: this.modelUrl, OPENAI_MODEL: 'rig-model', QWEN_MODEL: 'rig-model' });
    }
    const args = [`${RIG}/dist/${this.arm}/cli.js`, 'serve', '--profile', 'hosted-harness', '--http-bridge', '--no-web', '--hostname', '127.0.0.1', '--port', '0', '--token', HTOKEN, '--hosted-harness-capability-digest', env.DIGEST, '--workspace', this.root];
    if (this.brokerUrl) args.push('--managed-runtime-broker-url', this.brokerUrl, '--managed-runtime-broker-token', env.BTOKEN);
    const n = fs.readdirSync(RUN).filter((f) => f.startsWith(`harness-${this.name}-`) && f.endsWith('.log')).length;
    this.logPath = path.join(RUN, `harness-${this.name}-${n}.log`);
    const log = fs.openSync(this.logPath, 'w');
    this.child = spawn(NODE, args, {
      cwd: this.root,
      stdio: ['ignore', log, log],
      env: {
        PATH: `${path.dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        TZ: 'UTC',
        ...extra,
        HOME: this.root,
        QWEN_HOME: qwenHome,
        QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(this.root, 'system-settings.json'),
        QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(this.root, 'system-defaults.json'),
        QWEN_RUNTIME_DIR: path.join(this.root, 'runtime'),
        QWEN_SANDBOX: 'false',
        NO_COLOR: '1',
      },
    });
    fs.writeFileSync(path.join(RUN, `harness-${this.name}.pid`), String(this.child.pid));
    const end = Date.now() + 120_000;
    while (Date.now() < end) {
      const output = fs.readFileSync(this.logPath, 'utf8');
      const m = output.match(/qwen serve listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) this.baseUrl = m[1];
      if (this.child.exitCode !== null) throw new Error(`harness exited: ${output}`);
      if (this.baseUrl) {
        const r = await fetch(this.baseUrl + '/capabilities', { headers: this.headers() }).catch(() => null);
        if (r && r.ok) {
          this.bootId = (await r.json()).hostedHarness.bootId;
          return this;
        }
      }
      await sleep(200);
    }
    throw new Error('harness did not start: ' + fs.readFileSync(this.logPath, 'utf8'));
  }
  log() {
    return fs.readFileSync(this.logPath, 'utf8');
  }
  headers(clientId) {
    return { Authorization: `Bearer ${HTOKEN}`, 'X-Qwen-Harness-Protocol-Version': '1', ...(this.bootId ? { 'X-Qwen-Harness-Boot-Id': this.bootId } : {}), ...(clientId ? { 'X-Qwen-Client-Id': clientId } : {}), 'Content-Type': 'application/json' };
  }
  async json(route, body, { clientId, method, timeoutMs = 60_000 } = {}) {
    const t0 = Date.now();
    const r = await fetch(this.baseUrl + route, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: this.headers(clientId), ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
    const t = await r.text();
    let json;
    try {
      json = t ? JSON.parse(t) : undefined;
    } catch {
      json = t;
    }
    return { status: r.status, json, ms: Date.now() - t0 };
  }
  async stop(signal = 'SIGTERM') {
    if (this.child && this.child.exitCode === null) {
      this.child.kill(signal);
      for (let i = 0; i < 100 && this.child.exitCode === null && this.child.signalCode === null; i++) await sleep(100);
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    }
  }
}

export const storeConnection = (h, workspaceId, baseUrl = STORE) => ({ baseUrl, tenantId: TENANT, workspaceId, writerId: h.bootId, leaseDurationMs: 60_000 });

// A thin client around one Harness Session.
export class HSession {
  constructor(h, sessionId, connection, profile = FILES) {
    Object.assign(this, { h, sessionId, connection, profile });
  }
  async create(extra = {}) {
    const r = await this.h.json('/session', { sessionId: this.sessionId, sessionScope: 'thread', managedSessionStore: this.connection, ...(this.profile && this.profile !== 'none' ? { toolProfile: this.profile } : {}), ...extra });
    if (r.status === 200) this.clientId = r.json.clientId;
    return r;
  }
  async load(extra = {}) {
    const r = await this.h.json(`/session/${this.sessionId}/load`, { managedSessionStore: this.connection, ...(this.profile && this.profile !== 'none' ? { toolProfile: this.profile } : {}), ...extra });
    if (r.status === 200) this.clientId = r.json.clientId;
    return r;
  }
  detach() {
    return this.h.json(`/session/${this.sessionId}/detach`, {}, { clientId: this.clientId });
  }
  async reload() {
    const d = await this.detach();
    const l = await this.load();
    return { detach: d.status, load: l.status, code: l.json?.code };
  }
  async status() {
    return (await this.h.json(`/session/${this.sessionId}/status`, undefined, { clientId: this.clientId })).json;
  }
  history() {
    return this.h.json(`/session/${this.sessionId}/files/history`, undefined, { clientId: this.clientId });
  }
  rewind(promptId, requestId = randomUUID(), opts = {}) {
    return this.h.json(`/session/${this.sessionId}/files/rewind`, { promptId, requestId }, { clientId: this.clientId, ...opts }).then((r) => ({ ...r, requestId }));
  }
  async submit(textOrBlocks) {
    const blocks = typeof textOrBlocks === 'string' ? [{ type: 'text', text: textOrBlocks }] : textOrBlocks;
    const promptId = randomUUID();
    const r = await this.h.json(`/session/${this.sessionId}/prompt`, { promptId, prompt: blocks, payloadDigest: `sha256:${sha(JSON.stringify(blocks))}` }, { clientId: this.clientId });
    return { promptId, ...r };
  }
  cancel() {
    return this.h.json(`/session/${this.sessionId}/cancel`, {}, { clientId: this.clientId });
  }
  async waitIdle(ms = 180_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await this.status();
      if (s && !s.hasActivePrompt) return s;
      await sleep(100);
    }
    throw new Error('prompt did not become idle');
  }
  async transcript() {
    const events = [];
    let cursor = '0';
    for (;;) {
      const page = (await this.h.json(`/session/${this.sessionId}/transcript?cursor=${cursor}&limit=256`, undefined, { clientId: this.clientId })).json;
      events.push(...page.events);
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    return events;
  }
  async prompt(textOrBlocks, ms) {
    const sub = await this.submit(textOrBlocks);
    if (sub.status !== 202) return { ...sub, terminal: null };
    const t0 = Date.now();
    const st = await this.waitIdle(ms);
    const events = await this.transcript();
    const mine = events.filter((e) => e.promptId === sub.promptId);
    const terminal = mine.filter((e) => e.type.startsWith('turn_'));
    return { ...sub, ms: Date.now() - t0, status2: st, events: mine, terminal };
  }
}

export function turn(r) {
  const term = r.terminal?.map((t) => `${t.type}${t.data?.stopReason ? `(${t.data.stopReason})` : ''}${t.type === 'turn_error' ? `[${JSON.stringify(t.data).slice(0, 220)}]` : ''}`).join(',') || '<none>';
  return `admit=${r.status}${r.json?.code ? ` ${r.json.code}` : ''} terminal=${term} recoveryBlocked=${r.status2?.recoveryBlocked} ${r.ms ?? '?'}ms`;
}
export function toolTrace(events) {
  const out = [];
  for (const e of events) {
    for (const p of e.data?.record?.message?.parts ?? []) {
      if (p.functionCall) out.push(`call ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 110)})`);
      if (p.functionResponse) {
        const resp = p.functionResponse.response ?? {};
        out.push(`result ${p.functionResponse.name}: ${JSON.stringify(resp.output ?? resp.error ?? resp).slice(0, 200)}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Harness -> Broker proxy with a per-request hook and a ledger.
export async function startBrokerProxy(brokerUrl = BROKER) {
  const ledger = [];
  const state = { hook: null };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    let parsed;
    try {
      parsed = body.length ? JSON.parse(body.toString()) : undefined;
    } catch {
      parsed = undefined;
    }
    const entry = { t: Date.now(), method: req.method, url: req.url.replace(/\?.*$/, '').replace('/internal/runtime-broker/v1', ''), op: parsed?.operation?.kind ? `${parsed.operation.kind}${parsed.operation.action ? ':' + parsed.operation.action : ''}` : undefined, status: null };
    ledger.push(entry);
    try {
      const action = (await state.hook?.(entry, parsed, body)) ?? 'forward';
      if (action === 'drop-request') {
        entry.status = 'dropped-before-broker';
        res.destroy();
        return;
      }
      if (action && typeof action === 'object' && action.respond) {
        entry.status = `${action.respond.status}-injected`;
        res.writeHead(action.respond.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(action.respond.body));
        return;
      }
      const r = await fetch(new URL(req.url, brokerUrl), { method: req.method, headers: { Authorization: `Bearer ${env.BTOKEN}`, 'Content-Type': 'application/json' }, ...(body.length ? { body } : {}), signal: AbortSignal.timeout(120_000) });
      const t = await r.text();
      entry.status = r.status;
      entry.ms = Date.now() - entry.t;
      try {
        const o = JSON.parse(t);
        entry.code = o.code;
        entry.message = o.message;
      } catch {
        /* not json */
      }
      if (action === 'drop-reply') {
        entry.status = `${r.status}-reply-dropped`;
        res.destroy();
        return;
      }
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(t);
    } catch (e) {
      entry.status = `proxy-error ${e.message}`;
      res.writeHead(503);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, ledger, state, close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))) };
}
export const ledgerLines = (ledger, t0 = 0) =>
  ledger.filter((e) => e.t >= t0).map((e) => `${e.method} ${e.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')}${e.op ? ` [${e.op}]` : ''} -> ${e.status}${e.code ? ` ${e.code}` : ''}${e.message ? ` "${String(e.message).slice(0, 90)}"` : ''}`);

// Transparent HTTP proxy (Harness -> Session Store) with a fault hook.
export async function startStoreProxy(target = STORE) {
  const ledger = [];
  const state = { hook: null };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    let parsed;
    try {
      parsed = body.length ? JSON.parse(body.toString()) : undefined;
    } catch {
      parsed = undefined;
    }
    const entry = { t: Date.now(), method: req.method, url: req.url.replace(/\?.*$/, ''), operation: parsed?.operation, bytes: body.length, status: null };
    ledger.push(entry);
    try {
      const action = (await state.hook?.(entry, parsed, body)) ?? 'forward';
      if (action === 'fail-503') {
        entry.status = '503-injected';
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'injected', code: 'store_unavailable', retryable: true }));
        return;
      }
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      const r = await fetch(new URL(req.url, target), { method: req.method, headers, ...(body.length ? { body } : {}), signal: AbortSignal.timeout(60_000) });
      const buf = Buffer.from(await r.arrayBuffer());
      entry.status = r.status;
      if (action && typeof action === 'object' && action.delayReplyMs) {
        entry.status = `${r.status}-reply-delayed`;
        await new Promise((ok) => setTimeout(ok, action.delayReplyMs));
      }
      if (action === 'drop-reply') {
        entry.status = `${r.status}-reply-dropped`;
        res.destroy();
        return;
      }
      const out = {};
      r.headers.forEach((v, k) => {
        if (!['content-length', 'transfer-encoding', 'connection', 'content-encoding'].includes(k)) out[k] = v;
      });
      res.writeHead(r.status, out);
      res.end(buf);
    } catch (e) {
      entry.status = `proxy-error ${e.message}`;
      res.writeHead(502);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, ledger, state, close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

export function workerPids() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => l.includes(`${RIG}/dist/`) && l.includes('cli.js') && !l.includes(' serve ') && !l.includes('/bin/java '))
    .map((l) => Number(l.trim().split(/\s+/)[0]));
}

// Backups on the worker volume for one Harness Session.
export const backupDir = (sessionId) => `${RUN}/worker-home/.qwen/file-history/${sessionId}`;
export const backups = (sessionId) => (fs.existsSync(backupDir(sessionId)) ? fs.readdirSync(backupDir(sessionId)).sort() : []);
export const read = (dir, rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null);

// Transcript: every probe prints labelled checks and writes them next to itself.
export class Report {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.pass = 0;
    this.fail = 0;
    fs.mkdirSync(`${RIG}/out/${DB}`, { recursive: true });
    this.file = `${RIG}/out/${DB}/${name}`;
    fs.writeFileSync(`${this.file}.log`, '');
    this.say(`# ${name}  db=${DB} arm=${process.env.ARM ?? 'head'}  ${new Date().toISOString()}`);
  }
  say(line) {
    console.log(line);
    fs.appendFileSync(`${this.file}.log`, line + '\n');
  }
  check(label, ok, detail = '') {
    ok ? this.pass++ : this.fail++;
    this.rows.push({ label, ok, detail });
    this.say(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
    return ok;
  }
  note(label, detail = '') {
    this.rows.push({ label, note: true, detail });
    this.say(`NOTE  ${label}${detail ? '  -> ' + detail : ''}`);
  }
  done(extra = {}) {
    this.say(`== RESULT ${this.name}: ${this.pass} passed, ${this.fail} failed`);
    fs.writeFileSync(`${this.file}.json`, JSON.stringify({ name: this.name, pass: this.pass, fail: this.fail, rows: this.rows, ...extra }, null, 2));
    return this.fail === 0;
  }
}

// ---------------------------------------------------------------------------
// PR #13129 additions: Hook routes, handler ledger/control, HTTP hook server, durable Hook records.
export const HOOK_LEDGER = `${RUN}/hook-ledger.jsonl`;
export const HOOK_CONTROL = `${RUN}/hook-control.json`;
export const pins = () => JSON.parse(fs.readFileSync(`${RUN}/catalogs.json`, 'utf8'));
export const pin = (ws, rev = 1) => pins()[`${ws}#${rev}`];
export function hookLedger(filter = () => true) {
  if (!fs.existsSync(HOOK_LEDGER)) return [];
  return fs.readFileSync(HOOK_LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter(filter);
}
export function setControl(obj) {
  fs.writeFileSync(HOOK_CONTROL, JSON.stringify(obj));
}
HSession.prototype.hooks = function () {
  return this.h.json(`/session/${this.sessionId}/hooks`, undefined, { clientId: this.clientId });
};
HSession.prototype.hookOp = function (event, input, operationId = randomUUID(), opts = {}) {
  return this.h.json(`/session/${this.sessionId}/hooks/operations`, { operationId, event, input }, { clientId: this.clientId, ...opts }).then((r) => ({ ...r, operationId }));
};
HSession.prototype.hookStatus = function (operationId, cancel = false) {
  return cancel
    ? this.h.json(`/session/${this.sessionId}/hooks/operations/${operationId}/cancel`, {}, { clientId: this.clientId })
    : this.h.json(`/session/${this.sessionId}/hooks/operations/${operationId}`, undefined, { clientId: this.clientId });
};
HSession.prototype.register = function (expectedRevision, catalog, operationId = randomUUID()) {
  return this.h.json(`/session/${this.sessionId}/hooks/registrations`, { operationId, expectedRevision, catalog }, { clientId: this.clientId }).then((r) => ({ ...r, operationId }));
};
HSession.prototype.remove = function (withClient = true) {
  return this.h.json(`/session/${this.sessionId}`, undefined, { method: 'DELETE', ...(withClient ? { clientId: this.clientId } : {}) });
};
HSession.prototype.resolve = function (requestId, optionId = 'allow') {
  return this.h.json(`/session/${this.sessionId}/actions/${requestId}/resolve`, { optionId, inputRevision: 1, policyRevision: 'hosted-tool-approval/1' }, { clientId: this.clientId });
};

// Durable Hook records of one Session, from MySQL (extension record row + inline resource body).
export function hookRecords(sessionId, domain = null) {
  const rows = sql(
    `SELECT r.domain, r.record_id, r.revision, r.first_sequence, CAST(res.inline_bytes AS CHAR) FROM qwen_managed_session_extension_record r JOIN qwen_managed_session_resource res ON res.session_scope_key=r.session_scope_key AND res.resource_id=r.record_resource_id WHERE r.session_id='${sessionId}' AND r.domain IN ('hook_registration','hook_execution')${domain ? ` AND r.domain='${domain}'` : ''} ORDER BY r.first_sequence, r.record_id`,
  );
  return rows.map(([d, id, rev, seq, body]) => {
    let rec;
    try {
      rec = JSON.parse(body);
    } catch {
      rec = { unparsed: body?.slice(0, 200) };
    }
    return { domain: d, id, revision: Number(rev), seq: Number(seq), rec };
  });
}
export const execSummary = (r) => {
  const x = r.rec;
  return `${x.eventName ?? '?'}#${x.ordinal}${x.hookId ? ' ' + x.hookId : ''} state=${x.run?.state}${x.run?.execution ? ' exec=' + JSON.stringify(x.run.execution).slice(0, 80) : ''}${x.onceKey ? ' once=' + x.onceKey : ''}`;
};

// Local HTTP Hook endpoint with per-path behaviour: 'ok' | 'drop' (read body, destroy socket) | 'partial' (headers + half a body, then destroy) | {status}.
export async function startHookHttp(port) {
  const ledger = [];
  const state = { mode: {} };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const path = req.url.replace(/\?.*$/, '');
    const entry = { t: Date.now(), path, url: req.url, auth: req.headers.authorization ?? null, bytes: Buffer.concat(chunks).length };
    ledger.push(entry);
    const mode = state.mode[path] ?? 'ok';
    if (mode === 'drop') return req.socket.destroy();
    if (mode === 'hang') return;
    if (typeof mode === 'object' && mode.delayMs) await new Promise((r) => setTimeout(r, mode.delayMs));
    if (mode === 'partial') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '200' });
      res.write('{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalC');
      setTimeout(() => req.socket.destroy(), 50);
      return;
    }
    if (typeof mode === 'object' && mode.status) {
      res.writeHead(mode.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(mode.body ?? {}));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    let event;
    try {
      event = JSON.parse(Buffer.concat(chunks).toString()).hook_event_name;
    } catch {
      event = undefined;
    }
    res.end(JSON.stringify(event ? { hookSpecificOutput: { hookEventName: event, additionalContext: `HTTP-CTX${path}` } } : {}));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { ledger, state, close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

// Harness->Store proxy that also captures Hosted Action request ids from committed bytes.
export async function startActionStoreProxy(target = STORE) {
  const p = await startStoreProxy(target);
  const actions = [];
  const prev = p.state.hook;
  p.state.hook = async (entry, parsed, body) => {
    let hay = body.toString();
    for (const m of hay.matchAll(/"bytesBase64"\s*:\s*"([A-Za-z0-9+/=]+)"/g)) hay += Buffer.from(m[1], 'base64').toString();
    for (const m of hay.matchAll(/tool_approval_[0-9a-f]{32}/g)) if (!actions.includes(m[0])) actions.push(m[0]);
    return (await p.userHook?.(entry, parsed, body)) ?? 'forward';
  };
  return Object.assign(p, { actions, prev });
}

// Track attached Sessions so probes can detach them before stopping a Harness (a raw stop leaks the hook lease; see F1).
const _create = HSession.prototype.create;
const _load = HSession.prototype.load;
HSession.prototype.create = async function (extra) {
  const r = await _create.call(this, extra);
  if (r.status === 200) (this.h.attached ??= new Set()).add(this);
  return r;
};
HSession.prototype.load = async function (extra) {
  const r = await _load.call(this, extra);
  if (r.status === 200) (this.h.attached ??= new Set()).add(this);
  return r;
};
Harness.prototype.close = async function () {
  for (const s of this.attached ?? []) {
    try {
      await s.detach();
    } catch {
      /* best effort */
    }
  }
  await this.stop();
};

// RIG WORKAROUND for F1: release a hook Runtime Session that a replaced Harness left holding this storage's lease.
export async function repairLeak(letter) {
  const holder = sql(`SELECT runtime_session_id FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('${TENANT}', CHAR(0), 'st-${letter}'),256) AND runtime_session_id LIKE 'hooks-%'`)[0]?.[0];
  if (!holder) return null;
  const owner = sql(`SELECT DISTINCT r.session_id FROM qwen_managed_session_extension_record r JOIN qwen_managed_session_resource res ON res.session_scope_key=r.session_scope_key AND res.resource_id=r.record_resource_id WHERE r.domain='hook_execution' AND CAST(res.inline_bytes AS CHAR) LIKE '%${holder}%'`)[0]?.[0];
  const r = await fetch(`${BROKER}/internal/runtime-broker/v1/tool-sessions/${holder}:release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BTOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, requestId: randomUUID(), harnessSessionId: owner, runtimeSessionId: holder }),
  });
  return `${holder} owner=${owner} -> ${r.status}`;
}
