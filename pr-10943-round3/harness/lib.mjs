// Shared helpers for the PR #10943 round-3 harnesses (Linux, real builds).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import path from 'node:path';

export const ROOT = '/root/verify/pr10943';
export const NODE = process.execPath;

export function armDir(arm) {
  if (!['head', 'base', 'headmut'].includes(arm)) throw new Error(`bad arm ${arm}`);
  return path.join(ROOT, arm);
}

export function fakeBaseUrl() {
  return readFileSync(path.join(ROOT, 'fake-port'), 'utf8').trim();
}

/** A fresh, isolated scenario: its own HOME, QWEN_HOME, runtime dir and cwd. */
export function scenario(arm, tag, opts = {}) {
  const base = path.join(ROOT, 'r', `${arm}-${tag}`);
  rmSync(base, { recursive: true, force: true });
  const home = path.join(base, 'h');
  const qhome = path.join(base, 'q');
  const runtime = path.join(base, 'rt');
  const cwd = path.join(base, 'w');
  for (const d of [home, qhome, runtime, cwd]) mkdirSync(d, { recursive: true });
  const settings = {
    security: { auth: { selectedType: 'openai' } },
    model: { name: 'fake-model' },
    tools: { approvalMode: 'yolo' },
    general: { enableAutoUpdate: false },
    privacy: { usageStatisticsEnabled: false },
    ...(opts.settings ?? {}),
  };
  writeFileSync(path.join(qhome, 'settings.json'), JSON.stringify(settings, null, 2));
  const env = {
    PATH: `${path.dirname(NODE)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: home,
    QWEN_HOME: qhome,
    QWEN_RUNTIME_DIR: runtime,
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
    QWEN_SANDBOX: 'false',
    OPENAI_API_KEY: 'sk-fake-default',
    OPENAI_BASE_URL: opts.noModel ? 'http://127.0.0.1:9/v1' : fakeBaseUrl(),
    OPENAI_MODEL: 'fake-model',
    ...(opts.env ?? {}),
  };
  return { arm, tag, base, home, qhome, runtime, cwd, env, entry: path.join(armDir(arm), 'scripts', 'cli-entry.js') };
}

/** Run the shipped bin synchronously with a scrubbed environment. */
export function qwen(sc, argv, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(NODE, [sc.entry, ...argv], {
    cwd: opts.cwd ?? sc.cwd,
    env: { ...sc.env, ...(opts.env ?? {}) },
    encoding: 'utf8',
    timeout: opts.timeout ?? 60_000,
    input: opts.input ?? '',
    stdio: opts.stdio,
  });
  return {
    code: r.status,
    signal: r.signal,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    ms: Date.now() - t0,
    error: r.error ? String(r.error) : undefined,
  };
}

/** Every live pid whose environment carries this scenario's QWEN_HOME. */
export function scenarioPids(sc) {
  const out = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    if (Number(d) === process.pid) continue;
    try {
      const env = readFileSync(`/proc/${d}/environ`, 'latin1');
      if (env.split('\0').includes(`QWEN_HOME=${sc.qhome}`)) {
        const cmd = readFileSync(`/proc/${d}/cmdline`, 'latin1').split('\0').filter(Boolean);
        const stat = readFileSync(`/proc/${d}/stat`, 'latin1');
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
        out.push({ pid: Number(d), ppid, cmd });
      }
    } catch {
      /* raced exit or not ours */
    }
  }
  return out;
}

export function role(p) {
  if (p.cmd.includes('--internal-agent-view-supervisor')) return 'supervisor';
  if (p.cmd.includes('--internal-agent-view-pty-host')) return 'pty-host';
  if (p.cmd.includes('--session-id')) return 'worker';
  return 'other';
}

export function killScenario(sc) {
  for (const p of scenarioPids(sc)) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 20_000, interval = 200 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) return undefined;
    await sleep(interval);
  }
}

export function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

export function jobsDir(sc) {
  return path.join(sc.qhome, 'jobs');
}

export function sessionFiles(sc, sid) {
  const d = path.join(jobsDir(sc), sid);
  return {
    dir: d,
    state: readJson(path.join(d, 'state.json')),
    launch: readJson(path.join(d, 'launch.json')),
    worker: readJson(path.join(d, 'worker.json')),
  };
}

export function ledgerSince(n) {
  const p = path.join(ROOT, 'ledger.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).slice(n).map((l) => JSON.parse(l));
}
export function ledgerLen() {
  const p = path.join(ROOT, 'ledger.jsonl');
  if (!existsSync(p)) return 0;
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).length;
}

/** A supervisor client built from the arm's own compiled modules. */
export async function supervisorClient(sc) {
  const mod = await import(
    path.join(armDir(sc.arm), 'packages/cli/dist/src/agent-view/supervisor-runner.js')
  );
  return mod.connectExistingAgentViewSupervisor({ globalDir: sc.qhome });
}

export class Checks {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  check(id, ok, detail = '') {
    this.rows.push({ id, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` — ${detail}` : ''}`);
    return !!ok;
  }
  save(extra = {}) {
    mkdirSync(path.join(ROOT, 'results'), { recursive: true });
    const pass = this.rows.filter((r) => r.ok).length;
    const out = { ...extra, name: this.name, pass, fail: this.rows.length - pass, checks: this.rows };
    writeFileSync(path.join(ROOT, 'results', `${this.name}.json`), JSON.stringify(out, null, 2));
    console.log(`== ${this.name}: ${pass}/${this.rows.length} pass`);
    return out;
  }
}

export function transcript(file, line) {
  appendFileSync(path.join(ROOT, 'transcripts', file), line + '\n');
}

export { spawn, execFileSync, path, readFileSync, writeFileSync, existsSync, mkdirSync };

/** ANSI transcript for the screenshots: commands as a user types them. */
export class Transcript {
  constructor(name) {
    this.file = path.join(ROOT, 'transcripts', `${name}.ansi`);
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, '');
  }
  w(s) {
    appendFileSync(this.file, s);
  }
  title(s) {
    this.w(`\x1b[1;35m# ${s}\x1b[0m\n`);
  }
  cmd(s, who = '$') {
    this.w(`\x1b[1;32m${who}\x1b[0m \x1b[1m${s}\x1b[0m\n`);
  }
  out(s) {
    if (!s) return;
    this.w(s.endsWith('\n') ? s : s + '\n');
  }
  err(s) {
    if (!s) return;
    const t = s.endsWith('\n') ? s.slice(0, -1) : s;
    this.w(`\x1b[31m${t}\x1b[0m\n`);
  }
  note(s) {
    this.w(`\x1b[36m${s}\x1b[0m\n`);
  }
  ok(s) {
    this.w(`\x1b[1;32m✔ ${s}\x1b[0m\n`);
  }
  bad(s) {
    this.w(`\x1b[1;31m✘ ${s}\x1b[0m\n`);
  }
  exit(code, ms) {
    this.w(`\x1b[2m[exit ${code}${ms !== undefined ? `, ${(ms / 1000).toFixed(2)} s` : ''}]\x1b[0m\n`);
  }
  blank() {
    this.w('\n');
  }
}
