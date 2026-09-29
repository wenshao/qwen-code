// Verification rig for PR #12894 (O2 durable remote Shell result delivery).
// Real MySQL 8.4.7 + Spring server jar (Session Store + embedded Runtime
// Broker + local-process workers) + packaged Hosted Harness (dist/cli.js).
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RIG = path.dirname(new URL(import.meta.url).pathname);
export const SP = path.dirname(RIG);
export const MYSQL = '/root/rig/mysql-cli';
export const NODE22 = '/usr/bin/node';
export const HARNESS_TOKEN = 'rig-harness-token-12894';
export const DIGEST = `sha256:${'a'.repeat(64)}`;
export const BROKER_TOKEN = process.env.BROKER_TOKEN ?? 'rig-broker-token-12894';
export const TENANT = 't-rig';
export const PROFILE = 'hosted-workspace-shell/1';
export const CAPTURE = Number(process.env.CAPTURE ?? 256 * 1024 * 1024);
export const WT = process.env.WT ?? '/root/git/qwen-code-c2';
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

export function sql(db, query) {
  const out = execFileSync(
    MYSQL,
    ['-uroot', '-prig12894', '-h127.0.0.1', '-P13894', '-N', '-B', db, '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}

export function holders(db) {
  return sql(
    db,
    'SELECT storage_key, IFNULL(runtime_session_id,"<none>") FROM managed_workspace_execution_lease ORDER BY storage_key',
  );
}

export function seedRegistry(db, workspace, storage, actors = ['alice']) {
  sql(
    db,
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`,
  );
  for (const actor of actors)
    sql(
      db,
      `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}',CAST('${actor}' AS BINARY),TRUE,TRUE)`,
    );
}

export async function api(port, method, url, { actor, idem, body } = {}) {
  const headers = { 'content-type': 'application/json', 'X-Qwen-Tenant-Id': TENANT };
  if (actor) headers['X-Rig-Actor'] = actor;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

export async function createWorkspaceSession(port, workspace, cwd = 'child', actor = 'alice') {
  const res = await api(port, 'POST', '/v1/agents/sessions', {
    actor,
    idem: randomUUID(),
    body: { agent_id: 'qwen-code', workspace: { workspace_id: workspace, cwd_relative: cwd } },
  });
  if (res.status >= 300) throw new Error(`create session: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id ?? res.json.session_id ?? res.json.sessionId;
}

// ---------------------------------------------------------------------------
// Hosted Harness process
export class Harness {
  constructor({ name, modelUrl, brokerUrl, realModel = false, workspace }) {
    Object.assign(this, { name, modelUrl, brokerUrl, realModel });
    this.root = workspace ?? path.join(RIG, 'run', `harness-${name}`);
    this.output = '';
  }
  async start() {
    fs.rmSync(this.root, { recursive: true, force: true });
    const qwenHome = path.join(this.root, '.qwen');
    fs.mkdirSync(qwenHome, { recursive: true });
    const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };
    if (this.realModel) {
      // Real provider: private QWEN_HOME with one provider entry; the key is
      // read from the maintainer's settings env block and never written here.
      const real = JSON.parse(fs.readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
      const provider = real.modelProviders.openai.find((p) => p.id === this.realModel);
      fs.writeFileSync(
        path.join(qwenHome, 'settings.json'),
        JSON.stringify({
          security: { auth: { selectedType: 'openai' } },
          model: { name: this.realModel },
          telemetry: { enabled: false },
          modelProviders: { openai: [{ id: provider.id, envKey: provider.envKey, baseUrl: process.env.REAL_BASEURL ?? provider.baseUrl }] },
        }),
      );
      env[provider.envKey] = real.env[provider.envKey];
    } else {
      fs.writeFileSync(
        path.join(qwenHome, 'settings.json'),
        JSON.stringify({
          security: { auth: { selectedType: 'openai' } },
          model: { name: 'hosted-fixture' },
          telemetry: { enabled: false },
          modelProviders: { openai: [{ id: 'hosted-fixture', envKey: 'OPENAI_API_KEY', baseUrl: this.modelUrl }] },
        }),
      );
      Object.assign(env, {
        OPENAI_API_KEY: 'local-fixture-key',
        OPENAI_BASE_URL: this.modelUrl,
        OPENAI_MODEL: 'hosted-fixture',
        QWEN_MODEL: 'hosted-fixture',
      });
    }
    const args = [
      path.join(process.env.HARNESS_WT ?? WT, 'dist', 'cli.js'),
      'serve', '--profile', 'hosted-harness', '--http-bridge', '--no-web',
      '--hostname', '127.0.0.1', '--port', '0', '--token', HARNESS_TOKEN,
      '--hosted-harness-capability-digest', DIGEST, '--workspace', this.root,
    ];
    if (this.brokerUrl)
      args.push('--managed-runtime-broker-url', this.brokerUrl, '--managed-runtime-broker-token', BROKER_TOKEN);
    this.logPath = path.join(RIG, 'run', `harness-${this.name}.log`);
    const log = fs.openSync(this.logPath, 'w');
    this.child = spawn(NODE22, args, {
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
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      this.output = fs.readFileSync(this.logPath, 'utf8');
      const m = this.output.match(/qwen serve listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) this.baseUrl = m[1];
      if (this.child.exitCode !== null) throw new Error(`harness exited: ${this.output}`);
      if (this.baseUrl) {
        const r = await fetch(this.baseUrl + '/capabilities', { headers: this.headers() }).catch(() => null);
        if (r && r.ok) {
          this.bootId = (await r.json()).hostedHarness.bootId;
          return this;
        }
      }
      await sleep(200);
    }
    throw new Error('harness did not start: ' + this.output);
  }
  log() {
    return fs.readFileSync(this.logPath, 'utf8');
  }
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
      signal: AbortSignal.timeout(Number(process.env.JSON_TIMEOUT ?? 30_000)),
    });
    const text = await r.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: r.status, json };
  }
  async stop() {
    if (this.child && this.child.exitCode === null) {
      this.child.kill('SIGTERM');
      for (let i = 0; i < 50 && this.child.exitCode === null; i++) await sleep(100);
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }
  }
}

export function storeConnection(h, workspaceId, storePort) {
  return {
    baseUrl: `http://127.0.0.1:${storePort}`,
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
  async create(extra = process.env.LOCAL === '1' ? { toolProfile: PROFILE } : { toolProfile: PROFILE, captureBytes: CAPTURE }) {
    const r = await this.h.json('/session', {
      sessionId: this.sessionId,
      sessionScope: 'thread',
      managedSessionStore: this.connection,
      ...extra,
    });
    if (r.status === 200) this.clientId = r.json.clientId;
    return r;
  }
  async load(extra = process.env.LOCAL === '1' ? { toolProfile: PROFILE } : { toolProfile: PROFILE, captureBytes: CAPTURE }) {
    const r = await this.h.json(`/session/${this.sessionId}/load`, {
      managedSessionStore: this.connection,
      ...extra,
    });
    if (r.status === 200) this.clientId = r.json.clientId;
    return r;
  }
  async detach() {
    return this.h.json(`/session/${this.sessionId}/detach`, {}, { clientId: this.clientId });
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
  async prompt(text, ms) {
    const sub = await this.submit(text);
    if (sub.status !== 202) return { ...sub, terminal: null };
    const t0 = Date.now();
    const st = await this.waitIdle(ms);
    const events = await this.transcript();
    const mine = events.filter((e) => e.promptId === sub.promptId);
    const terminal = mine.filter((e) => e.type.startsWith('turn_'));
    return { ...sub, ms: Date.now() - t0, status2: st, events: mine, terminal };
  }
}

export function summarizeTurn(r) {
  const term = r.terminal?.map((t) => `${t.type}${t.data?.stopReason ? `(${t.data.stopReason})` : ''}`).join(',') || '<none>';
  return `admit=${r.status} terminal=${term} recoveryBlocked=${r.status2?.recoveryBlocked} ${r.ms ?? '?'}ms`;
}

export function toolTrace(events) {
  const out = [];
  for (const e of events) {
    const parts = e.data?.record?.message?.parts ?? [];
    for (const p of parts) {
      if (p.functionCall) out.push(`call ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 90)}) id=${p.functionCall.id}`);
      if (p.functionResponse) {
        const resp = p.functionResponse.response ?? {};
        out.push(`result ${p.functionResponse.name} status=${resp.executionStatus} ${JSON.stringify(resp.output ?? resp.error ?? '').slice(0, 80)}`);
      }
    }
  }
  return out;
}

export function assistantText(events) {
  return events
    .filter((e) => e.type === 'session_update')
    .map((e) => e.data?.update?.content?.text ?? '')
    .join('');
}

export function launches(db) {
  const f = path.join(RIG, 'run', `launches-${db}.log`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : [];
}

export function workerProcs() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => l.includes(SP) && l.includes('dist/cli.js') && !l.includes(' serve '))
    .map((l) => l.trim());
}

// ---------------------------------------------------------------------------
// Harness -> Broker proxy with per-request hooks and a request ledger.
import { createServer } from 'node:http';
export async function startBrokerProxy(brokerUrl, token = BROKER_TOKEN) {
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
      if (action && typeof action === 'object' && action.respond) {
        // The hook already talked to the Broker itself (e.g. with a rewritten body).
        res.writeHead(action.respond.status, { 'Content-Type': 'application/json' });
        res.end(action.respond.text);
        return;
      }
      if (action === 'drop-request') {
        entry.status = 'dropped-before-broker';
        res.destroy();
        return;
      }
      const r = await fetch(new URL(req.url, brokerUrl), {
        method: req.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body.length ? { body } : {}),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await r.text();
      entry.status = r.status;
      entry.code = (() => { try { const j = JSON.parse(text); return j.code ? `${j.code} ${String(j.message ?? j.error ?? '').slice(0, 140)}` : j.status?.state ? `state=${j.status.state}` : undefined; } catch { return undefined; } })();
      if (action === 'drop-reply') {
        entry.status = `${r.status}-reply-dropped`;
        res.destroy();
        return;
      }
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
    state,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export function ledgerSince(ledger, t0) {
  return ledger.filter((e) => e.t >= t0).map((e) => `${e.method} ${e.url.replace('/internal/runtime-broker/v1', '')} -> ${e.status}${e.code ? ` ${e.code}` : ''}`);
}

// ---------------------------------------------------------------------------
// Transparent HTTP proxy (Harness -> Session Store) with a fault hook.
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

// ---------------------------------------------------------------------------
// PR #12894 additions: fake OSS control plane, catalog reconstruction, range reads.
export const OSS_ADMIN = 'http://127.0.0.1:18994';
export const OSS_DATA = path.join(RIG, 'oss-data');
export async function oss(route, body) {
  const r = await fetch(OSS_ADMIN + route, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}
export function ossFile(key) {
  return path.join(OSS_DATA, createHash('sha256').update(key).digest('hex'));
}
export function publications(db, sessionId) {
  return sql(db, `SELECT publication_id, state, producer_phase, capture_bytes, capture_held_bytes, producer_held_bytes, admission_held_bytes, capture_used_bytes, producer_used_bytes, admission_used_bytes, IFNULL(receipt_sequence,'-'), quarantined FROM qwen_tool_publication WHERE session_id='${sessionId}' ORDER BY publication_id`).map((r) => ({
    id: r[0], state: r[1], phase: r[2], captureBytes: +r[3], held: { capture: +r[4], producer: +r[5], admission: +r[6] }, used: { capture: +r[7], producer: +r[8], admission: +r[9] }, receiptSequence: r[10], quarantined: r[11],
  }));
}
export function objects(db, publicationId) {
  return sql(db, `SELECT slot_key, IFNULL(resource_kind,'-'), byte_length, sha256, IFNULL(object_key,'-'), state, operation_id, inline_bytes IS NOT NULL FROM qwen_tool_publication_object WHERE publication_id='${publicationId}' ORDER BY slot_key`).map((r) => ({
    slot: r[0], kind: r[1], length: +r[2], sha256: r[3], objectKey: r[4] === '-' ? null : r[4], state: r[5], op: r[6], inline: r[7] === '1',
  }));
}
// Rebuild one raw stream from the SQL catalog + stored objects (independent of the reader API).
export function rebuildStream(db, publicationId, stream) {
  const segs = objects(db, publicationId)
    .map((o) => ({ ...o, m: o.slot.match(new RegExp(`^segment:${stream}:(\\d+)$`)) }))
    .filter((o) => o.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  const hash = createHash('sha256');
  let length = 0;
  for (const [i, s] of segs.entries()) {
    if (Number(s.m[1]) !== i) throw new Error(`gap at ${i}`);
    const bytes = fs.readFileSync(ossFile(s.objectKey));
    if (createHash('sha256').update(bytes).digest('hex') !== s.sha256) throw new Error(`object ${s.objectKey} differs from catalog`);
    hash.update(bytes);
    length += bytes.length;
  }
  return { segments: segs.length, length, sha256: hash.digest('hex') };
}
// Deterministic generator oracle (must match gen.mjs).
export function genStream(tag, stream, bytes) {
  const hash = createHash('sha256');
  let left = bytes, block = 0;
  while (left > 0) {
    const chunk = genBlock(tag, stream, block++);
    const take = Math.min(left, chunk.length);
    hash.update(chunk.subarray(0, take));
    left -= take;
  }
  return hash.digest('hex');
}
export function genBlock(tag, stream, block) {
  const out = Buffer.alloc(65536);
  for (let i = 0; i < 2048; i++) createHash('sha256').update(`${tag}|${stream}|${block}|${i}`).digest().copy(out, i * 32);
  return out;
}
export function genSlice(tag, stream, offset, length) {
  const out = Buffer.alloc(length);
  let pos = 0;
  while (pos < length) {
    const abs = offset + pos;
    const block = Math.floor(abs / 65536), within = abs % 65536;
    const b = genBlock(tag, stream, block);
    const n = b.copy(out, pos, within, Math.min(65536, within + length - pos));
    pos += n;
  }
  return out;
}
// An explicit second owner: acquire a Session writer with our own token (after the Harness sealed).
export async function acquireWriter(port, workspaceId, sessionId, writerId = `verifier-${randomUUID()}`) {
  const token = randomUUID() + randomUUID();
  const r = await fetch(`http://127.0.0.1:${port}/internal/managed-session-store/v1/sessions/${sessionId}/writers:acquire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Qwen-Tenant-Id': TENANT, 'X-Qwen-Managed-Writer-Token': token },
    body: JSON.stringify({ workspaceId, writerId, leaseMillis: 60000 }),
  });
  return { status: r.status, json: await r.json(), token, writerId };
}
export async function readRange(port, workspaceId, sessionId, publicationId, writerToken, body) {
  const r = await fetch(`http://127.0.0.1:${port}/internal/managed-tool-publications/v1/sessions/${sessionId}/publications/${publicationId}/range?workspaceId=${workspaceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Qwen-Tenant-Id': TENANT, 'X-Qwen-Managed-Writer-Token': writerToken },
    body: JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, bytes: buf, text: r.ok ? null : buf.toString('utf8').slice(0, 300) };
}
