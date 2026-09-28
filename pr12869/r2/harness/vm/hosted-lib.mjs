// Hosted Harness side of the rig (runs inside the VM): the packaged harness, a scripted model, a Broker proxy.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as d from './drive.mjs';

export const HARNESS_TOKEN = 'rig-harness-token-12869';
export const DIGEST = `sha256:${'a'.repeat(64)}`;
export const PROFILE = 'hosted-workspace-files/1';
export const RUN = '/var/lib/qwen-rt/hosted-run';
const sleep = d.sleep;

export class Harness {
  constructor({ name, modelUrl, brokerUrl }) { Object.assign(this, { name, modelUrl, brokerUrl }); this.root = path.join(RUN, `harness-${name}`); }
  async start() {
    fs.rmSync(this.root, { recursive: true, force: true });
    const qwenHome = path.join(this.root, '.qwen');
    fs.mkdirSync(qwenHome, { recursive: true });
    fs.writeFileSync(path.join(qwenHome, 'settings.json'), JSON.stringify({
      security: { auth: { selectedType: 'openai' } }, model: { name: 'hosted-fixture' }, telemetry: { enabled: false },
      modelProviders: { openai: [{ id: 'hosted-fixture', envKey: 'OPENAI_API_KEY', baseUrl: this.modelUrl }] } }));
    const args = ['/opt/qwen/dist/cli.js', 'serve', '--profile', 'hosted-harness', '--http-bridge', '--no-web', '--hostname', '127.0.0.1',
      '--port', '0', '--token', HARNESS_TOKEN, '--hosted-harness-capability-digest', DIGEST, '--workspace', this.root,
      '--managed-runtime-broker-url', this.brokerUrl, '--managed-runtime-broker-token', d.TOKEN];
    this.logPath = path.join(RUN, `harness-${this.name}.log`);
    const log = fs.openSync(this.logPath, 'w');
    this.child = spawn('/opt/qwen/node', args, { cwd: this.root, stdio: ['ignore', log, log], env: {
      PATH: process.env.PATH, HOME: this.root, QWEN_HOME: qwenHome, OPENAI_API_KEY: 'local-fixture-key', OPENAI_BASE_URL: this.modelUrl,
      OPENAI_MODEL: 'hosted-fixture', QWEN_MODEL: 'hosted-fixture', QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(this.root, 'system-settings.json'),
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(this.root, 'system-defaults.json'), QWEN_RUNTIME_DIR: path.join(this.root, 'runtime'),
      QWEN_SANDBOX: 'false', NO_COLOR: '1' } });
    const end = Date.now() + 60000;
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
  async json(route, body, { clientId, method } = {}) {
    const r = await fetch(this.baseUrl + route, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: this.headers(clientId),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
    const text = await r.text(); let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { status: r.status, json };
  }
  async stop() {
    if (this.child && this.child.exitCode === null) { this.child.kill('SIGTERM'); for (let i = 0; i < 50 && this.child.exitCode === null; i++) await sleep(100);
      if (this.child.exitCode === null) this.child.kill('SIGKILL'); }
  }
}

export class HSession {
  constructor(h, sessionId, workspaceId) { Object.assign(this, { h, sessionId });
    this.connection = { baseUrl: d.API, tenantId: d.TENANT, workspaceId, writerId: h.bootId, leaseDurationMs: 60000 }; }
  async create() {
    const r = await this.h.json('/session', { sessionId: this.sessionId, sessionScope: 'thread', managedSessionStore: this.connection, toolProfile: PROFILE });
    if (r.status === 200) this.clientId = r.json.clientId; return r;
  }
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
      events.push(...page.events); if (!page.hasMore) break; cursor = page.nextCursor; }
    return events;
  }
  async prompt(text, ms = 120000) {
    const sub = await this.submit(text);
    if (sub.status !== 202) return { ...sub, terminal: null };
    const t0 = Date.now(); let st;
    while (Date.now() - t0 < ms) { st = await this.status(); if (st && !st.hasActivePrompt) break; await sleep(100); }
    const events = (await this.transcript()).filter((e) => e.promptId === sub.promptId);
    return { ...sub, ms: Date.now() - t0, status2: st, events, terminal: events.filter((e) => e.type.startsWith('turn_')) };
  }
}

export const summarize = (r) => `admit=${r.status}${r.status !== 202 ? ` ${JSON.stringify(r.json).slice(0, 160)}` : ''} terminal=${r.terminal?.map((t) => `${t.type}${t.data?.stopReason ? `(${t.data.stopReason})` : ''}`).join(',') || '<none>'} recoveryBlocked=${r.status2?.recoveryBlocked} ${r.ms ?? '?'} ms`;

export function toolTrace(events) {
  const out = [];
  for (const e of events ?? []) for (const p of e.data?.record?.message?.parts ?? []) {
    if (p.functionCall) out.push(`call ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 90)})`);
    if (p.functionResponse) { const resp = p.functionResponse.response ?? {}; out.push(`result ${p.functionResponse.name} status=${resp.executionStatus} ${JSON.stringify(resp.output ?? resp.error ?? '').slice(0, 100)}`); }
  }
  return out;
}

// Transparent Harness -> Broker proxy. It never changes a request or a reply; a hook may only delay forwarding.
export async function startBrokerProxy(brokerOrigin) {
  const ledger = []; const state = { hook: null };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    const entry = { received: Date.now(), method: req.method, url: req.url.replace(/\?.*$/, '').replace('/internal/runtime-broker/v1', ''), status: null };
    ledger.push(entry);
    try {
      await state.hook?.(entry, body);
      entry.forwarded = Date.now();
      const r = await fetch(new URL(req.url, brokerOrigin), { method: req.method,
        headers: { Authorization: req.headers.authorization, 'Content-Type': 'application/json' }, ...(body.length ? { body } : {}), signal: AbortSignal.timeout(130000) });
      const text = await r.text();
      entry.status = r.status; entry.answered = Date.now();
      try { const j = JSON.parse(text); entry.code = j.code; entry.message = j.error; } catch { /* not json */ }
      res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(text);
    } catch (e) { entry.status = `proxy-error ${e.message}`; res.writeHead(503); res.end(String(e)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, ledger, state, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
