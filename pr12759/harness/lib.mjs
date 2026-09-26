// Real-process rig for PR 12732: spawns `node <repo>/dist/cli.js managed-runtime-worker`,
// writes the boot document on stdin, reads the ready line, and talks HTTP to it.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PR_REPO = process.env.PR_REPO ?? '/Users/wenshao/git/qwen-code-pr12747';
export const BASE_REPO = process.env.BASE_REPO ?? '/Users/wenshao/git/qwen-code-pr12747-base';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(PR_REPO, 'packages/cli/src/serve/contracts/managed-context-v1.fixtures.json'),
    'utf8',
  ),
);
export const BOOT_V2 = fixtures.boot;
export const BOOT_V1 = {
  type: 'boot',
  version: 1,
  token: BOOT_V2.token,
  leaseId: BOOT_V2.leaseId,
  epoch: BOOT_V2.epoch,
  runtimeInstanceId: BOOT_V2.runtimeInstanceId,
  runtimeIncarnation: BOOT_V2.runtimeIncarnation,
  provisionRequestId: BOOT_V2.provisionRequestId,
  tenantId: BOOT_V2.tenantId,
  workspaceId: BOOT_V2.workspaceId,
  workspaceGeneration: BOOT_V2.workspaceGeneration,
  workspaceCwd: '/tmp',
  capabilityDigest: BOOT_V2.capabilityDigest,
  isolationClass: 'workspace',
};

let digestFn;
export async function digest(binding) {
  if (!digestFn) {
    const mod = await import(
      path.join(PR_REPO, 'packages/cli/dist/src/serve/managed-workspace-binding.js')
    );
    digestFn = mod.computeManagedContextDigest;
  }
  return digestFn(binding);
}

export function headers(boot = BOOT_V2) {
  return {
    authorization: `Bearer ${boot.token}`,
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'x-qwen-managed-lease-id': boot.leaseId,
    'x-qwen-managed-lease-epoch': String(boot.epoch),
  };
}

export const ROUTES = {
  ATTEST_V2: '/internal/managed-runtime/v2/attest',
  ATTEST_V3: '/internal/managed-runtime/v3/attest',
  CONTEXT: '/internal/managed-runtime/v3/context',
  EXECUTE: '/internal/managed-runtime/v2/execute',
  STATUS: '/internal/managed-runtime/v2/status',
  CANCEL: '/internal/managed-runtime/v2/cancel',
};

export async function startWorker(boot, { repo = PR_REPO, entry, cwd, env = {}, raw, nodeArgs = [] } = {}) {
  const child = spawn(process.execPath, [...nodeArgs, entry ?? path.join(repo, 'dist/cli.js'), 'managed-runtime-worker'], {
    cwd: cwd ?? repo,
    env: { ...process.env, NO_COLOR: '1', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.stderr.on('data', (c) => (stderr += c));
  child.stdin.end(raw ?? JSON.stringify(boot));
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), 60_000);
    const check = () => {
      const nl = stdout.indexOf('\n');
      if (nl >= 0) {
        clearTimeout(timer);
        resolve({ kind: 'ready', ready: JSON.parse(stdout.slice(0, nl)) });
      }
    };
    child.stdout.on('data', check);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ kind: 'exit', code, signal });
    });
  });
  return {
    child,
    ...outcome,
    url: outcome.ready?.url,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise((r) => {
          const t = setTimeout(() => {
            child.kill('SIGKILL');
            r();
          }, 5000);
          child.on('exit', () => {
            clearTimeout(t);
            r();
          });
        });
      }
    },
  };
}

export async function post(url, route, body, boot = BOOT_V2, extraHeaders = {}) {
  const res = await fetch(`${url}${route}`, {
    method: 'POST',
    headers: { ...headers(boot), ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, cacheControl: res.headers.get('cache-control') };
}

export async function installation(sessionId, cwdRelative, { boot = BOOT_V2, operationId, contextRevision = '1' } = {}) {
  const binding = {
    tenantId: boot.tenantId,
    workspaceId: boot.workspaceId,
    workspaceGeneration: boot.workspaceGeneration,
    storageId: boot.storageId,
    cwdRelative,
    contextConfigRef: 'config:bundle-3@r12',
    contextRevision,
  };
  return {
    protocolVersion: 3,
    managedContext: 'managed-context/1',
    operationId: operationId ?? `op-${sessionId}`,
    sessionId,
    binding,
    contextDigest: await digest(binding),
  };
}

export function call(sessionId, callId, toolName, input) {
  return {
    protocolVersion: 2,
    reference: { sessionId, promptId: 'prompt-1', callId, argsDigest: `digest-${callId}` },
    toolName,
    input,
  };
}

export function ref(sessionId, callId) {
  return { protocolVersion: 2, reference: { sessionId, promptId: 'prompt-1', callId, argsDigest: `digest-${callId}` } };
}

/** Shorten a tool result for logs. */
export function brief(r) {
  if (r.status !== 200) return `${r.status} ${r.json?.code ?? r.text}`;
  const j = r.json;
  const res = j?.result ?? j;
  const text = JSON.stringify(res);
  return `200 ${text.length > 220 ? text.slice(0, 220) + '…' : text}`;
}

export function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}
