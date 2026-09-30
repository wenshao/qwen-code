// Verification rig for PR #13071 (D6a Hosted tool approvals).
// Real MySQL 8.4 + Spring server jar (Session Store + embedded Runtime Broker)
// + packaged Hosted Harness (dist/cli.js) + fake OpenAI model. The driver
// speaks the Harness private API directly, as the D6b Java slice will.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RIG = path.dirname(new URL(import.meta.url).pathname);
export const MYSQL = '/root/rig/mysql-cli';
export const NODE = '/usr/bin/node';
export const HARNESS_TOKEN = 'rig-harness-token-13098';
export const DIGEST = `sha256:${'a'.repeat(64)}`;
export const BROKER_TOKEN = process.env.BROKER_TOKEN ?? 'rig-broker-token-12894';
export const TENANT = 't-rig';
export const DB = process.env.DB ?? 'd6a';
export const HTTP = Number(process.env.HTTP ?? 18897);
export const BPORT = Number(process.env.BPORT ?? 19897);
export const WT = process.env.WT ?? '/root/git/qwen-code-pr13098';
export const FILE_PROFILE = 'hosted-workspace-files/1';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let logFile = null;
export function openLog(name) {
  logFile = path.join(RIG, 'out', `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
}
export function say(tag, text) {
  const line = `[${tag}] ${typeof text === 'string' ? text : JSON.stringify(text)}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}

let failures = 0;
export function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  say(ok ? 'PASS' : 'FAIL', `${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return ok;
}
export function exitSummary() {
  say('summary', failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

export function sql(db, query) {
  const out = execFileSync(
    MYSQL,
    ['-uroot', '-prig12894', db, '-N', '-B', '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}

export function seedRegistry(workspace, storage, actors = ['alice']) {
  if (sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${workspace}'`)[0][0] !== '0') return;
  sql(
    DB,
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`,
  );
  for (const actor of actors)
    sql(
      DB,
      `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}',CAST('${actor}' AS BINARY),TRUE,TRUE)`,
    );
}

export async function api(method, url, { actor, idem, body } = {}) {
  const headers = { 'content-type': 'application/json', 'X-Qwen-Tenant-Id': TENANT };
  if (actor) headers['X-Rig-Actor'] = actor;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(`http://127.0.0.1:${HTTP}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

export async function createWorkspaceSession(workspace, cwd = 'child', actor = 'alice') {
  const res = await api('POST', '/v1/agents/sessions', {
    actor,
    idem: randomUUID(),
    body: { agent_id: 'qwen-code', workspace: { workspace_id: workspace, cwd_relative: cwd } },
  });
  if (res.status >= 300) throw new Error(`create session: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id ?? res.json.session_id ?? res.json.sessionId;
}

// ---------------------------------------------------------------------------
// Durable journal / resource reads straight from MySQL (the D6b projection
// will do this through the Store; the rig reads the same committed bytes).
export function journalEvents(sessionId) {
  const rows = sql(
    DB,
    `SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision`,
  );
  const events = [];
  for (const [blob] of rows)
    for (const line of blob.split('\\n').join('\n').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const record = JSON.parse(t);
        if (record.managedSession) events.push(record.managedSession);
      } catch { /* partial line */ }
    }
  return events.sort((a, b) => a.sequence - b.sequence);
}

export function actionEvents(sessionId) {
  return journalEvents(sessionId).filter((e) => e.kind === 'action.changed');
}

export function readResource(sessionId, resourceId) {
  const rows = sql(
    DB,
    `SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${sessionId}' AND resource_id='${resourceId}'`,
  );
  return rows.length ? rows[0][0] : null;
}

export function requestedActions(sessionId) {
  // Latest state per requestId, with its options resource parsed.
  const byId = new Map();
  for (const e of actionEvents(sessionId)) {
    const p = e.payload ?? {};
    const id = p.requestId ?? p.action?.requestId;
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) ?? {}), event: e });
  }
  const out = [];
  for (const [requestId, { event }] of byId) {
    const p = event.payload;
    const action = p.action ?? p;
    const optionsRef = action.optionsRef ?? null;
    let options = null;
    if (optionsRef?.resourceId) {
      const raw = readResource(sessionId, optionsRef.resourceId);
      if (raw) { try { options = JSON.parse(raw); } catch { /* keep null */ } }
    }
    out.push({ requestId, state: action.state, optionsRef, options, sequence: event.sequence });
  }
  return out.sort((a, b) => a.sequence - b.sequence);
}

// ---------------------------------------------------------------------------
// Hosted Harness process
export class Harness {
  constructor({ name, modelUrl, brokerUrl, workspace }) {
    Object.assign(this, { name, modelUrl, brokerUrl });
    this.root = workspace ?? path.join(RIG, 'run', `harness-${name}`);
    this.output = '';
  }
  async start() {
    fs.rmSync(this.root, { recursive: true, force: true });
    const qwenHome = path.join(this.root, '.qwen');
    fs.mkdirSync(qwenHome, { recursive: true });
    fs.writeFileSync(
      path.join(qwenHome, 'settings.json'),
      JSON.stringify({
        security: { auth: { selectedType: 'openai' } },
        model: { name: 'hosted-fixture' },
        telemetry: { enabled: false },
        modelProviders: { openai: [{ id: 'hosted-fixture', envKey: 'OPENAI_API_KEY', baseUrl: this.modelUrl }] },
      }),
    );
    const env = {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      OPENAI_API_KEY: 'local-fixture-key',
      OPENAI_BASE_URL: this.modelUrl,
      OPENAI_MODEL: 'hosted-fixture',
      QWEN_MODEL: 'hosted-fixture',
    };
    const args = [
      path.join(WT, 'dist', 'cli.js'),
      'serve', '--profile', 'hosted-harness', '--http-bridge', '--no-web',
      '--hostname', '127.0.0.1', '--port', '0', '--token', HARNESS_TOKEN,
      '--hosted-harness-capability-digest', DIGEST, '--workspace', this.root,
    ];
    if (this.brokerUrl)
      args.push('--managed-runtime-broker-url', this.brokerUrl, '--managed-runtime-broker-token', BROKER_TOKEN);
    this.logPath = path.join(RIG, 'run', `harness-${this.name}.log`);
    const log = fs.openSync(this.logPath, 'w');
    this.child = spawn(NODE, args, {
      cwd: this.root,
      stdio: ['ignore', log, log],
      env: {
        ...env,
        HOME: this.root,
        QWEN_HOME: qwenHome,
        QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(this.root, 'system-settings.json'),
        QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(this.root, 'system-defaults.json'),
        QWEN_RUNTIME_DIR: path.join(this.root, 'runtime'),
        QWEN_SANDBOX: 'false',
        NO_COLOR: '1',
      },
    });
    fs.writeFileSync(path.join(RIG, 'run', `harness-${this.name}.pid`), String(this.child.pid));
    const end = Date.now() + 90_000;
    while (Date.now() < end) {
      this.output = fs.readFileSync(this.logPath, 'utf8');
      const m = this.output.match(/qwen serve listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) this.baseUrl = m[1];
      if (this.child.exitCode !== null) throw new Error(`harness exited: ${this.output.slice(-2000)}`);
      if (this.baseUrl) {
        const r = await fetch(this.baseUrl + '/capabilities', { headers: this.headers() }).catch(() => null);
        if (r && r.ok) {
          this.bootId = (await r.json()).hostedHarness.bootId;
          return this;
        }
      }
      await sleep(200);
    }
    throw new Error('harness did not start: ' + this.output.slice(-2000));
  }
  log() { return fs.readFileSync(this.logPath, 'utf8'); }
  headers(clientId) {
    return {
      Authorization: `Bearer ${HARNESS_TOKEN}`,
      'X-Qwen-Harness-Protocol-Version': '1',
      ...(this.bootId ? { 'X-Qwen-Harness-Boot-Id': this.bootId } : {}),
      ...(clientId ? { 'X-Qwen-Client-Id': clientId } : {}),
      'Content-Type': 'application/json',
    };
  }
  async json(route, body, { clientId, method } = {}) {
    const r = await fetch(this.baseUrl + route, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: this.headers(clientId),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { status: r.status, json };
  }
  async stop(signal = 'SIGTERM') {
    if (this.child && this.child.exitCode === null) {
      this.child.kill(signal);
      for (let i = 0; i < 50 && this.child.exitCode === null; i++) await sleep(100);
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }
  }
}

export function storeConnection(h, workspaceId, baseUrl = `http://127.0.0.1:${HTTP}`) {
  return {
    baseUrl,
    tenantId: TENANT,
    workspaceId,
    writerId: h.bootId,
    leaseDurationMs: 60_000,
  };
}

// A thin client around one harness Session.
export class HSession {
  constructor(h, sessionId, connection) {
    Object.assign(this, { h, sessionId, connection });
  }
  async create(extra = {}) {
    const r = await this.h.json('/session', {
      sessionId: this.sessionId,
      sessionScope: 'thread',
      managedSessionStore: this.connection,
      ...extra,
    });
    if (r.status === 200) this.clientId = r.json.clientId;
    return r;
  }
  async load(extra = {}) {
    const r = await this.h.json(`/session/${this.sessionId}/load`, {
      managedSessionStore: this.connection,
      ...extra,
    });
    if (r.status === 200) this.clientId = r.json.clientId;
    return r;
  }
  async status() {
    return (await this.h.json(`/session/${this.sessionId}/status`, undefined, { clientId: this.clientId })).json;
  }
  async submit(text) {
    const blocks = [{ type: 'text', text }];
    const promptId = randomUUID();
    const r = await this.h.json(
      `/session/${this.sessionId}/prompt`,
      {
        promptId,
        prompt: blocks,
        payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(blocks)).digest('hex')}`,
      },
      { clientId: this.clientId },
    );
    return { promptId, ...r };
  }
  async cancel() {
    return this.h.json(`/session/${this.sessionId}/cancel`, {}, { clientId: this.clientId });
  }
  async resolve(requestId, body) {
    return this.h.json(`/session/${this.sessionId}/actions/${requestId}/resolve`, body, { clientId: this.clientId });
  }
  async waitIdle(ms = 120_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await this.status();
      if (s && !s.hasActivePrompt) return s;
      await sleep(150);
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
}

// Wait until a requested approval Action appears in the durable journal.
export async function waitForAction(sessionId, ms = 60_000, afterSequence = 0) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = requestedActions(sessionId).filter(
      (a) => a.state === 'requested' && a.sequence > afterSequence && a.options,
    );
    if (found.length) return found[0];
    await sleep(300);
  }
  throw new Error('no requested Action appeared in the journal');
}

// ---------------------------------------------------------------------------
// Transparent HTTP proxy (Harness -> Session Store) with a fault hook.
import { createServer } from 'node:http';
export async function startPassProxy(targetOrigin) {
  const ledger = [];
  const state = { hook: null };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    const entry = { t: Date.now(), method: req.method, url: req.url.replace(/\?.*$/, ''), status: null };
    ledger.push(entry);
    try {
      const action = (await state.hook?.(entry, body)) ?? 'forward';
      if (action === 'fail-503') {
        entry.status = '503-injected';
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'injected', code: 'store_unavailable', retryable: true }));
        return;
      }
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      const r = await fetch(new URL(req.url, targetOrigin), {
        method: req.method,
        headers,
        ...(body.length ? { body } : {}),
        signal: AbortSignal.timeout(60_000),
      });
      const buf = Buffer.from(await r.arrayBuffer());
      entry.status = r.status;
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
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    ledger,
    state,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export async function startBrokerProxy(brokerUrl, token = BROKER_TOKEN) {
  const ledger = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    const entry = { t: Date.now(), method: req.method, url: req.url.replace(/\?.*$/, ''), status: null };
    ledger.push(entry);
    try {
      const r = await fetch(new URL(req.url, brokerUrl), {
        method: req.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body.length ? { body } : {}),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await r.text();
      entry.status = r.status;
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(text);
    } catch (e) {
      entry.status = `proxy-error ${e.message}`;
      res.writeHead(503);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    ledger,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export function ledgerSince(ledger, t0) {
  return ledger.filter((e) => e.t >= t0).map((e) => `${e.method} ${e.url.replace('/internal/runtime-broker/v1', '')} -> ${e.status}`);
}
