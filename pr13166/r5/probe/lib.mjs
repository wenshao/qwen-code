// VERIFICATION RIG ONLY (PR #13166 Hosted Workspace glob profile).
// Real MySQL 8.4.7 + Spring server jar (Session Store + embedded Runtime Broker
// + local-process workers) + packaged Hosted Harness (dist/<arm>/cli.js),
// driven directly on the Harness /session route with an explicit toolProfile.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const RIG = '/Users/wenshao/pr13166-rig';
const env = Object.fromEntries(
  fs
    .readFileSync(`${RIG}/rig.env`, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
export const E = env;
export const DB = process.env.DB ?? 'g1';
export const RUN = `${RIG}/run/${DB}`;
export const ROOTS = `${RUN}/roots`;
export const SPRING = `http://127.0.0.1:${env.SPRING_PORT}`;
export const BROKER = `http://127.0.0.1:${env.BROKER_PORT}`;
export const TENANT = env.TENANT;
export const HARNESS_TOKEN = 'rig-13166-harness-token';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ARM = process.env.ARM ?? 'head';

let logFile = null;
export function openLog(name) {
  logFile = path.join(RIG, 'out', DB, `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, `# ${name} db=${DB} arm=${ARM} ${new Date().toISOString()}\n`);
  return logFile;
}
export function say(tag, text) {
  const line = `[${tag}] ${typeof text === 'string' ? text : JSON.stringify(text)}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}
let pass = 0;
let fail = 0;
export function check(label, ok, detail = '') {
  ok ? pass++ : fail++;
  say(ok ? 'PASS' : 'FAIL', `${label}${detail ? '  -> ' + detail : ''}`);
  return ok;
}
export function done(name) {
  say('RESULT', `${name}: ${pass} passed, ${fail} failed`);
  return fail;
}

export function sql(query, db = DB) {
  const out = execFileSync(
    env.MYSQL,
    ['-uroot', `-p${env.DBPASS}`, '-h127.0.0.1', `-P${env.DBPORT}`, '-N', '-B', db, '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 },
  );
  return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}
export const one = (q) => sql(q)[0]?.[0];

export function holders() {
  return sql('SELECT storage_key, IFNULL(runtime_session_id,"<none>") FROM managed_workspace_execution_lease ORDER BY storage_key');
}

export function seedRegistry(workspace, storage, actors = ['alice']) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${workspace}'`) !== '0') return;
  sql(
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`,
  );
  for (const actor of actors)
    sql(
      `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}',CAST('${actor}' AS BINARY),TRUE,TRUE)`,
    );
}

export async function api(method, url, { actor = 'alice', idem, body } = {}) {
  const headers = { 'content-type': 'application/json', 'X-Qwen-Tenant-Id': TENANT };
  if (actor) headers['X-Rig-Actor'] = actor;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(SPRING + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

export async function createWorkspaceSession(workspace, cwd) {
  const res = await api('POST', '/v1/agents/sessions', {
    idem: randomUUID(),
    body: { agent_id: 'qwen-code', workspace: { workspace_id: workspace, cwd_relative: cwd } },
  });
  if (res.status >= 300) throw new Error(`create session: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id ?? res.json.session_id ?? res.json.sessionId;
}

// ---------------------------------------------------------------------------
// Scripted OpenAI-compatible model. Scripts are chosen by the LAST [[S:name]]
// marker in the last user message that carries one; a script receives
// { round, results, tools, messages } and returns { calls: [[name,args],...] }
// or { text }. Every request is kept in `requests` (tool names + tool results).
export async function startModel(scripts) {
  const requests = [];
  const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c ?? ''));
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const messages = body.messages ?? [];
      let lastUser = -1;
      messages.forEach((m, i) => {
        if (m.role === 'user' && /\[\[S:[\w-]+\]\]/.test(text(m.content))) lastUser = i;
      });
      const userText = lastUser >= 0 ? text(messages[lastUser].content) : '';
      const name = [...userText.matchAll(/\[\[S:([\w-]+)\]\]/g)].at(-1)?.[1] ?? 'plain';
      const after = lastUser >= 0 ? messages.slice(lastUser + 1) : [];
      const results = after.filter((m) => m.role === 'tool').map((m) => text(m.content));
      const round = after.filter((m) => m.role === 'assistant').length;
      const tools = (body.tools ?? []).map((t) => t.function?.name);
      const entry = { t: Date.now(), script: name, round, tools, results, messages };
      requests.push(entry);
      const script = scripts[name] ?? (() => ({ text: 'PLAIN_OK' }));
      let out;
      try {
        out = await script({ round, results, tools, messages, entry });
      } catch (e) {
        out = { text: `SCRIPT_ERROR ${e.message}` };
      }
      const chunk = (d, f) =>
        JSON.stringify({ id: 'rig', object: 'chat.completion.chunk', created: 0, model: 'rig-model', choices: [{ index: 0, delta: d, finish_reason: f }] });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (out.calls) {
        const delta = {
          role: 'assistant',
          content: '',
          tool_calls: out.calls.map(([fn, args], index) => ({
            index,
            id: `rig-${name}-${round}-${index}`,
            type: 'function',
            function: { name: fn, arguments: JSON.stringify(args) },
          })),
        };
        res.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, 'tool_calls')}\n\ndata: [DONE]\n\n`);
      } else {
        res.end(`data: ${chunk({ role: 'assistant', content: out.text }, null)}\n\ndata: ${chunk({}, 'stop')}\n\ndata: [DONE]\n\n`);
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

// ---------------------------------------------------------------------------
// Hosted Harness process (packaged bundle of one arm).
export class Harness {
  constructor({ name, modelUrl, brokerUrl, realModel = false, arm = ARM }) {
    Object.assign(this, { name, modelUrl, brokerUrl, realModel, arm });
    this.root = path.join(RUN, `harness-${name}`);
  }
  async start() {
    fs.rmSync(this.root, { recursive: true, force: true });
    const qwenHome = path.join(this.root, '.qwen');
    fs.mkdirSync(qwenHome, { recursive: true });
    const envv = { PATH: `${path.dirname(env.NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: process.env.TMPDIR, TZ: 'UTC' };
    if (this.realModel) {
      // Real provider: private QWEN_HOME with one provider entry; the key is read
      // from the maintainer's settings env block at launch and never written here.
      const real = JSON.parse(fs.readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
      const provider = real.modelProviders.openai.find((p) => p.id === this.realModel);
      fs.writeFileSync(
        path.join(qwenHome, 'settings.json'),
        JSON.stringify({
          security: { auth: { selectedType: 'openai' } },
          model: { name: this.realModel },
          telemetry: { enabled: false },
          modelProviders: { openai: [{ id: provider.id, envKey: provider.envKey, baseUrl: provider.baseUrl }] },
        }),
      );
      envv[provider.envKey] = real.env[provider.envKey];
    } else {
      fs.writeFileSync(
        path.join(qwenHome, 'settings.json'),
        JSON.stringify({
          security: { auth: { selectedType: 'openai' } },
          model: { name: 'rig-model' },
          telemetry: { enabled: false },
          modelProviders: { openai: [{ id: 'rig-model', envKey: 'OPENAI_API_KEY', baseUrl: this.modelUrl }] },
        }),
      );
      Object.assign(envv, { OPENAI_API_KEY: 'local-fixture-key', OPENAI_BASE_URL: this.modelUrl, OPENAI_MODEL: 'rig-model' });
    }
    const args = [
      path.join(RIG, 'dist', this.arm, 'cli.js'),
      'serve', '--profile', 'hosted-harness', '--http-bridge', '--no-web', '--require-auth',
      '--hostname', '127.0.0.1', '--port', '0',
      '--hosted-harness-capability-digest', env.DIGEST, '--workspace', this.root,
    ];
    if (this.brokerUrl) args.push('--managed-runtime-broker-url', this.brokerUrl, '--managed-runtime-broker-token', env.BTOKEN);
    this.logPath = path.join(RUN, `harness-${this.name}.log`);
    const log = fs.openSync(this.logPath, 'w');
    this.child = spawn(env.NODE, args, {
      cwd: this.root,
      stdio: ['ignore', log, log],
      env: {
        ...envv,
        QWEN_SERVER_TOKEN: HARNESS_TOKEN,
        HOME: this.root,
        USERPROFILE: this.root,
        QWEN_HOME: qwenHome,
        QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(this.root, 'system-settings.json'),
        QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(this.root, 'system-defaults.json'),
        QWEN_CODE_TRUSTED_FOLDERS_PATH: path.join(this.root, 'trusted.json'),
        QWEN_RUNTIME_DIR: path.join(this.root, 'runtime'),
        QWEN_SANDBOX: 'false',
        NO_COLOR: '1',
      },
    });
    fs.writeFileSync(path.join(RUN, `harness-${this.name}.pid`), String(this.child.pid));
    const end = Date.now() + 90_000;
    while (Date.now() < end) {
      const out = fs.readFileSync(this.logPath, 'utf8');
      const m = out.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) this.baseUrl = m[1];
      if (this.child.exitCode !== null) throw new Error(`harness exited: ${out}`);
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
    const t = await r.text();
    let json;
    try {
      json = t ? JSON.parse(t) : undefined;
    } catch {
      json = t;
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

export function storeConnection(h, workspaceId) {
  return { baseUrl: SPRING, tenantId: TENANT, workspaceId, writerId: h.bootId, leaseDurationMs: 60_000 };
}

export class HSession {
  constructor(h, sessionId, connection) {
    Object.assign(this, { h, sessionId, connection });
  }
  async create(extra) {
    const r = await this.h.json('/session', {
      sessionId: this.sessionId,
      sessionScope: 'thread',
      managedSessionStore: this.connection,
      approvalMode: 'yolo',
      ...extra,
    });
    if (r.status === 200) this.clientId = r.json.clientId;
    return r;
  }
  async load(extra = {}) {
    const r = await this.h.json(`/session/${this.sessionId}/load`, { managedSessionStore: this.connection, ...extra });
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
      { promptId, prompt: blocks, payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(blocks)).digest('hex')}` },
      { clientId: this.clientId },
    );
    return { promptId, ...r };
  }
  async waitIdle(ms = 240_000) {
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
    if (sub.status !== 202) return { ...sub, terminal: null, events: [] };
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

export function toolTrace(events, width = 160) {
  const out = [];
  for (const e of events) {
    const parts = e.data?.record?.message?.parts ?? [];
    for (const p of parts) {
      if (p.functionCall) out.push(`call ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, width)})`);
      if (p.functionResponse) {
        const resp = p.functionResponse.response ?? {};
        out.push(`result ${p.functionResponse.name} status=${resp.executionStatus ?? '-'} ${JSON.stringify(resp.output ?? resp.error ?? resp).slice(0, width)}`);
      }
    }
  }
  return out;
}
export function toolResponses(events) {
  const out = [];
  for (const e of events)
    for (const p of e.data?.record?.message?.parts ?? []) if (p.functionResponse) out.push(p.functionResponse);
  return out;
}
export function assistantText(events) {
  return events
    .filter((e) => e.type === 'session_update')
    .map((e) => e.data?.update?.content?.text ?? '')
    .join('');
}

// ---------------------------------------------------------------------------
// Harness -> Broker proxy with a request ledger.
export async function startBrokerProxy(brokerUrl = BROKER) {
  const ledger = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    const entry = { t: Date.now(), method: req.method, url: req.url.replace(/\?.*$/, ''), status: null, reqBody: body.toString('utf8').slice(0, 4000) };
    ledger.push(entry);
    try {
      const r = await fetch(new URL(req.url, brokerUrl), {
        method: req.method,
        headers: { Authorization: `Bearer ${env.BTOKEN}`, 'Content-Type': 'application/json' },
        ...(body.length ? { body } : {}),
        signal: AbortSignal.timeout(120_000),
      });
      const t = await r.text();
      entry.status = r.status;
      entry.resBody = t.slice(0, 200_000);
      try {
        entry.code = JSON.parse(t).code;
      } catch {}
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(t);
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
  return ledger.filter((e) => e.t >= t0).map((e) => `${e.method} ${e.url.replace('/internal/runtime-broker/v1', '')} -> ${e.status}${e.code ? ` ${e.code}` : ''}`);
}

// Every text-ish column of every table in the schema that contains `needle`.
export function dbScan(needle) {
  const cols = sql(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='${DB}' AND data_type IN ('varchar','text','mediumtext','longtext','json','blob','mediumblob','longblob','varbinary','char')`,
  );
  const hits = [];
  const n = needle.replace(/'/g, "''");
  for (const [t, c, dt] of cols) {
    const expr = /blob|binary/.test(dt) ? `CONVERT(\`${c}\` USING utf8mb4)` : `CAST(\`${c}\` AS CHAR)`;
    const k = one(`SELECT COUNT(*) FROM \`${t}\` WHERE INSTR(${expr}, '${n}') > 0`);
    if (k !== '0') hits.push(`${t}.${c}=${k}`);
  }
  return hits;
}
