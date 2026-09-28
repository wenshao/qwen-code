// Real-daemon rig for PR #12923: spawn `qwen serve` from a worktree's dist/cli.js
// with isolated HOME/QWEN_HOME, drive it over the public HTTP API.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const SP =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/64df5bb9-2331-4255-b253-6b11e72da2dc/scratchpad';
export const TOKEN = 'pr12923-token';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function cleanEnv(extra = {}) {
  const keep = ['PATH', 'LANG', 'TMPDIR', 'USER', 'SHELL', 'TERM'];
  const env = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return { ...env, ...extra };
}

export function prepareHome({ root, ws, fakePort, trust = 'TRUST_FOLDER', userApprovalMode = 'default' }) {
  const home = path.join(root, 'home');
  const qwenHome = path.join(home, '.qwen');
  fs.mkdirSync(qwenHome, { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  const settings = {
    security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: true } },
    model: { name: 'fake-model' },
    general: { disableAutoUpdate: true },
    ...(userApprovalMode ? { tools: { approvalMode: userApprovalMode } } : {}),
    modelProviders: {
      openai: [
        { id: 'fake-model', name: 'Fake', baseUrl: `http://127.0.0.1:${fakePort}/v1`, envKey: 'OPENAI_API_KEY', generationConfig: { modalities: { image: true } } },
      ],
    },
  };
  fs.writeFileSync(path.join(qwenHome, 'settings.json'), JSON.stringify(settings, null, 2));
  setTrust(qwenHome, ws, trust);
  return { home, qwenHome };
}

export function setTrust(qwenHome, ws, level) {
  const real = fs.realpathSync(ws);
  fs.writeFileSync(
    path.join(qwenHome, 'trustedFolders.json'),
    JSON.stringify({ [real]: level, ...(real !== ws ? { [ws]: level } : {}) }, null, 2),
  );
}

export class Daemon {
  constructor({ wt, home, qwenHome, ws, fakePort, logFile, extraEnv = {}, port0 }) {
    Object.assign(this, { wt, home, qwenHome, ws, fakePort, logFile, extraEnv, port0 });
  }
  async start() {
    const env = cleanEnv({
      HOME: this.home,
      QWEN_HOME: this.qwenHome,
      OPENAI_API_KEY: 'fake-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${this.fakePort}/v1`,
      OPENAI_MODEL: 'fake-model',
      QWEN_SANDBOX: 'false',
      NO_PROXY: '*',
      ...this.extraEnv,
    });
    const log = fs.openSync(this.logFile, 'a');
    fs.writeSync(log, `\n==== start ${new Date().toISOString()} env+=${JSON.stringify(this.extraEnv)}\n`);
    this.proc = spawn(
      process.execPath,
      [path.join(this.wt, 'dist/cli.js'), 'serve', '--port', String(this.port0 ?? 0), '--token', TOKEN, '--hostname', '127.0.0.1',
        '--workspace', this.ws, '--initialize-timeout-ms', '60000', ...(this.extraArgs ?? [])],
      { cwd: this.ws, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.proc.stderr.on('data', (c) => fs.writeSync(log, c));
    this.port = await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('daemon boot timeout')), 60000);
      this.proc.stdout.on('data', (c) => {
        fs.writeSync(log, c);
        buf += c.toString();
        const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (m) {
          clearTimeout(t);
          resolve(Number(m[1]));
        }
      });
      this.proc.once('exit', (code) => {
        clearTimeout(t);
        reject(new Error(`daemon exited ${code}`));
      });
    });
    this.base = `http://127.0.0.1:${this.port}`;
    this.pid = this.proc.pid;
    return this;
  }
  async stop() {
    if (!this.proc || this.proc.exitCode !== null) return;
    const exited = new Promise((r) => this.proc.once('exit', r));
    this.proc.kill('SIGTERM');
    const t = setTimeout(() => this.proc.kill('SIGKILL'), 15000);
    await exited;
    clearTimeout(t);
  }
  async req(method, p, body, clientId) {
    const headers = { Authorization: `Bearer ${TOKEN}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (clientId) headers['X-Qwen-Client-Id'] = clientId;
    const res = await fetch(this.base + p, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  async createSession(extra = {}) {
    const r = await this.req('POST', '/session', { cwd: this.ws, sessionScope: 'thread', ...extra });
    if (r.status >= 300) throw new Error(`create ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  }
  async setMode(sid, mode, opts = {}, clientId) {
    return this.req('POST', `/session/${sid}/approval-mode`, { mode, ...opts }, clientId);
  }
  async load(sid, extra = {}) {
    return this.req('POST', `/session/${sid}/load`, { cwd: this.ws, ...extra });
  }
  async detach(sid, clientId) {
    return this.req('POST', `/session/${sid}/detach`, undefined, clientId);
  }
  async status(sid) {
    return this.req('GET', `/session/${sid}/status`);
  }
  async waitClosed(sid, timeoutMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await this.status(sid);
      if (s.status === 404) return Date.now() - t0;
      await sleep(250);
    }
    throw new Error(`session ${sid} did not close`);
  }
  // SSE collector; returns { events, close, waitFor(pred, ms) }
  subscribe(sid, clientId) {
    const events = [];
    const ac = new AbortController();
    const waiters = [];
    const headers = { Authorization: `Bearer ${TOKEN}`, Accept: 'text/event-stream' };
    if (clientId) headers['X-Qwen-Client-Id'] = clientId;
    const ready = (async () => {
      const res = await fetch(`${this.base}/session/${sid}/events`, { headers, signal: ac.signal });
      if (!res.ok) throw new Error(`events ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = frame
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trim())
                .join('\n');
              if (!data) continue;
              let ev;
              try {
                ev = JSON.parse(data);
              } catch {
                continue;
              }
              events.push(ev);
              for (const w of [...waiters]) {
                if (w.pred(ev)) {
                  waiters.splice(waiters.indexOf(w), 1);
                  w.resolve(ev);
                }
              }
            }
          }
        } catch {}
      })();
    })();
    return {
      events,
      ready,
      close: () => ac.abort(),
      waitFor: (pred, ms = 30000) => {
        const hit = events.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve) => {
          const w = { pred, resolve };
          waiters.push(w);
          setTimeout(() => {
            const k = waiters.indexOf(w);
            if (k >= 0) {
              waiters.splice(k, 1);
              resolve(null);
            }
          }, ms);
        });
      },
    };
  }
  async prompt(sid, text, clientId) {
    return this.req('POST', `/session/${sid}/prompt`, { prompt: [{ type: 'text', text }] }, clientId);
  }
}

export function modeOf(loadJson) {
  const st = loadJson?.state ?? {};
  return {
    currentModeId: st.modes?.currentModeId,
    planExecutionMode: st.modes?._meta?.planExecutionMode,
    configOption: (st.configOptions || []).find((o) => o.id === 'mode')?.currentValue,
    attached: loadJson?.attached,
  };
}

export function findJsonl(qwenHome, sid) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === `${sid}.jsonl`) out.push(p);
    }
  };
  walk(qwenHome);
  return out[0];
}

export function approvalRecords(file) {
  if (!file || !fs.existsSync(file)) return null;
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.subtype === 'session_approval_mode')
    .map((r) => r.systemPayload);
}
