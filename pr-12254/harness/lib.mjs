// Shared helpers for the PR #12254 real-daemon verification harness.
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  utimesSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export const TOKEN = 'pr12254-verify-token';
export const ARMS = {
  head: '/root/verify/pr12254-head',
  base: '/root/verify/pr12254-base',
  merged: '/root/verify/pr12254-merged',
};

export const sanitizeCwd = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');
export const workspaceIdOf = (cwd) =>
  createHash('sha256').update(cwd).digest('hex').slice(0, 16);

/** Deterministic UUID-shaped id. `tag` must be hex. */
export function sid(ws, n) {
  const w = { A: 'a', B: 'b', C: 'c', D: 'd' }[ws] ?? 'e';
  const hex = n.toString(16).padStart(12, '0');
  return `${w.repeat(8)}-0000-4000-8000-${hex}`;
}

function record(sessionId, cwd, uuid, parentUuid, type, text, iso, extra = {}) {
  return {
    uuid,
    parentUuid,
    sessionId,
    timestamp: iso,
    type,
    cwd,
    version: '1.0.0',
    ...(type === 'system'
      ? extra
      : { message: { role: type === 'assistant' ? 'model' : 'user', parts: [{ text }] } }),
  };
}

/**
 * Write one persisted session transcript. `minute` orders activity: larger is
 * more recent. File mtime is pinned to the last record timestamp.
 */
export function writeSession(home, cwd, sessionId, opts) {
  const { minute, title, archived = false, source, padBytes = 0 } = opts;
  const chats = path.join(
    home,
    '.qwen',
    'projects',
    sanitizeCwd(cwd),
    'chats',
    ...(archived ? ['archive'] : []),
  );
  mkdirSync(chats, { recursive: true });
  const t0 = Date.UTC(2026, 8, 1, 0, minute, 0);
  const iso = (ms) => new Date(ms).toISOString();
  const recs = [];
  let parent = null;
  if (source) {
    const u = `s-${sessionId}`;
    recs.push(
      record(sessionId, cwd, u, parent, 'system', '', iso(t0), {
        subtype: 'session_source',
        systemPayload: source,
      }),
    );
    parent = u;
  }
  const u1 = `u-${sessionId}`;
  recs.push(
    record(sessionId, cwd, u1, parent, 'user', title + 'x'.repeat(padBytes), iso(t0 + 1000)),
  );
  const a1 = `a-${sessionId}`;
  recs.push(
    record(sessionId, cwd, a1, u1, 'assistant', `reply to ${title}`, iso(t0 + 2000)),
  );
  const file = path.join(chats, `${sessionId}.jsonl`);
  writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const mt = new Date(t0 + 2000);
  utimesSync(file, mt, mt);
  return file;
}

export function freshDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function daemonEnv(home, extra = {}) {
  const drop = new Set([
    'QWEN_SERVE_PROMPT_DEADLINE_MS',
    'QWEN_SERVE_WRITER_IDLE_TIMEOUT_MS',
    'QWEN_SERVE_RATE_LIMIT',
    'QWEN_SERVE_NO_MCP_POOL',
    'QWEN_SERVE_NO_PERSISTENT_REGISTRATION',
    'QWEN_SERVE_CLIENT_MCP_OVER_WS',
    'QWEN_SERVE_CDP_TUNNEL_OVER_WS',
  ]);
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !drop.has(k))),
    HOME: home,
    QWEN_HOME: path.join(home, '.qwen'),
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
    OPENAI_MODEL: 'fake-model',
    QWEN_MODEL: 'fake-model',
    ...extra,
  };
}

export async function startDaemon(arm, home, workspaces, { env = {}, args = [] } = {}) {
  const cli = path.join(ARMS[arm], 'dist', 'cli.js');
  if (!existsSync(cli)) throw new Error(`missing bundle: ${cli}`);
  const argv = [cli, 'serve', '--port', '0', '--token', TOKEN, '--hostname', '127.0.0.1'];
  for (const w of workspaces) argv.push('--workspace', w);
  argv.push(...args);
  const child = spawn(process.execPath, argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: daemonEnv(home, env),
    cwd: workspaces[0],
  });
  let out = '';
  let err = '';
  child.stderr.on('data', (c) => (err += c));
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`boot timeout\n${out}\n${err}`)), 40_000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`daemon exited ${code}\n${out}\n${err}`));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const d = {
    arm,
    child,
    port,
    base,
    logs: () => ({ out, err }),
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((r) => {
        const t = setTimeout(() => {
          child.kill('SIGKILL');
          r();
        }, 8000);
        child.once('exit', () => {
          clearTimeout(t);
          r();
        });
      });
    },
  };
  // The daemon prints "listening" before the runtime is ready.
  for (let i = 0; i < 200; i++) {
    const r = await http(d, 'GET', '/capabilities');
    if (r.status !== 503) break;
    await sleep(100);
  }
  return d;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function http(d, method, p, body, { token = TOKEN, signal, headers = {} } = {}) {
  const t0 = performance.now();
  const res = await fetch(d.base + p, {
    method,
    signal,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, ms: performance.now() - t0, bytes: text.length };
}

/** Direct children (and grandchildren) of a pid, from /proc. */
export function descendants(pid) {
  const all = [];
  for (const e of readdirSync('/proc')) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const stat = readFileSync(`/proc/${e}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const cmd = readFileSync(`/proc/${e}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      let cwd = '';
      try {
        cwd = readlinkSync(`/proc/${e}/cwd`);
      } catch {
        /* gone */
      }
      all.push({ pid: Number(e), ppid, cmd, cwd });
    } catch {
      /* raced */
    }
  }
  const out = [];
  const walk = (p) => {
    for (const x of all) if (x.ppid === p) (out.push(x), walk(x.pid));
  };
  walk(pid);
  return out;
}

// ---- reporting -----------------------------------------------------------
const C = { g: '\x1b[1;32m', r: '\x1b[1;31m', y: '\x1b[1;33m', c: '\x1b[1;36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
export class Report {
  constructor(title) {
    this.title = title;
    this.rows = [];
    this.lines = [];
    this.section(title);
  }
  section(name) {
    this.cur = name;
    this.lines.push(`\n${C.c}━━ ${name} ━━${C.x}`);
    console.log(`\n${C.c}━━ ${name} ━━${C.x}`);
  }
  check(id, desc, ok, detail = '') {
    this.rows.push({ section: this.cur, id, desc, ok: !!ok, detail });
    const mark = ok ? `${C.g}PASS${C.x}` : `${C.r}FAIL${C.x}`;
    const line = `  ${mark} ${C.b}${id}${C.x} ${desc}${detail ? `  ${C.d}${detail}${C.x}` : ''}`;
    this.lines.push(line);
    console.log(line);
    return !!ok;
  }
  note(text) {
    const line = `  ${C.y}NOTE${C.x} ${text}`;
    this.lines.push(line);
    console.log(line);
  }
  info(text) {
    const line = `  ${C.d}${text}${C.x}`;
    this.lines.push(line);
    console.log(line);
  }
  summary() {
    const pass = this.rows.filter((r) => r.ok).length;
    const fail = this.rows.length - pass;
    const line = `\n${fail === 0 ? C.g : C.r}${pass}/${this.rows.length} checks passed${fail ? `, ${fail} FAILED` : ''}${C.x}`;
    this.lines.push(line);
    console.log(line);
    return { pass, fail, total: this.rows.length };
  }
  save(file) {
    writeFileSync(file + '.ansi', this.lines.join('\n') + '\n');
    writeFileSync(file + '.json', JSON.stringify(this.rows, null, 2));
  }
}

export const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
