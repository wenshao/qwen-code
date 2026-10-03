// Verification rig for PR #13265 (H3 child_run record body).
// Real Spring server jar on MariaDB 10.11.18 + the built TypeScript
// authority (packages/core/dist) talking to it over the HTTP session store.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SP =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
export const RIG = `${SP}/rig`;
export const WT = process.env.WT ?? `${SP}/wt-pr`;
export const CORE = `${WT}/packages/core/dist/src/managed-runtime`;
export const PORT = Number(process.env.PORT ?? 18265);
export const DB = process.env.DB ?? 'h3_head';
export const TENANT = process.env.TENANT ?? 't-rig';

export const { createHttpManagedSessionStores } = await import(`${CORE}/http-managed-session-store.js`);
export const { openManagedSession } = await import(`${CORE}/managed-session-assembly.js`);
export const records = await import(`${CORE}/managed-session-records.js`);
export const projection = await import(`${CORE}/managed-extension-projection.js`);

/**
 * child_run stays disabled in the product. ENABLE_CHILD_RUN=1 enables it in
 * this process only, the way the PR's own authority test does with vi.mock.
 */
export const ENABLED = process.env.ENABLE_CHILD_RUN === '1';
if (ENABLED && !records.MANAGED_SESSION_ENABLED_DOMAINS.includes('child_run')) {
  records.MANAGED_SESSION_ENABLED_DOMAINS.push('child_run');
}

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
    ['--context', 'colima', 'exec', 'pr13265-mariadb', 'mariadb', '-uroot', '-prig13265', '-N', '-B', db, '-e', query],
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

export async function createPublicSession({ tenant = TENANT, actor = 'alice', port = PORT } = {}) {
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

/** Records every HTTP exchange of the session store client. */
export function recordingFetch(log) {
  return async (url, init) => {
    const res = await fetch(url, init);
    log.push({ method: init?.method ?? 'GET', path: new URL(url).pathname.replace(/^.*\/sessions\/[^/]+/, ''), status: res.status });
    return res;
  };
}

/** Opens (or creates) a Managed Session through the real HTTP store. */
export async function openSession({ sessionId, writerId, create = false, fetchFn, workspaceId = 'ws-rig', tenant = TENANT, port = PORT }) {
  const sessionKey = { tenantId: tenant, workspaceId, sessionId };
  const stores = createHttpManagedSessionStores({
    baseUrl: `http://127.0.0.1:${port}`,
    sessionKey,
    writerId,
    writerToken: tokenFor(writerId),
    ...(fetchFn ? { fetchFn } : {}),
  });
  const runtimeBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-rig-'));
  let createOpt;
  if (create) {
    createOpt = {
      definitionRef: await stores.resourceStore.publish('managed-session-definition', Buffer.from('{}', 'utf8')),
      rootSnapshotRef: await stores.resourceStore.publish('managed-session-root-snapshot', Buffer.from('{}', 'utf8')),
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

export function command(sessionKey, commandId, record, operation = 'commitChildRun') {
  return {
    operation,
    commandId,
    sessionKey,
    contentDigest: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
  };
}

export async function commitChild(session, sessionKey, commandId, record) {
  return session.authority.commitExtensionRecord(
    command(sessionKey, commandId, record),
    { domain: 'child_run', record },
    { class: 'trusted_entry' },
  );
}

/** Publishes a real Session resource and returns its durable ref. */
export async function publish(session, kind, value) {
  return session.resources.publish(kind, Buffer.from(JSON.stringify(value), 'utf8'));
}

export function javaRows(sessionId, tenant = TENANT, db = DB) {
  return sql(
    `SELECT record_id, domain, revision, task_kind, task_state, IFNULL(runtime_state,'null'), created_at, IFNULL(started_at,'null'), IFNULL(settled_at,'null') FROM qwen_managed_session_extension_record WHERE tenant_id='${tenant}' AND session_id='${sessionId}' ORDER BY record_id`,
    db,
  );
}

export function journalCounts(sessionId, tenant = TENANT, db = DB) {
  const one = (q) => Number(sql(q, db)[0][0]);
  return {
    tx: one(`SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE tenant_id='${tenant}' AND session_id='${sessionId}'`),
    resources: one(`SELECT COUNT(*) FROM qwen_managed_session_resource WHERE tenant_id='${tenant}' AND session_id='${sessionId}'`),
    records: one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE tenant_id='${tenant}' AND session_id='${sessionId}'`),
  };
}

export function tsView(session, recordId) {
  const r = session.authority.extensionRecord('child_run', recordId);
  return r ? { revision: r.revision, kind: r.task.kind, state: r.task.state, runtimeState: r.task.runtimeState } : null;
}

/** A child_run body from the PR's fixture template with the given changes. */
export function child(patch = {}) {
  const base = {
    kind: 'shell',
    shellId: 'shell-1',
    ownerScopeId: 'scope-1',
    commandRef: null,
    startReceiptRef: null,
    outputRef: null,
    stopReason: null,
    exitCode: null,
    exitSignal: null,
    run: {
      state: 'admitted',
      reason: null,
      definition: null,
      executionCallId: 'call-1',
      effectId: null,
      dispatchId: null,
      deliveryId: null,
      execution: 'intent',
      runtime: null,
      delivery: null,
    },
  };
  return { ...base, ...patch, run: { ...base.run, ...(patch.run ?? {}) } };
}

export const BINDING_1 = { runtimeBindingId: 'binding-1', generation: '1' };
export const BINDING_2 = { runtimeBindingId: 'binding-2', generation: '2' };
