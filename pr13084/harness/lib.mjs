// VERIFICATION RIG ONLY (PR #13084): helpers for probes against the local stack:
// MySQL 8.4 + Spring server jar (public API, Session Store, embedded Runtime
// Broker, O2 publication, O3 projection) + packaged Hosted Harness + OSS double.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const R = path.dirname(new URL(import.meta.url).pathname);
export const S = path.dirname(R);
export const BASE = process.env.BASE ?? 'http://127.0.0.1:18084';
export const TENANT = process.env.TENANT ?? 't-o41';
export const DB = process.env.DB ?? 'o41a';
export const MODEL_LOG = `${R}/run/model-requests.jsonl`;
export const TAP_LOG = `${R}/run/tap.jsonl`;
export const OSS_ADMIN = 'http://127.0.0.1:18485';
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
  const r = spawnSync(MYSQL, ['-h127.0.0.1', '-P23084', '-uroot', '-prig13084', '-N', '-B', db, '-e', query], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
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

// ---------------------------------------------------------------------------
// PR #13084 (O4-1) additions
export const genCmd = (tag, so, se = 0, code = 0) => `${NODE22} ${R}/gen.mjs ${tag} ${so} ${se} ${code}`;
export function genSha(tag, stream, bytes) {
  const hash = createHash('sha256');
  let left = bytes, block = 0;
  while (left > 0) {
    const out = Buffer.alloc(65536);
    for (let i = 0; i < 2048; i++) createHash('sha256').update(`${tag}|${stream}|${block}|${i}`).digest().copy(out, i * 32);
    block++;
    const take = Math.min(left, out.length);
    hash.update(out.subarray(0, take));
    left -= take;
  }
  return hash.digest('hex');
}
export async function artifacts(session, opts = {}) {
  const r = await api('GET', `/v1/agents/sessions/${session}/artifacts`, undefined, opts);
  return { status: r.status, list: r.json.data?.map((e) => e.artifact) ?? [], json: r.json };
}
// One Workspace Session whose first public Turn runs one Shell command; waits for the projection.
export async function makeOutput(label, ws, storage, cmd, { turnMs = 900_000, projMs = 300_000 } = {}) {
  register(ws, storage);
  const t0 = Date.now();
  const session = await createShellSession(ws, shellPrompt(label, cmd));
  const turn = await waitTurn(session, { timeoutMs: turnMs });
  const proj = await waitProjection(session, { timeoutMs: projMs });
  const arts = (await artifacts(session)).list;
  return { session, turn, ms: Date.now() - t0, results: proj.rows.map((r) => `${r.state}${r.failure ? '/' + r.failure : ''}`), arts };
}
export const pubRows = (session, db) =>
  sql(`SELECT publication_id, state, producer_phase, retention_state, write_evidence, accepted_complete, quarantined, capture_held_bytes+producer_held_bytes+admission_held_bytes, capture_used_bytes+producer_used_bytes+admission_used_bytes FROM qwen_tool_publication WHERE session_id='${session}' ORDER BY publication_id`, db)
    .map((r) => ({ id: r[0], state: r[1], phase: r[2], retention: r[3], writeEvidence: r[4] === '1', acceptedComplete: r[5] === '1', quarantined: r[6] === '1', held: +r[7], used: +r[8] }));
export const putAttempts = (publicationId, db) =>
  sql(`SELECT state, COUNT(*) FROM qwen_output_put_attempt WHERE publication_id='${publicationId}' GROUP BY state ORDER BY state`, db).map((r) => `${r[0]}=${r[1]}`).join(' ');
export const retirement = (session, db) => sql(`SELECT operation_id, generation, retired_at, recovery_protected FROM qwen_output_session_retirement WHERE session_id='${session}'`, db)[0] ?? null;
export const headRow = (session, db) => sql(`SELECT state, IFNULL(writer_id,'-'), IFNULL(writer_lease_until,'-'), recovery_status FROM qwen_managed_session_journal_head WHERE session_id='${session}'`, db)[0] ?? null;
// Internal Session Store API (what the Hosted Harness calls) with an explicit writer token.
export async function storeCall(method, sessionId, route, { token, body, query = '' } = {}) {
  const r = await fetch(`${BASE}/internal/managed-session-store/v1/sessions/${sessionId}/${route}${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Qwen-Tenant-Id': TENANT, 'X-Qwen-Managed-Writer-Token': token ?? 'none' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json;
  try { json = JSON.parse(buf.toString('utf8')); } catch { json = undefined; }
  return { status: r.status, json, bytes: buf, code: json?.error?.code ?? json?.code };
}
export async function acquire(sessionId, workspaceId, { leaseMillis = 30_000, writerId = `rig-writer-${Math.random().toString(36).slice(2, 10)}` } = {}) {
  const token = (await import("node:crypto")).randomBytes(32).toString("base64url");
  const r = await storeCall('POST', sessionId, 'writers:acquire', { token, body: { workspaceId, writerId, leaseMillis } });
  return { ...r, token, writerId };
}
export const sessionWs = (session) => one(`SELECT workspace_id FROM qwen_managed_session_journal_head WHERE session_id='${session}'`);
export function opSeam(session, kind, wait = 60) {
  const r = spawnSync(`${R}/op.sh`, [session, kind, String(wait)], { encoding: 'utf8', env: { ...process.env, DB } });
  return (r.stdout + r.stderr).trim();
}
export const ossLedger = async () => (await fetch(OSS_ADMIN + '/ledger')).json();
export const ossState = async () => (await fetch(OSS_ADMIN + '/state')).json();
export const objectKeys = (session) => sql(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.scope_key=o.scope_key AND p.publication_id=o.publication_id WHERE p.session_id='${session}' AND o.object_key IS NOT NULL`).map((r) => r[0]);
export const ossHas = (key) => fs.existsSync(path.join(R, 'oss-data', createHash('sha256').update(key).digest('hex')));
export async function downloadCheck(session, a, want) {
  const full = await content(session, a.id, { revision: a.revision });
  const rng = await content(session, a.id, { revision: a.revision, range: 'bytes=4096-8191' });
  return `full=${full.status}${full.code ? '/' + full.code : ''} sha_ok=${full.status === 200 && sha256(full.body) === want} range=${rng.status}${rng.code ? '/' + rng.code : ''}${rng.status === 206 ? ` ${rng.headers['content-range']}` : ''}`;
}
// Streaming download over node:http with a byte timeline (fetch/undici hides how a body ends).
import http from 'node:http';
export function streamDownload(session, a, { range, progress = {} } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const h = createHash('sha256');
    const res0 = { status: 0, bytes: 0, firstByteMs: null, lastByteMs: null, ended: null, declared: null, timeline: [] };
    const u = new URL(`${BASE}/v1/agents/sessions/${session}/artifacts/${a.id}/content?revision=${encodeURIComponent(a.revision)}`);
    const req = http.get(u, { headers: { 'X-Qwen-Tenant-Id': TENANT, 'X-Rig-Actor': 'alice', ...(range ? { Range: range } : {}) } }, (res) => {
      res0.status = res.statusCode; res0.declared = Number(res.headers['content-length'] ?? -1); res0.connection = res.headers.connection ?? null;
      let lastMark = 0;
      res.on('data', (c) => {
        const now = Date.now() - t0;
        if (res0.firstByteMs === null) res0.firstByteMs = now;
        res0.lastByteMs = now; res0.bytes += c.length; progress.bytes = res0.bytes; h.update(c);
        if (now - lastMark >= 5000) { res0.timeline.push([now, res0.bytes]); lastMark = now; }
      });
      res.on('end', () => { res0.ended = res0.bytes === res0.declared ? 'complete' : 'short-end'; });
      res.on('aborted', () => { res0.ended = 'aborted'; });
      res.on('close', () => { res0.closeMs = Date.now() - t0; res0.sha256 = h.digest('hex'); res0.ended ??= 'closed'; resolve(res0); });
    });
    req.on('error', (e) => { res0.ended = `error ${e.code ?? e.message}`; res0.closeMs = Date.now() - t0; resolve(res0); });
  });
}
export const throttle = async (getBps) => (await fetch(OSS_ADMIN + '/throttle', { method: 'POST', body: JSON.stringify({ getBps }) })).json();
export const springPid = () => Number(fs.readFileSync(`${R}/run/spring.pid`, 'utf8'));
