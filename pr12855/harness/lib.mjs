// Verification rig for PR #12855 (H0c: Stage H records + task list).
// Real Spring server jar (PR head) on MariaDB 10.11.18 + the PR's built
// TypeScript authority (packages/core/dist) talking to it over HTTP.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SP =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad';
export const RIG = `${SP}/rig`;
export const WT = process.env.WT ?? `${SP}/wt-pr`;
export const CORE = `${WT}/packages/core/dist/src/managed-runtime`;
export const PORT = Number(process.env.PORT ?? 18855);
export const DB = process.env.DB ?? 'h0c';
export const TENANT = process.env.TENANT ?? 't-rig';
export const FIXTURES = JSON.parse(
  fs.readFileSync(
    `${WT}/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json`,
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
export const projection = await import(`${CORE}/managed-extension-projection.js`);
export const extRecord = await import(`${CORE}/managed-extension-record.js`);
export const grantGate = await import(`${CORE}/managed-operation-grant-gate.js`);

// monitor_run stays disabled in the product; enable it only in this process,
// the same way the PR's own driver did.
if (!records.MANAGED_SESSION_ENABLED_DOMAINS.includes('monitor_run')) {
  records.MANAGED_SESSION_ENABLED_DOMAINS.push('monitor_run');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let logFile = null;
export function openLog(name) {
  logFile = path.join(RIG, 'out', `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
}
export function say(tag, text) {
  const line = `[${tag}] ${typeof text === 'string' ? text : JSON.stringify(text)}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}

export function sql(query, db = DB) {
  const out = execFileSync(
    'docker',
    ['exec', 'pr12855-mariadb', 'mariadb', '-uroot', '-prig12855', '-N', '-B', db, '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}

export async function api(method, url, { tenant = TENANT, actor, idem, body, port = PORT } = {}) {
  const headers = { 'content-type': 'application/json', 'X-Qwen-Tenant-Id': tenant };
  if (actor) headers['X-Rig-Actor'] = actor;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json, text };
}

export async function createPublicSession({ tenant = TENANT, actor, port = PORT } = {}) {
  const r = await api('POST', '/v1/agents/sessions', {
    tenant,
    actor,
    port,
    idem: `create-${randomUUID()}`,
    body: { agent_id: 'qwen-code' },
  });
  if (![200, 201, 202].includes(r.status)) throw new Error(`create ${r.status} ${r.text}`);
  return r.json;
}

export function tokenFor(writerId) {
  return createHash('sha256').update(`rig-token:${writerId}`).digest('base64url');
}

/** Opens (or creates) a Managed Session through the real HTTP store. */
export async function openSession({
  sessionId,
  writerId,
  create = false,
  fetchFn,
  workspaceId = 'ws-rig',
  tenant = TENANT,
  port = PORT,
}) {
  const sessionKey = { tenantId: tenant, workspaceId, sessionId };
  const stores = createHttpManagedSessionStores({
    baseUrl: `http://127.0.0.1:${port}`,
    sessionKey,
    writerId,
    writerToken: tokenFor(writerId),
    ...(fetchFn ? { fetchFn } : {}),
  });
  const runtimeBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h0c-rig-'));
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
    journalStore: stores.journalStore,
    resourceStore: stores.resourceStore,
    ...(createOpt ? { create: createOpt } : {}),
  });
  return { session, stores, sessionKey };
}

/**
 * The fixtures use placeholder refs (digest aaa…). Publish one real resource
 * per distinct placeholder in this Session and rewrite every ref, so the
 * nested-resource closure the PR added holds on the real server.
 */
export class RefMapper {
  constructor(resources) {
    this.resources = resources;
    this.map = new Map();
  }
  static isRef(v) {
    return (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof v.resourceId === 'string' &&
      typeof v.kind === 'string' &&
      typeof v.digest === 'string' &&
      Object.keys(v).length === 5
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
        // Cache the promise: concurrent remaps must share one publish.
        this.map.set(key, this.resources.publish(value.kind, bytes));
      }
      return await this.map.get(key);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await this.remap(v);
    return out;
  }
}

export function command(sessionKey, commandId, record) {
  return {
    operation: 'commitMonitorRun',
    commandId,
    sessionKey,
    contentDigest: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
  };
}

export async function commitMonitor(session, sessionKey, commandId, record, input) {
  return session.authority.commitExtensionRecord(
    command(sessionKey, commandId, record),
    { domain: 'monitor_run', record, ...(input ? { input } : {}) },
    { class: 'trusted_entry' },
  );
}

export function javaRows(sessionId, tenant = TENANT) {
  return sql(
    `SELECT record_id, revision, task_state, IFNULL(runtime_state,'null'), IFNULL(definition_revision,'null'), created_at, IFNULL(started_at,'null'), IFNULL(settled_at,'null'), IFNULL(delivery_target,'null'), IFNULL(delivery_state,'null'), record_key FROM qwen_managed_session_extension_record WHERE tenant_id='${tenant}' AND session_id='${sessionId}' ORDER BY record_id`,
  );
}

export function nul(v) {
  return v === 'null' ? null : v;
}

export function tsViewAsRow(record) {
  const t = record.task;
  return [
    record.recordId,
    String(record.revision),
    t.state,
    String(t.runtimeState ?? 'null'),
    String(t.definitionRevision ?? 'null'),
    String(t.createdAt),
    String(t.startedAt ?? 'null'),
    String(t.settledAt ?? 'null'),
    String(record.run.delivery?.target ?? 'null'),
    String(record.run.delivery?.state ?? 'null'),
  ];
}

export function journalCounts(sessionId, tenant = TENANT) {
  const [[tx]] = sql(
    `SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE tenant_id='${tenant}' AND session_id='${sessionId}'`,
  );
  const [[res]] = sql(
    `SELECT COUNT(*) FROM qwen_managed_session_resource WHERE tenant_id='${tenant}' AND session_id='${sessionId}'`,
  );
  const [[rows]] = sql(
    `SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE tenant_id='${tenant}' AND session_id='${sessionId}'`,
  );
  return { tx: Number(tx), resources: Number(res), records: Number(rows) };
}

/** Every public event of a Session, paged by sequence. */
export async function allEvents(sessionId, { tenant = TENANT, actor = 'alice', port = PORT } = {}) {
  const out = [];
  let after = 0;
  for (;;) {
    const r = await api('GET', `/v1/agents/sessions/${sessionId}/events?after=${after}&limit=100`, { tenant, actor, port });
    if (r.status !== 200) throw new Error(`events ${r.status} ${r.text}`);
    out.push(...r.json.data);
    if (r.json.data.length < 100) return out;
    after = r.json.data.at(-1).sequence;
  }
}
