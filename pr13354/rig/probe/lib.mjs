// VERIFICATION RIG ONLY (PR #13354): probe helpers. Runs INSIDE the Linux rig container (loopback to Spring/Harness).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';

export const RIG = '/Users/wenshao/pr13354-rig';
const envText = fs.readFileSync(`${RIG}/lx/env.sh`, 'utf8');
const envv = (k) => envText.match(new RegExp(`${k}=([^;\\s]+)`))?.[1];
export const DB = process.env.DB ?? 'h1';
export const ARM = process.env.ARM ?? '?';
export const SPRING_PORT = Number(envv('SPRING_PORT'));
export const BROKER_PORT = Number(envv('BROKER_PORT'));
export const HARNESS_PORT = Number(envv('HARNESS_PORT'));
export const BASE = `http://127.0.0.1:${SPRING_PORT}`;
export const TENANT = 't-rig';
export const HTOKEN = envv('HTOKEN');
export const BTOKEN = envv('BTOKEN');
export const LOGD = `${RIG}/run/${DB}`;
export const VARRUN = `/var/rig/run/${DB}`;
export const MODEL_LOG = `${LOGD}/model-requests.jsonl`;
export const TAP_LOG = `${LOGD}/tap.jsonl`;
export const TAP_RULES = `${LOGD}/tap-rules.json`;
export const OUT = `${RIG}/results/${DB}`;
fs.mkdirSync(OUT, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pool;
export async function sql(query, params = []) {
  pool ??= mysql.createPool({ host: 'pr13354-db', user: 'root', password: fs.readFileSync(`${RIG}/lx/.dbpass`, 'utf8').trim(), database: DB, connectionLimit: 4, dateStrings: true, timezone: 'Z' });
  const [rows] = await pool.query(query, params);
  return rows;
}
export const one = async (q, p) => { const r = await sql(q, p); return r[0] ? Object.values(r[0])[0] : undefined; };
export async function closeDb() { if (pool) await pool.end(); pool = undefined; hasL3 = undefined; }

export async function api(method, path, body, { key, actor = 'alice', tenant = TENANT, timeoutMs = 30_000, base = BASE, headers: extra = {} } = {}) {
  const headers = { Accept: 'application/json', ...extra };
  if (tenant) headers['X-Qwen-Tenant-Id'] = tenant;
  if (actor) headers['X-Rig-Actor'] = actor;
  if (key) headers['Idempotency-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  let status = 0, text = '', resHeaders = {};
  try {
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    status = res.status; text = await res.text(); resHeaders = Object.fromEntries(res.headers);
  } catch (e) { text = JSON.stringify({ fetchError: String(e) }); }
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  fs.appendFileSync(`${OUT}/http.jsonl`, JSON.stringify({ t: new Date().toISOString(), probe: process.argv[1]?.split('/').pop(), method, path, actor, key, status, body, json }) + '\n');
  return { status, json, headers: resHeaders, ms: Date.now() - started };
}

// ---- workspace registry: alice/carol create, bob reads only, mallory nothing ----
export async function ensureWorkspace(ws, storage) {
  if (Number(await one('SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id=? AND workspace_id=?', [TENANT, ws])) > 0) return;
  await sql(`INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (?,?,1,?,?,'managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`, [TENANT, ws, storage, ws]);
  for (const a of ['alice', 'carol']) await sql('INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (?,?,?,TRUE,TRUE)', [TENANT, ws, a]);
  await sql('INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (?,?,?,TRUE,FALSE)', [TENANT, ws, 'bob']);
}

// ---- surfaces ----
const WEB = '/api/agent/web-shell/v1';
export const uid = (p) => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
export async function createSession(surface, ws, text, { actor = 'alice', key = uid('create'), cwd = 'child' } = {}) {
  const input = [{ type: 'input_text', text }];
  const r = surface === 'web'
    ? await api('POST', `${WEB}/sessions/create`, { agentId: 'qwen-code', idempotencyKey: key, input, workspace: { workspaceId: ws, cwdRelative: cwd } }, { actor })
    : await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input, workspace: { workspace_id: ws, cwd_relative: cwd } }, { actor, key });
  return { ...r, session: r.json.sessionId ?? r.json.id };
}
export const del = (surface, s, { key = uid('del'), actor = 'alice' } = {}) => surface === 'web'
  ? api('POST', `${WEB}/sessions/delete`, { sessionId: s, idempotencyKey: key }, { actor })
  : api('DELETE', `/v1/agents/sessions/${s}`, undefined, { actor, key });
export const closeS = (surface, s, { key = uid('close'), actor = 'alice' } = {}) => surface === 'web'
  ? api('POST', `${WEB}/sessions/close`, { sessionId: s, idempotencyKey: key }, { actor })
  : api('POST', `/v1/agents/sessions/${s}/close`, undefined, { actor, key });
export const archive = (surface, s, { key = uid('arch'), actor = 'alice' } = {}) => surface === 'web'
  ? api('POST', `${WEB}/sessions/archive`, { sessionId: s, idempotencyKey: key }, { actor })
  : api('POST', `/v1/agents/sessions/${s}/archive`, undefined, { actor, key });
export const read = (surface, s, { actor = 'alice' } = {}) => surface === 'web'
  ? api('POST', `${WEB}/sessions/get`, { sessionId: s }, { actor })
  : api('GET', `/v1/agents/sessions/${s}`, undefined, { actor });
export const opRead = (surface, s, op, { actor = 'alice' } = {}) => surface === 'web'
  ? api('POST', `${WEB}/operations/query`, { sessionId: s, operationId: op }, { actor })
  : api('GET', `/v1/agents/sessions/${s}/operations/${op}`, undefined, { actor });
export const opIdOf = (surface, r) => (surface === 'web' ? r.json.operationId : r.json.id);
export const code = (r) => r.json?.error?.code ?? r.json?.code ?? '';
export function caps(surface, r) {
  const c = r.json?.capabilities ?? {};
  return surface === 'web'
    ? { close: c.sessionClose, archive: c.sessionArchive, unarchive: c.sessionUnarchive, delete: c.sessionDelete }
    : { close: c.session_close, archive: c.session_archive, unarchive: c.session_unarchive, delete: c.session_delete, lifecycle: c.session_lifecycle };
}
export const sendInput = (s, text, { key = uid('in'), actor = 'alice' } = {}) =>
  api('POST', `/v1/agents/sessions/${s}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text }] }, { key, actor });
export async function waitOp(surface, s, op, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await opRead(surface, s, op);
    if (['completed', 'failed'].includes(r.json?.status)) return { ...r, waited: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { ...r, waited: Date.now() - t0, timeout: true };
    await sleep(150);
  }
}

// ---- DB views ----
export const turns = (s) => sql('SELECT turn_id, status, COALESCE(error_code,"") AS err FROM managed_agent_turn WHERE session_id=? ORDER BY created_at', [s]);
export async function waitTurns(s, n = 1, timeoutMs = 90_000) {
  const t0 = Date.now();
  for (;;) {
    const rows = await turns(s);
    const done = rows.filter((r) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.status));
    if (done.length >= n) return { rows, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { rows, ms: Date.now() - t0, timeout: true };
    await sleep(200);
  }
}
export const sessRow = async (s) => (await sql('SELECT status, deleted_at, harness_boot_id, workspace_id, tool_profile FROM managed_agent_session WHERE session_id=?', [s]))[0];
let hasL3;
const l3cols = async () => (hasL3 ??= Number(await one("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='managed_agent_operation' AND column_name='lifecycle_protocol_version'")) > 0);
export const opRow = async (op) => (await sql(`SELECT operation_kind AS kind, state, delivery_state AS delivery, session_status_before AS before_, COALESCE(receipt_id,"") AS receipt, claim_generation AS gen, attempt_count AS attempts, COALESCE(error_code,"") AS err, ${(await l3cols()) ? 'lifecycle_protocol_version AS proto, IF(lifecycle_effects_receipt_json IS NULL,0,1) AS effects' : "'n/a' AS proto, 'n/a' AS effects"} FROM managed_agent_operation WHERE operation_id=?`, [op]))[0];
export const opsOf = async (s) => sql(`SELECT operation_id AS id, operation_kind AS kind, state, delivery_state AS delivery, COALESCE(error_code,"") AS err, claim_generation AS gen, attempt_count AS attempts, ${(await l3cols()) ? 'lifecycle_protocol_version' : "'n/a'"} AS proto FROM managed_agent_operation WHERE session_id=? ORDER BY created_at`, [s]);
export const bindings = (s) => sql('SELECT binding_id AS id, binding_state AS state, runtime_generation AS gen, drain_requested AS drainReq, IF(stop_evidence_json IS NULL,0,1) AS stopEv, IF(drain_receipt_json IS NULL,0,1) AS drainRcpt, resource_handle_json AS handle FROM qwen_runtime_binding WHERE isolation_key=? ORDER BY runtime_generation', [s]);
export const drains = (s) => sql('SELECT phase, COALESCE(operation_id,"") AS op, claim_generation AS gen FROM qwen_runtime_harness_drain WHERE harness_session_id=?', [s]);
export const retirement = (s) => sql('SELECT operation_id AS op, generation FROM qwen_output_session_retirement WHERE session_id=?', [s]);
export const journalHead = async (s) => (await sql('SELECT state, COALESCE(writer_id,"") AS writer, COALESCE(writer_lease_until,"") AS leaseUntil FROM qwen_managed_session_journal_head WHERE session_id=?', [s]))[0];
export const events = async (s) => (await sql('SELECT event_type FROM managed_agent_event WHERE session_id=? ORDER BY sequence_id', [s])).map((r) => r.event_type);

// ---- process / registration spies (we run inside the container) ----
export function workerPids() {
  const out = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout;
  return out.split('\n').filter((l) => l.includes(`${RIG}/dist/`) && !/ serve /.test(l) && !l.includes('java')).map((l) => Number(l.trim().split(/\s+/)[0]));
}
export function pidsOfSession(s) {
  const out = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout;
  return out.split('\n').filter((l) => l.includes(`${RIG}/dist/`) && !/ serve /.test(l) && !l.includes('java')).map((l) => Number(l.trim().split(/\s+/)[0])).filter((p) => {
    try { return fs.readFileSync(`/proc/${p}/environ`, 'utf8').includes(s); } catch { return false; }
  });
}
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function registrations() {
  const dir = `${VARRUN}/broker`;
  const res = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; e.isDirectory() ? walk(p) : res.push(p); } };
  try { walk(dir); } catch {}
  return res;
}
export const wsPath = (st, rel) => `${VARRUN}/ws/${st}/${rel}`;
export const readWs = (st, rel) => { try { return fs.readFileSync(wsPath(st, rel), 'utf8'); } catch { return null; } };
export const tap = () => (fs.existsSync(TAP_LOG) ? fs.readFileSync(TAP_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const tapFor = (s, since = 0) => tap().slice(since).filter((e) => e.path.includes(s)).map((e) => `${e.method} ${e.path.replace(s, ':id')} -> ${e.status ?? e.fault}${e.body?.kind ? ' kind=' + e.body.kind : ''}`);
export const setTapRules = (rules) => fs.writeFileSync(TAP_RULES, JSON.stringify(rules));
export const harnessLog = (n) => { try { return fs.readFileSync(`${LOGD}/harness-${n}.log`, 'utf8'); } catch { return ''; } };
export function lastLog(prefix) {
  const files = fs.readdirSync(LOGD).filter((f) => f.startsWith(prefix + '-') && f.endsWith('.log')).sort((a, b) => Number(a.split('-')[1].split('.')[0]) - Number(b.split('-')[1].split('.')[0]));
  return files.length ? `${LOGD}/${files.at(-1)}` : null;
}
export function sh(cmd, { allowFail = false } = {}) {
  try { return execFileSync('bash', ['-c', cmd], { encoding: 'utf8', timeout: 400_000 }).trim(); } catch (e) { if (allowFail) return (e.stdout ?? '') + (e.stderr ?? ''); throw e; }
}
// Broker warm from inside the container (what the Harness calls before ordinary execution).
export async function warm(s) {
  const r = await fetch(`http://127.0.0.1:${BROKER_PORT}/internal/runtime-broker/v1/runtimes:warm`, { method: 'POST', headers: { Authorization: `Bearer ${BTOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, requestId: uid('warm'), harnessSessionId: s }), signal: AbortSignal.timeout(20_000) }).catch((e) => ({ status: 0, text: async () => String(e) }));
  return { status: r.status, body: (await r.text()).slice(0, 300) };
}

export class Report {
  constructor(name) {
    this.name = name; this.rows = []; this.pass = 0; this.fail = 0;
    this.file = `${OUT}/${name}`;
    fs.writeFileSync(`${this.file}.log`, '');
    this.say(`# ${name}  db=${DB} arm=${ARM}  ${new Date().toISOString()}`);
  }
  say(line) { console.log(line); fs.appendFileSync(`${this.file}.log`, line + '\n'); }
  check(label, ok, detail = '') { ok ? this.pass++ : this.fail++; this.rows.push({ label, ok: !!ok, detail }); this.say(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== '' ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); return ok; }
  note(label, detail = '') { this.rows.push({ label, note: true, detail }); this.say(`NOTE  ${label}${detail !== '' ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); }
  done(extra = {}) {
    this.say(`== ${this.name}: ${this.pass} passed, ${this.fail} failed`);
    fs.writeFileSync(`${this.file}.json`, JSON.stringify({ name: this.name, db: DB, arm: ARM, pass: this.pass, fail: this.fail, rows: this.rows, ...extra }, null, 2));
    return this.fail === 0;
  }
}
export const j = (v) => JSON.stringify(v);

// Worker of a Session: binding handle resourceId -> durable registration (pid, state).
export async function workerOf(s) {
  const b = (await bindings(s)).at(-1);
  if (!b?.handle) return { binding: b?.id, state: b?.state };
  const rid = JSON.parse(b.handle).resourceId;
  let reg = null; try { reg = JSON.parse(fs.readFileSync(`${VARRUN}/broker/${rid}.json`, 'utf8')); } catch {}
  const files = registrations().filter((f) => f.includes(rid)).map((f) => f.split('.').pop());
  return { binding: b.id, bstate: b.state, rid: rid.slice(0, 12), pid: reg?.pid ?? null, regState: reg?.state ?? null, regFiles: files.join(','), pidAlive: reg?.pid ? alive(reg.pid) : false };
}
// tap entries for a Session: URL contains it or the JSON body names it.
export const tapFor2 = (s, since = 0) => tap().slice(since).filter((e) => e.path.includes(s) || JSON.stringify(e.body ?? {}).includes(s)).map((e) => `${e.method} ${e.path.replace(s, ':id')} -> ${e.status ?? e.fault}${e.body?.kind ? ' kind=' + e.body.kind : ''}${e.body?.lifecycleAuthority ? ' lifecycleLoad' : ''}${e.body?.authority ? ' auth=' + e.body.authority.operationId?.slice(0, 11) + '/g' + e.body.authority.claimGeneration : ''}${e.body?.hookCatalog ? ' hookCatalog' : ''}`);
export const tapLen = () => tap().length;
export async function waitFor(fn, timeoutMs = 30_000, stepMs = 200) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return { v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { v, ms: Date.now() - t0, timeout: true };
    await sleep(stepMs);
  }
}
