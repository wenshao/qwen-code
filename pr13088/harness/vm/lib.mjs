// PR #13088 (W1a) verification rig helpers. Runs inside the dedicated Linux VM as the service user.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { startFakeOpenAIServer, fakeToolCall } from './fake-openai-server.mjs';

export const RIG = '/rig';
export const TENANT = 't-w1a';
export const API = 'http://127.0.0.1:8088';
export const BROKER_ORIGIN = 'http://127.0.0.1:4188';
export const BROKER_TOKEN = 'rig-w1a-broker-token';
export const HARNESS_TOKEN = 'rig-w1a-harness-token';
export const DIGEST = `sha256:${'a'.repeat(64)}`;
export const FILES = 'hosted-workspace-files/1';
export const SHELL = 'hosted-workspace-shell/1';
export const RUN = '/var/lib/qwen-w1a/hosted-run';
export const MAIN = 'com.alibaba.qwen.code.managedagent.store.WorkspaceStorageRegistrationMain';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function env() {
  return Object.fromEntries(fs.readFileSync('/etc/qwen-w1a.env', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
}
export const DB = () => process.env.DB ?? env().DB;
export const OUT = process.env.OUT ?? `${RIG}/out/e2e`;
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RUN, { recursive: true });

let logFile;
export function openLog(name) { logFile = path.join(OUT, `${name}.log`); fs.writeFileSync(logFile, ''); }
export const say = (...a) => { const line = `${new Date().toISOString().slice(11, 23)} ${a.join(' ')}`; console.log(line); if (logFile) fs.appendFileSync(logFile, line + '\n'); };
export const sh = (c) => execFileSync('bash', ['-c', c], { encoding: 'utf8' }).trim();
export const svc = (...args) => { const r = spawnSync('bash', [`${RIG}/vm/svc.sh`, ...args], { encoding: 'utf8' }); return (r.stdout + r.stderr).trim(); };

// ---- SQL
export function sql(query, { header = false, db = DB() } = {}) {
  const e = env(); const out = execFileSync('docker', ['exec', e.DBCONT || 'w0e3-db', e.DBCONT === 'w0e3-mariadb' ? 'mariadb' : 'mysql', '-uroot', `-p${e.DBPASS || 'rootpw'}`, header ? '-t' : '-N', ...(header ? [] : ['-B']), db, '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  return header ? out : out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}
export const one = (q) => sql(q)[0]?.[0];
export const storageKey = (st) => `SHA2(CONCAT('${TENANT}', CHAR(0), 'st-${st}'), 256)`;
export function mountRow(st) {
  const r = sql(`SELECT mount_state, mount_revision, IFNULL(mount_operation_id,'-'), IFNULL(mount_completed_operation_id,'-'), IFNULL(mount_root,'-'),
    IFNULL(mount_host_id,'-'), IFNULL(mount_device,'-'), IFNULL(mount_inode,'-'), IFNULL(mount_registration_id,'-'), IFNULL(holder_key,'-'), IFNULL(tenant_id,'-'), IFNULL(storage_id,'-')
    FROM managed_workspace_execution_lease WHERE storage_key=${storageKey(st)}`)[0];
  if (!r) return null;
  return { state: r[0], revision: Number(r[1]), operation: r[2], completed: r[3], root: r[4], hostId: r[5], device: r[6], inode: r[7], registrationId: r[8], holder: r[9], tenant: r[10], storage: r[11] };
}
export const mstr = (m) => m ? `row state=${m.state} rev=${m.revision} op=${m.operation === '-' ? '-' : m.operation.slice(0, 8)} completed=${m.completed === '-' ? '-' : m.completed.slice(0, 8)} dev=${m.device} ino=${m.inode} reg=${m.registrationId === '-' ? '-' : m.registrationId.slice(0, 8)} holder=${m.holder === '-' ? '-' : m.holder.slice(0, 10) + '…'}` : 'row <none>';
export function seedWs(workspace, storage, actors = ['alice']) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${workspace}'`) !== '0') return;
  sql(`INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'st-${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`);
  for (const actor of actors) sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}',CAST('${actor}' AS BINARY),TRUE,TRUE)`);
}

// ---- public API
export async function api(method, route, body, { key, actor = 'alice', tenant = TENANT, timeoutMs = 130000 } = {}) {
  const headers = { Accept: 'application/json', 'X-Qwen-Tenant-Id': tenant, 'X-Rig-Actor': actor };
  if (key) headers['Idempotency-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t0 = Date.now();
  try {
    const res = await fetch(API + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, json: { error: String(e?.cause?.code ?? e?.message ?? e) }, ms: Date.now() - t0 }; }
}
export async function createSession(workspace, cwd = 'project', actor = 'alice') {
  const res = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: workspace, cwd_relative: cwd } }, { key: randomUUID(), actor });
  if (res.status >= 300) throw new Error(`create session: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id ?? res.json.session_id ?? res.json.sessionId;
}

// ---- scripted model: the LAST user message chooses the tool calls
export async function startModel() {
  const state = { calls: 0, log: [] };
  const server = await startFakeOpenAIServer(({ body }) => {
    state.calls += 1;
    const messages = body.messages;
    const lastUser = messages.findLastIndex((m) => m.role === 'user');
    const c = messages[lastUser]?.content; const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('\n') : '';
    const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
    const tools = (body.tools ?? []).map((t) => t.function?.name);
    state.log.push({ t: Date.now(), step: receipts.length, tools: tools.length, messages: messages.length, users: messages.filter((x) => x.role === 'user').length, toolResults: messages.filter((x) => x.role === 'tool').length, marker: (text.match(/(WRITE|READ|SHELL|HISTORY|EDIT)\b/g) ?? []).at(-1) ?? 'PLAIN' });
    if (receipts.length) return { content: `DONE after ${receipts.length} tool result(s): ${JSON.stringify(receipts.at(-1).content).slice(0, 160)}` };
    // Core merges adjacent user turns after a failed Turn, so the LAST marker in the text decides.
    const cands = [];
    for (const [kind, re] of [['MULTI64', /MULTI64 ([A-Za-z0-9+\/=]+)\|([A-Za-z0-9+\/=]+)/g], ['SHELL64', /SHELL64 ([A-Za-z0-9+\/=]+)/g], ['WRITE', /WRITE (\S+) (\S+)/g], ['READ', /READ (\S+)/g], ['HISTORY', /HISTORY/g], ['PLAIN', /PLAIN/g]]) {
      const m = [...text.matchAll(re)].at(-1); if (m) cands.push({ kind, m, at: m.index });
    }
    cands.sort((a, b) => b.at - a.at);
    const pick = cands[0];
    if (pick?.kind === 'MULTI64') {
      // Two Shell calls in ONE assistant message: the second is dispatched while the Runtime Session is still held.
      return { content: 'Running two Shell commands.', toolCalls: [1, 2].map((i) => fakeToolCall('run_shell_command', { command: Buffer.from(pick.m[i], 'base64').toString('utf8'), is_background: false, description: `rig command ${i}` })) };
    }
    if (pick?.kind === 'SHELL64') {
      return { content: 'Running a Shell command.', toolCalls: [fakeToolCall('run_shell_command', { command: Buffer.from(pick.m[1], 'base64').toString('utf8'), is_background: false, description: 'rig command' })] };
    }
    if (pick?.kind === 'WRITE') return { content: 'Writing.', toolCalls: [fakeToolCall('write_file', { file_path: pick.m[1], content: pick.m[2] })] };
    if (pick?.kind === 'READ') return { content: 'Reading.', toolCalls: [fakeToolCall('read_file', { file_path: pick.m[1] })] };
    if (pick?.kind === 'HISTORY') {
      // Echo what the model can see of earlier turns: proves private history was restored.
      const seen = messages.filter((x) => x.role === 'tool').length;
      const users = messages.filter((x) => x.role === 'user').length;
      return { content: `HISTORY users=${users} toolResults=${seen} messages=${messages.length}` };
    }
    return { content: 'PLAIN_OK' };
  });
  return { baseUrl: server.baseUrl, state, close: () => server.close() };
}
export const shell64 = (cmd) => `SHELL64 ${Buffer.from(cmd, 'utf8').toString('base64')}`;

// ---- transparent Harness -> Broker proxy (never changes a request or a reply; records a ledger)
export async function startBrokerProxy(brokerOrigin = BROKER_ORIGIN) {
  const ledger = []; const state = { hook: null };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    const entry = { received: Date.now(), method: req.method, url: req.url.replace(/\?.*$/, '').replace('/internal/runtime-broker/v1', ''), status: null };
    ledger.push(entry);
    try {
      await state.hook?.(entry, body);
      const r = await fetch(new URL(req.url, brokerOrigin), { method: req.method,
        headers: { Authorization: req.headers.authorization, 'Content-Type': 'application/json' }, ...(body.length ? { body } : {}), signal: AbortSignal.timeout(130000) });
      const text = await r.text();
      entry.status = r.status; entry.ms = Date.now() - entry.received;
      try { const j = JSON.parse(text); entry.code = j.code; entry.message = j.error; if (j.result?.error?.type) entry.code = `result:${j.result.error.type}`; } catch { /* not json */ }
      res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(text);
    } catch (e) { entry.status = `proxy-error ${e.message}`; res.writeHead(503); res.end(String(e)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, ledger, state, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
export const opName = (u) => u.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id').replace(/^\//, '');
export function ledgerStr(ledger, from = 0) {
  return ledger.slice(from).map((e) => `${opName(e.url)}→${e.status}${e.code ? `(${e.code})` : ''}`).join('  ') || '<no Broker calls>';
}

// ---- packaged Hosted Harness
export class Harness {
  constructor({ name, modelUrl, brokerUrl, dist = env().DIST, port = 0 }) { Object.assign(this, { name, modelUrl, brokerUrl, dist, port }); this.root = path.join(RUN, `harness-${name}`); }
  async start() {
    fs.rmSync(this.root, { recursive: true, force: true });
    const qwenHome = path.join(this.root, '.qwen');
    fs.mkdirSync(qwenHome, { recursive: true });
    fs.writeFileSync(path.join(qwenHome, 'settings.json'), JSON.stringify({
      security: { auth: { selectedType: 'openai' } }, model: { name: 'hosted-fixture' }, telemetry: { enabled: false },
      modelProviders: { openai: [{ id: 'hosted-fixture', envKey: 'OPENAI_API_KEY', baseUrl: this.modelUrl }] } }));
    const args = [`/opt/w1a/${this.dist}/cli.js`, 'serve', '--profile', 'hosted-harness', '--http-bridge', '--no-web', '--hostname', '127.0.0.1',
      '--port', String(this.port), '--token', HARNESS_TOKEN, '--hosted-harness-capability-digest', DIGEST, '--workspace', this.root,
      '--managed-runtime-broker-url', this.brokerUrl, '--managed-runtime-broker-token', BROKER_TOKEN];
    this.logPath = path.join(RUN, `harness-${this.name}.log`);
    const log = fs.openSync(this.logPath, 'w');
    this.child = spawn('/opt/qwen/node', args, { cwd: this.root, stdio: ['ignore', log, log], detached: this.port !== 0, env: {
      PATH: process.env.PATH, HOME: this.root, QWEN_HOME: qwenHome, OPENAI_API_KEY: 'local-fixture-key', OPENAI_BASE_URL: this.modelUrl,
      OPENAI_MODEL: 'hosted-fixture', QWEN_MODEL: 'hosted-fixture', QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(this.root, 'system-settings.json'),
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(this.root, 'system-defaults.json'), QWEN_RUNTIME_DIR: path.join(this.root, 'runtime'),
      QWEN_SANDBOX: 'false', NO_COLOR: '1', TZ: 'UTC' } });
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const output = fs.readFileSync(this.logPath, 'utf8');
      const m = output.match(/qwen serve listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) this.baseUrl = m[1];
      if (this.child.exitCode !== null) throw new Error(`harness exited: ${output}`);
      if (this.baseUrl) {
        const r = await fetch(`${this.baseUrl}/capabilities`, { headers: this.headers() }).catch(() => null);
        if (r && r.ok) { this.bootId = (await r.json()).hostedHarness.bootId; return this; }
      }
      await sleep(200);
    }
    throw new Error(`harness did not start: ${fs.readFileSync(this.logPath, 'utf8')}`);
  }
  headers(clientId) {
    return { Authorization: `Bearer ${HARNESS_TOKEN}`, 'X-Qwen-Harness-Protocol-Version': '1', ...(this.bootId ? { 'X-Qwen-Harness-Boot-Id': this.bootId } : {}),
      ...(clientId ? { 'X-Qwen-Client-Id': clientId } : {}), 'Content-Type': 'application/json' };
  }
  async json(route, body, { clientId, method, timeoutMs = 120000 } = {}) {
    const t0 = Date.now();
    try {
      const r = await fetch(this.baseUrl + route, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: this.headers(clientId),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text(); let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
      return { status: r.status, json, ms: Date.now() - t0 };
    } catch (e) { return { status: 0, json: { code: `client:${e?.name ?? e}` }, ms: Date.now() - t0 }; }
  }
  async stop(signal = 'SIGTERM') {
    if (this.child && this.child.exitCode === null) { this.child.kill(signal); for (let i = 0; i < 80 && this.child.exitCode === null; i++) await sleep(100);
      if (this.child.exitCode === null) this.child.kill('SIGKILL'); }
  }
}

export class HSession {
  constructor(h, sessionId, workspaceId) { Object.assign(this, { sessionId, workspaceId }); this.bind(h); }
  bind(h) { this.h = h; this.connection = { baseUrl: API, tenantId: TENANT, workspaceId: this.workspaceId, writerId: h.bootId, leaseDurationMs: 60000 }; this.clientId = undefined; return this; }
  async create(toolProfile) {
    const r = await this.h.json('/session', { sessionId: this.sessionId, sessionScope: 'thread', managedSessionStore: this.connection, ...(toolProfile ? { toolProfile } : {}) });
    if (r.status === 200) this.clientId = r.json.clientId; return r;
  }
  // Cold load the way the PR's Java SDK probe does it: no tool profile unless one is given.
  async load(toolProfile, opts) {
    const r = await this.h.json(`/session/${this.sessionId}/load`, { managedSessionStore: this.connection, ...(toolProfile ? { toolProfile } : {}) }, opts);
    if (r.status === 200) this.clientId = r.json.clientId; return r;
  }
  async detach() { return this.h.json(`/session/${this.sessionId}/detach`, {}, { clientId: this.clientId }); }
  async title(title) { return this.h.json(`/session/${this.sessionId}/title`, { title }, { clientId: this.clientId }); }
  async status() { return (await this.h.json(`/session/${this.sessionId}/status`, undefined, { clientId: this.clientId })).json; }
  async submit(text) {
    const blocks = [{ type: 'text', text }]; const promptId = randomUUID();
    const r = await this.h.json(`/session/${this.sessionId}/prompt`, { promptId, prompt: blocks,
      payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(blocks)).digest('hex')}` }, { clientId: this.clientId });
    return { promptId, ...r };
  }
  async transcript() {
    const events = []; let cursor = '0';
    for (;;) { const page = (await this.h.json(`/session/${this.sessionId}/transcript?cursor=${cursor}&limit=256`, undefined, { clientId: this.clientId })).json;
      if (!page?.events) break; events.push(...page.events); if (!page.hasMore) break; cursor = page.nextCursor; }
    return events;
  }
  async prompt(text, ms = 180000) {
    const sub = await this.submit(text);
    if (sub.status !== 202) return { ...sub, terminal: null };
    const t0 = Date.now(); let st;
    while (Date.now() - t0 < ms) { st = await this.status(); if (st && !st.hasActivePrompt) break; await sleep(100); }
    const events = (await this.transcript()).filter((e) => e.promptId === sub.promptId);
    return { ...sub, ms: Date.now() - t0, status2: st, events, terminal: events.filter((e) => e.type.startsWith('turn_')) };
  }
}
export function toolTrace(events) {
  const out = [];
  for (const e of events ?? []) for (const p of e.data?.record?.message?.parts ?? []) {
    if (p.functionCall) out.push(`call ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 80)})`);
    if (p.functionResponse) { const resp = p.functionResponse.response ?? {}; out.push(`result ${p.functionResponse.name}: ${JSON.stringify(resp).slice(0, 200)}`); }
  }
  return out;
}
export function turnStr(r) {
  const term = r.terminal?.map((t) => `${t.type}${t.data?.stopReason ? `(${t.data.stopReason})` : ''}${t.type === 'turn_error' ? ` ${JSON.stringify(t.data).slice(0, 200)}` : ''}`).join(',') || '<none>';
  const text = (r.events ?? []).flatMap((e) => [...(e.data?.record?.message?.parts ?? []).filter((p) => p.text && e.data.record.type !== 'user').map((p) => p.text), ...(e.type === 'session_update' && e.data?.update?.content?.text ? [e.data.update.content.text] : [])]).join('').slice(0, 200);
  return `admit=${r.status}${r.status !== 202 ? ` ${JSON.stringify(r.json).slice(0, 200)}` : ''} terminal=${term} recoveryBlocked=${r.status2?.recoveryBlocked} ${r.ms ?? '?'} ms${text ? ` text="${text}"` : ''}`;
}

export async function startRig(tag, { dist } = {}) {
  const model = await startModel();
  const proxy = await startBrokerProxy();
  const h = await new Harness({ name: tag, modelUrl: model.baseUrl, brokerUrl: proxy.url, ...(dist ? { dist } : {}) }).start();
  return { model, proxy, h,
    async restartHarness(tag2 = `${tag}-r`) { await this.h.stop(); this.h = await new Harness({ name: tag2, modelUrl: model.baseUrl, brokerUrl: proxy.url, ...(dist ? { dist } : {}) }).start(); return this.h; },
    async stop() { await this.h.stop(); await proxy.close(); await model.close(); } };
}

// ---- the operator's maintenance entry, run from the shipped fat jar (no Maven, no source tree)
export function maint(args, { jar = process.env.MAINT_JAR ?? '/opt/w1a/head-server.jar', extraEnv = {}, db = DB() } = {}) {
  const cfg = env(); const e = { PATH: '/usr/local/bin:/usr/bin:/bin', W1_JDBC_URL: `jdbc:mysql://127.0.0.1:${cfg.DBPORT || 3306}/${db}?allowPublicKeyRetrieval=true&useSSL=false`,
    W1_JDBC_USER: 'root', W1_JDBC_PASSWORD: cfg.DBPASS || 'rootpw', ...extraEnv };
  for (const [k, v] of Object.entries(e)) if (v === null) delete e[k];
  const t0 = Date.now();
  const r = spawnSync('/opt/qwen/jdk/bin/java', ['-cp', jar, `-Dloader.main=${MAIN}`, 'org.springframework.boot.loader.launch.PropertiesLauncher', ...args],
    { env: e, encoding: 'utf8', timeout: 120000, cwd: '/tmp' });
  const lines = r.stdout.split('\n').filter((l) => l.trim());
  const cause = [...`${r.stdout}\n${r.stderr}`.matchAll(/(?:Exception|Error): ([^\n]+)/g)].map((m) => m[1]);
  return { code: r.status, ms: Date.now() - t0, out: lines.at(-1) ?? '', cause: cause.at(-1) ?? '', stdout: r.stdout, stderr: r.stderr };
}
export function sayMaint(label, r) {
  say(`  maint ${label}: exit=${r.code} ${r.ms} ms -> ${r.code === 0 ? r.out : `REFUSED: ${r.cause || r.stderr.trim().split('\n').at(-1)}`}`);
  fs.writeFileSync(path.join(OUT, `maint-${label.replace(/[^a-z0-9-]+/gi, '_')}.txt`), `${r.stdout}\n----stderr----\n${r.stderr}`);
  return r;
}
export const root = (st) => `${env().ROOTBASE ?? '/srv/w1a'}/${st}`;
export const inspect = (st) => maint(['inspect', TENANT, `st-${st}`, root(st)]);
export function statRoot(st) { try { const s = fs.statSync(root(st), { bigint: true }); return `dev=${s.dev} ino=${s.ino}`; } catch (e) { return `stat failed: ${e.code}`; } }
export function workerPids() {
  return sh("for p in $(pgrep -x node || true); do tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -q 'managed-runtime-worker' && echo $p; done || true").split('\n').filter(Boolean).map(Number);
}
export function hostFacts() {
  const read = (p) => fs.readFileSync(p, 'utf8').trim();
  return `machine_id=${read('/etc/machine-id')} boot_id=${read('/proc/sys/kernel/random/boot_id')} uptime=${Math.round(Number(read('/proc/uptime').split(' ')[0]))}s kernel=${read('/proc/sys/kernel/osrelease')}`;
}

export const seen = (rig) => { const e = rig.model.state.log.at(-1); return e ? `model saw ${e.messages} messages (${e.users} user, ${e.toolResults} tool results)` : 'model not called'; };

export const multi64 = (a, b) => `MULTI64 ${Buffer.from(a, 'utf8').toString('base64')}|${Buffer.from(b, 'utf8').toString('base64')}`;
