// Hosted Harness helpers for the PR #12868 rig (raw Hosted Workspace loop).
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RIG, WT, BROKER_TOKEN, TENANT, HTTP_PORT, sleep } from './lib.mjs';

export const NODE22 = `${process.env.HOME}/.local/share/fnm/node-versions/v22.23.2/installation/bin/node`;
export const HARNESS_TOKEN = 'rig-harness-token-12868';
export const DIGEST = `sha256:${'a'.repeat(64)}`;
export const PROFILE = 'hosted-workspace-files/1';

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
          modelProviders: { openai: [{ id: provider.id, envKey: provider.envKey, baseUrl: provider.baseUrl }] },
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
      path.join(WT, 'dist', 'cli.js'),
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
      signal: AbortSignal.timeout(30_000),
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
  async create(extra = { toolProfile: PROFILE }) {
    const r = await this.h.json('/session', {
      sessionId: this.sessionId,
      sessionScope: 'thread',
      managedSessionStore: this.connection,
      ...extra,
    });
    if (r.status === 200) this.clientId = r.json.clientId;
    return r;
  }
  async load(extra = { toolProfile: PROFILE }) {
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

