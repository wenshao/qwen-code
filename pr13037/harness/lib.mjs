// VERIFICATION RIG ONLY (PR #13037): helpers for probes against the local stack:
// MySQL 8.4 + Spring server jar (public API, Session Store, embedded Runtime
// Broker, O2 publication, O3 projection) + packaged Hosted Harness + OSS double.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const R = path.dirname(new URL(import.meta.url).pathname);
export const S = path.dirname(R);
export const BASE = process.env.BASE ?? 'http://127.0.0.1:18037';
export const TENANT = process.env.TENANT ?? 't-o3';
export const DB = process.env.DB ?? 'o3c';
export const MODEL_LOG = `${R}/run/model-requests.jsonl`;
export const TAP_LOG = `${R}/run/tap.jsonl`;
export const OSS_ADMIN = 'http://127.0.0.1:18937';
export const NODE22 = '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node';
const MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (b) => createHash('sha256').update(b).digest('hex');
export const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

let logFile = null;
export function openLog(name) {
  logFile = `${R}/out/${name}.log`;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
}
export function say(tag, value) {
  const line = `[${tag}] ${typeof value === 'string' ? value : JSON.stringify(value)}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}

export function headers({ actor = 'alice', tenant = TENANT, key, json = false, extra = {} } = {}) {
  const h = { ...extra };
  if (tenant) h['X-Qwen-Tenant-Id'] = tenant;
  if (actor) h['X-Rig-Actor'] = actor;
  if (key) h['Idempotency-Key'] = key;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export async function api(method, url, body, opts = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: headers({ ...opts, json: body !== undefined, extra: { Accept: 'application/json', ...(opts.extra ?? {}) } }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, headers: res.headers };
}

// Raw byte read of an artifact representation. Returns status, selected headers, body Buffer.
export async function content(session, artifact, { revision, range, ifMatch, ifRange, actor = 'alice', tenant = TENANT, signal } = {}) {
  const extra = {};
  if (range) extra.Range = range;
  if (ifMatch) extra['If-Match'] = ifMatch;
  if (ifRange) extra['If-Range'] = ifRange;
  const q = revision === undefined ? '' : `?revision=${encodeURIComponent(revision)}`;
  const res = await fetch(`${BASE}/v1/agents/sessions/${session}/artifacts/${artifact}/content${q}`, { headers: headers({ actor, tenant, extra }), signal });
  const body = Buffer.from(await res.arrayBuffer());
  const pick = {};
  for (const n of ['content-type', 'content-length', 'content-range', 'etag', 'accept-ranges', 'cache-control', 'content-disposition', 'repr-digest', 'x-content-type-options', 'retry-after', 'content-encoding']) {
    if (res.headers.has(n)) pick[n] = res.headers.get(n);
  }
  let code;
  if (res.status >= 400) {
    try {
      code = JSON.parse(body.toString('utf8')).error?.code;
    } catch {
      code = undefined;
    }
  }
  return { status: res.status, headers: pick, body, code };
}

export function sql(query, db = DB) {
  const r = spawnSync(MYSQL, ['-h127.0.0.1', '-P23037', '-uroot', '-prig13037', '-N', '-B', db, '-e', query], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return r.stdout
    .split('\n')
    .filter((l) => l.length)
    .map((l) => l.split('\t'));
}
export const one = (q, db) => sql(q, db)[0]?.[0];

export function register(workspace, storage, { actors = ['alice'], canCreate = true } = {}) {
  sql(
    `INSERT IGNORE INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`,
  );
  for (const a of actors) grant(workspace, a, { canCreate });
}
export function grant(workspace, actor, { canRead = true, canCreate = true } = {}) {
  sql(
    `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}','${actor}',${canRead ? 'TRUE' : 'FALSE'},${canCreate ? 'TRUE' : 'FALSE'}) ON DUPLICATE KEY UPDATE can_read=VALUES(can_read), can_create=VALUES(can_create)`,
  );
}

export const modelRequests = () =>
  fs.existsSync(MODEL_LOG) ? fs.readFileSync(MODEL_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
export const tapEntries = () =>
  fs.existsSync(TAP_LOG) ? fs.readFileSync(TAP_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

export const shellPrompt = (label, command) => `${label} [O3_SH:${b64(command)}]`;

// Create a Workspace-bound public Session whose first Turn runs one Shell command.
export async function createShellSession(workspace, prompt, { actor = 'alice', key, cwd = 'child' } = {}) {
  const res = await api(
    'POST',
    '/v1/agents/sessions',
    { agent_id: 'qwen-code', input: [{ type: 'input_text', text: prompt }], workspace: { workspace_id: workspace, cwd_relative: cwd } },
    { actor, key: key ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  );
  if (res.status >= 300) throw new Error(`create session ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id;
}

export const turnRows = (session) =>
  sql(`SELECT turn_id, status, COALESCE(error_code,''), prompt_id FROM managed_agent_turn WHERE session_id='${session}' ORDER BY turn_id`);

export async function waitTurn(session, { timeoutMs = 120_000, until = ['COMPLETED', 'FAILED', 'CANCELLED'] } = {}) {
  const start = Date.now();
  for (;;) {
    const rows = turnRows(session);
    if (rows.length && until.includes(rows[0][1])) return { turn: rows[0][0], status: rows[0][1], error: rows[0][2], promptId: rows[0][3], ms: Date.now() - start };
    if (Date.now() - start > timeoutMs) return { turn: rows[0]?.[0], status: rows[0]?.[1] ?? 'NONE', error: rows[0]?.[2], ms: Date.now() - start, timeout: true };
    await sleep(250);
  }
}

export const resultRows = (session) =>
  sql(
    `SELECT result_id, work_state, COALESCE(failure_code,''), attempts, COALESCE(item_id,''), COALESCE(policy_version,''), claim_generation FROM managed_agent_tool_result WHERE session_id='${session}' ORDER BY result_id`,
  ).map((r) => ({ id: r[0], state: r[1], failure: r[2], attempts: +r[3], itemId: r[4], policy: r[5], generation: +r[6] }));

// Wait for every result source of the Session to leave PENDING/LEASED.
export async function waitProjection(session, { timeoutMs = 60_000, count = 1 } = {}) {
  const start = Date.now();
  for (;;) {
    const rows = resultRows(session);
    if (rows.length >= count && rows.every((r) => !['PENDING', 'LEASED', 'RETRYABLE'].includes(r.state))) return { rows, ms: Date.now() - start };
    if (Date.now() - start > timeoutMs) return { rows, ms: Date.now() - start, timeout: true };
    await sleep(200);
  }
}

export async function events(session, opts = {}) {
  const res = await api('GET', `/v1/agents/sessions/${session}/events?limit=200`, undefined, opts);
  return res.json.data ?? [];
}

export async function oss(pathname, body) {
  const res = await fetch(OSS_ADMIN + pathname, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}

export function out(file, obj) {
  fs.mkdirSync(`${R}/out`, { recursive: true });
  fs.writeFileSync(`${R}/out/${file}`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}
