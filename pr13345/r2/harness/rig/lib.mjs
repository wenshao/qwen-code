// Real-stack rig for PR #13345: the PR-head Spring server jar on MariaDB
// 10.11.18, and a TypeScript authority built from one arm (packages/core/dist)
// talking to it through the production HTTP Managed Session store.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SP =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad';
export const ARM = process.env.ARM;
// Round 1: pr = d3b8ddd1 (wt-pr), base = 2c591ecc (wt-base, since moved).
// Round 2: old = d3b8ddd1 (wt-pr), new = 4ae14d62 (wt-base checked out at the new head).
const TREES = { pr: 'wt-pr', base: 'wt-base', old: 'wt-pr', new: 'wt-base' };
if (!(ARM in TREES)) throw new Error('ARM=old|new|pr|base required');
// DIST may point at a patched copy of one arm's dist (the future-slice rig).
export const CORE =
  process.env.DIST ?? `${SP}/${TREES[ARM]}/packages/core/dist/src/managed-runtime`;
export const PORT = Number(process.env.PORT ?? 18345);
export const DB = process.env.DB ?? 'rig13345';
export const TENANT = 't-rig13345';
export const FIXTURES = JSON.parse(
  fs.readFileSync(
    `${SP}/wt-pr/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json`,
    'utf8',
  ),
);

export const { createHttpManagedSessionStores } = await import(
  `${CORE}/http-managed-session-store.js`
);
export const { openManagedSession } = await import(
  `${CORE}/managed-session-assembly.js`
);
export const records = await import(`${CORE}/managed-session-records.js`);

export function enableMonitorRun() {
  // monitor_run ships disabled; enable it in this process only, as the
  // PR's own tests do through their mock.
  if (!records.MANAGED_SESSION_ENABLED_DOMAINS.includes('monitor_run')) {
    records.MANAGED_SESSION_ENABLED_DOMAINS.push('monitor_run');
  }
}

let logFile = null;
export function openLog(name) {
  logFile = path.join(SP, 'rig', 'out', `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
}
export function say(tag, text) {
  const line = `[${tag}] ${typeof text === 'string' ? text : JSON.stringify(text)}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}

export function sql(query) {
  const out = execFileSync(
    'docker',
    [
      '--context', 'colima', 'exec', 'pr13345-mariadb', 'mariadb',
      '-uroot', '-prig13345', '-N', '-B', DB, '-e', query,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}

/** Resource rows the real store holds for one Session, by kind. */
export function resourceCounts(sessionId) {
  const rows = sql(
    `SELECT kind, COUNT(*) FROM qwen_managed_session_resource WHERE tenant_id='${TENANT}' AND session_id='${sessionId}' GROUP BY kind ORDER BY kind`,
  );
  return Object.fromEntries(rows.map(([kind, n]) => [kind, Number(n)]));
}
export function journalTx(sessionId) {
  const [[n]] = sql(
    `SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE tenant_id='${TENANT}' AND session_id='${sessionId}'`,
  );
  return Number(n);
}

export function tokenFor(writerId) {
  return createHash('sha256').update(`rig-token:${writerId}`).digest('base64url');
}

export const { LocalManagedSessionResourceStore } = await import(
  `${CORE}/managed-session-resources.js`
);

/** Resource files the local store holds for one Session, by kind. */
export function localCounts(runtimeBaseDir, sessionId) {
  const root = path.join(runtimeBaseDir, 'resources', sessionId);
  const out = {};
  if (!fs.existsSync(root)) return out;
  for (const kind of fs.readdirSync(root).sort()) {
    out[kind] = fs.readdirSync(path.join(root, kind)).length;
  }
  return out;
}

/**
 * Opens (or creates) a Managed Session through the real HTTP store, or with
 * `local` through the local JSONL journal and local resource files.
 */
export async function openSession({
  sessionId,
  writerId,
  create = false,
  fetchFn,
  local = false,
  runtimeBaseDir = fs.mkdtempSync(path.join(SP, 'rig', 'tmp-')),
}) {
  const sessionKey = { tenantId: TENANT, workspaceId: 'ws-rig', sessionId };
  const stores = local
    ? {
        journalStore: undefined,
        resourceStore: LocalManagedSessionResourceStore.create({
          runtimeBaseDir,
          sessionKey,
        }),
      }
    : createHttpManagedSessionStores({
        baseUrl: `http://127.0.0.1:${PORT}`,
        sessionKey,
        writerId,
        writerToken: tokenFor(writerId),
        ...(fetchFn ? { fetchFn } : {}),
      });
  let createOpt;
  if (create) {
    createOpt = {
      definitionRef: await stores.resourceStore.publish(
        'managed-session-definition',
        Buffer.from('{}', 'utf8'),
      ),
      rootSnapshotRef: await stores.resourceStore.publish(
        'managed-session-root-snapshot',
        Buffer.from('{}', 'utf8'),
      ),
      createdBy: 'rig',
    };
  }
  const session = await openManagedSession({
    runtimeBaseDir,
    sessionId,
    transcriptPath: path.join(runtimeBaseDir, 'session.jsonl'),
    sessionKey,
    cwd: '/workspace',
    version: 'rig',
    workerId: writerId,
    activationLeaseDurationMs: 60_000,
    ...(stores.journalStore ? { journalStore: stores.journalStore } : {}),
    resourceStore: stores.resourceStore,
    ...(createOpt ? { create: createOpt } : {}),
  });
  return { session, stores, sessionKey, runtimeBaseDir };
}

/** Publishes one real resource per placeholder ref and rewrites the value. */
export class RefMapper {
  constructor(resources) {
    this.resources = resources;
    this.map = new Map();
  }
  static isRef(v) {
    return (
      v !== null && typeof v === 'object' && !Array.isArray(v) &&
      typeof v.resourceId === 'string' && typeof v.kind === 'string' &&
      typeof v.digest === 'string' && Object.keys(v).length === 5
    );
  }
  async remap(value) {
    if (Array.isArray(value)) return Promise.all(value.map((v) => this.remap(v)));
    if (value === null || typeof value !== 'object') return value;
    if (RefMapper.isRef(value)) {
      const key = JSON.stringify(value);
      if (!this.map.has(key)) {
        const bytes = Buffer.from(
          JSON.stringify({ rigPlaceholder: value.resourceId, kind: value.kind }),
          'utf8',
        );
        this.map.set(key, this.resources.publish(value.kind, bytes));
      }
      return await this.map.get(key);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await this.remap(v);
    return out;
  }
}

export function command(sessionKey, commandId, value, operation) {
  return {
    operation,
    commandId,
    sessionKey,
    contentDigest: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

export async function attempt(fn) {
  try {
    await fn();
    return 'committed';
  } catch (error) {
    return `${error.name}: ${String(error.message).slice(0, 120)}`;
  }
}
