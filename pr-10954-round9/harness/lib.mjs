// Shared helpers for the PR #10954 round-9 harnesses (Linux x86_64).
// Every run gets its own QWEN_HOME; nothing touches ~/.qwen.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROOT = '/root/verify/pr10954';
export const ARMS = {
  head: `${ROOT}/head`,
  prefix: `${ROOT}/prefix`,
  cand: `${ROOT}/cand`,
  split: `${ROOT}/split`,
};
export const TOKEN = 'r9-token';

export function freshDir(...parts) {
  const dir = path.join(ROOT, 'run', ...parts);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The arm's own store module (tsc dist), so records are written by the real writer. */
export async function storeModule(arm) {
  return import(
    pathToFileURL(
      `${ARMS[arm]}/packages/cli/dist/src/agent-view/supervisor-store.js`,
    ).href
  );
}

/** A long-lived process standing in for a worker, so its pid is really alive. */
export function liveProcess() {
  const child = spawn('sleep', ['3600'], { stdio: 'ignore', detached: true });
  child.unref();
  return child.pid;
}

/**
 * A live process that registers itself in the session registry through
 * core's own `registerSession`, as a real Qwen Code session does.
 * Resolves with { pid, record } once the record is on disk.
 */
export function registryProcess(arm, home, fields) {
  const core = pathToFileURL(
    `${ARMS[arm]}/packages/core/dist/src/services/session-registry.js`,
  ).href;
  const src = `
    const m = await import(${JSON.stringify(core)});
    const r = await m.registerSession(${JSON.stringify(fields)});
    if (${JSON.stringify(fields.ipcPath ?? null)} !== null) {
      await m.patchSessionRecord({ ipcPath: ${JSON.stringify(fields.ipcPath ?? null)} });
    }
    process.stdout.write(JSON.stringify({ pid: process.pid, r }) + '\\n');
    setInterval(() => {}, 1 << 30);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', src], {
    env: { ...process.env, QWEN_HOME: home },
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true,
  });
  child.unref();
  return new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl !== -1) resolve({ pid: child.pid, ...JSON.parse(buf.slice(0, nl)) });
    });
    child.on('exit', (code) => reject(new Error(`registry child exited ${code}`)));
  });
}

export function killAll(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

/** Real `qwen serve` from the arm's bundle, bound to `workspace`. */
export async function startDaemon(arm, home, workspace, extraArgs = []) {
  const child = spawn(
    process.execPath,
    [
      `${ARMS[arm]}/dist/cli.js`,
      'serve',
      '--port',
      '0',
      '--token',
      TOKEN,
      '--workspace',
      workspace,
      ...extraArgs,
    ],
    {
      env: { ...process.env, QWEN_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  let log = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`daemon did not listen:\n${log}`)),
      60_000,
    );
    const onData = (d) => {
      log += d;
      const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`daemon exited ${code}:\n${log}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  // The daemon prints "listening" before its runtime is ready.
  for (let i = 0; i < 200; i++) {
    const r = await fetch(`${base}/capabilities`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (r.status !== 503) break;
    await new Promise((r2) => setTimeout(r2, 100));
  }
  return {
    base,
    pid: child.pid,
    stop: () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    },
  };
}

export async function getAgents(daemon) {
  const r = await fetch(`${daemon.base}/background-agents`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

/** `qwen sessions ps` through the arm's shipped bin. */
export function ps(arm, home, json = false) {
  const r = spawnSync(
    process.execPath,
    [
      `${ARMS[arm]}/scripts/cli-entry.js`,
      'sessions',
      'ps',
      ...(json ? ['--json'] : []),
    ],
    {
      env: { ...process.env, QWEN_HOME: home, NO_COLOR: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function iso(msAgo = 0) {
  return new Date(Date.now() - msAgo).toISOString();
}

/** A managed session written through the arm's real store writers. */
export async function writeManaged(store, globalDir, o) {
  const now = iso();
  const createdAt = o.createdAt ?? iso(60_000);
  await store.writeAgentViewSessionState(
    {
      schemaVersion: 1,
      sessionId: o.id,
      ownership: 'managed',
      sessionState: o.sessionState ?? 'working',
      processState: o.processState ?? 'alive',
      attachState: 'detached',
      projectCwd: o.cwd,
      originalCwd: o.cwd,
      activeCwd: o.cwd,
      createdAt,
      updatedAt: o.updatedAt ?? now,
      worktree: { mode: 'none' },
    },
    { globalDir },
  );
  if (o.name) {
    await store.upsertAgentViewRosterEntry(
      {
        sessionId: o.id,
        projectCwd: o.cwd,
        activeCwd: o.cwd,
        displayName: o.name,
        createdAt,
        updatedAt: now,
      },
      { globalDir },
    );
  }
  if (o.worker !== undefined) {
    await store.writeAgentViewWorker(
      o.id,
      {
        schemaVersion: 1,
        protocolVersion: 1,
        platform: process.platform,
        recentOutputBytes: 0,
        ...o.worker,
      },
      { globalDir },
    );
  }
}

export function out(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}
