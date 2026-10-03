// Shared helpers for the PR 13214 rig drivers.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const RIG = '/Users/wenshao/pr13214-rig';
export const JAVA = '/Users/wenshao/Install/jdk21/bin/java';
export const MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql';
export const WT = { head: '/Users/wenshao/git/pr13214-head', base: '/Users/wenshao/git/pr13214-base', cand: '/Users/wenshao/git/pr13214-cand' };
export const SECRET = Buffer.from('rig-secret-key-0123456789abcdef!').toString('base64');
export const TOKEN = 'rig-token-13214';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function sql(db, query) {
  return execFileSync(MYSQL, ['-h127.0.0.1', '-P33214', '-uroot', '-N', '-B', ...(db ? [db] : []), '-e', query], {
    encoding: 'utf8',
  }).trim();
}

export function scope(ws, workspaceId = 'workspace-a') {
  return {
    tenantId: 'tenant-a',
    workspaceId,
    workspaceGeneration: '1',
    canonicalCwd: ws,
    capabilityDigest: 'sha256:' + 'a'.repeat(64),
    isolationClass: 'workspace',
  };
}

export function jdbc(db, port = 33214) {
  return `jdbc:mysql://127.0.0.1:${port}/${db}?allowPublicKeyRetrieval=true&useSSL=false&connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true`;
}

/** Starts a Java main from the rig classpath of an arm; resolves when it prints {"ready":true}. */
export async function startJava(arm, main, config, name, extraEnv = {}) {
  const dir = path.join(RIG, 'run', name);
  fs.mkdirSync(dir, { recursive: true });
  const cfgFile = path.join(dir, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2));
  const cp = `${RIG}/classes-${arm}:` + fs.readFileSync(`${RIG}/cp-${arm}.txt`, 'utf8').trim();
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const err = fs.openSync(path.join(dir, 'stderr.log'), 'w');
  const child = spawn(JAVA, ['-Duser.timezone=UTC', '-cp', cp, `com.alibaba.qwen.code.runtimebroker.${main}`, cfgFile], {
    stdio: ['pipe', 'pipe', err],
    env: { ...process.env, HOME: home, TZ: 'UTC', ...extraEnv },
  });
  const lines = readline.createInterface({ input: child.stdout });
  const queue = [];
  let waiter = null;
  lines.on('line', (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(line);
    } else queue.push(line);
  });
  const next = (ms = 120000) =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      const t = setTimeout(() => reject(new Error(`${name}: no output in ${ms} ms`)), ms);
      waiter = (l) => {
        clearTimeout(t);
        resolve(l);
      };
    });
  const ready = JSON.parse(await next());
  if (!ready.ready) throw new Error(`${name} not ready`);
  return {
    child,
    ready,
    dir,
    async command(obj) {
      child.stdin.write(JSON.stringify(obj) + '\n');
      return JSON.parse(await next());
    },
  };
}

export function broker(baseUrl) {
  const prefix = baseUrl.replace(/\/$/, '') + '/internal/runtime-broker/v1';
  let n = 0;
  return async function call(method, route, body) {
    const started = performance.now();
    const res = await fetch(prefix + route, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify({ protocolVersion: 1, requestId: `r-${Date.now()}-${n++}`, ...body }),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json, ms: performance.now() - started };
  };
}

export async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

export function shellReference(sessionId, callId, command) {
  const payload = { toolName: 'run_shell_command', input: { command, is_background: false } };
  const payloadJson = JSON.stringify(payload);
  return { payloadJson };
}
