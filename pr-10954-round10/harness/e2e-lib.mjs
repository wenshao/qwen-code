// End-to-end helpers: real `--bg`, real supervisor, the shipped bin.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ARMS } from './lib.mjs';

/**
 * A scratch QWEN_HOME whose settings point at a real model provider
 * (qwen3.8-max through the user's OpenAI-compatible provider entry).
 * The key is copied file-to-file and never printed.
 */
export function writeModelHome(home) {
  const user = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), '.qwen', 'settings.json'), 'utf8'),
  );
  const provider = user.modelProviders.openai.find((p) => p.id === 'qwen3.8-max');
  const key = user.env[provider.envKey];
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify(
      {
        security: {
          auth: { selectedType: 'openai', apiKey: key, baseUrl: provider.baseUrl },
        },
        model: { name: 'qwen3.8-max', baseUrl: provider.baseUrl },
        modelProviders: { openai: [provider] },
        env: { [provider.envKey]: key },
        ui: { hideTips: true },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

/** Run the shipped bin (`scripts/cli-entry.js`) to completion. */
export function bin(arm, home, cwd, args, timeout = 120_000) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [`${ARMS[arm]}/scripts/cli-entry.js`, ...args], {
    cwd,
    env: { ...process.env, QWEN_HOME: home, NO_COLOR: '1', QWEN_CODE_SUPPRESS_YOLO_WARNING: '1' },
    encoding: 'utf8',
    timeout,
  });
  return {
    code: r.status,
    signal: r.signal,
    ms: Date.now() - t0,
    stdout: r.stdout,
    stderr: stripNoise(r.stderr),
  };
}

/** Start the shipped bin without waiting; resolves with the same shape on exit. */
export function binAsync(arm, home, cwd, args) {
  const t0 = Date.now();
  const child = spawn(process.execPath, [`${ARMS[arm]}/scripts/cli-entry.js`, ...args], {
    cwd,
    env: { ...process.env, QWEN_HOME: home, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const done = new Promise((resolve) =>
    child.on('exit', (code, signal) =>
      resolve({ code, signal, ms: Date.now() - t0, stdout, stderr: stripNoise(stderr) }),
    ),
  );
  return { child, done };
}

export function stripNoise(s) {
  return (s ?? '')
    .split('\n')
    .filter((l) => !/ExperimentalWarning|DeprecationWarning|--trace-warnings|--trace-deprecation/.test(l))
    .join('\n')
    .trim();
}

/** Processes whose environment carries this QWEN_HOME (supervisor, host, worker). */
export function processesFor(home) {
  const found = [];
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
      if (!env.split('\0').includes(`QWEN_HOME=${home}`)) continue;
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      found.push({ pid: Number(pid), cmd });
    } catch {}
  }
  return found;
}

export function killFor(home) {
  const ps = processesFor(home);
  for (const p of ps) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {}
  }
  return ps.length;
}

export function jobIds(home) {
  try {
    return fs.readdirSync(path.join(home, 'jobs'));
  } catch {
    return [];
  }
}

export function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

export async function waitFor(fn, ms, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return undefined;
}
