// VERIFICATION RIG ONLY (PR #13194): L1/L2 lifecycle helpers on top of the PR #13135 rig library.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { api, sql, one, LX, DB, RIG, TAP_LOG, MODEL_LOG, LXRUN, STATE_DIR } from '../probe/lib.mjs';
export * from '../probe/lib.mjs';

const WEB = '/api/agent/web-shell/v1';
export const other = (surface) => (surface === 'web' ? 'public' : 'web');

export const archive = (surface, s, { key, actor = 'alice', tenant } = {}) =>
  surface === 'web'
    ? api('POST', `${WEB}/sessions/archive`, { sessionId: s, idempotencyKey: key }, { actor, tenant })
    : api('POST', `/v1/agents/sessions/${s}/archive`, undefined, { actor, key, tenant });
export const unarchive = (surface, s, { key, actor = 'alice', tenant } = {}) =>
  surface === 'web'
    ? api('POST', `${WEB}/sessions/unarchive`, { sessionId: s, idempotencyKey: key }, { actor, tenant })
    : api('POST', `/v1/agents/sessions/${s}/unarchive`, undefined, { actor, key, tenant });
export const del = (surface, s, { key, actor = 'alice', tenant } = {}) =>
  surface === 'web'
    ? api('POST', `${WEB}/sessions/delete`, { sessionId: s, idempotencyKey: key }, { actor, tenant })
    : api('DELETE', `/v1/agents/sessions/${s}`, undefined, { actor, key, tenant });
export const read = (surface, s, { actor = 'alice', tenant } = {}) =>
  surface === 'web' ? api('POST', `${WEB}/sessions/get`, { sessionId: s }, { actor, tenant }) : api('GET', `/v1/agents/sessions/${s}`, undefined, { actor, tenant });
export const opRead = (surface, s, op, { actor = 'alice', tenant } = {}) =>
  surface === 'web' ? api('POST', `${WEB}/operations/query`, { sessionId: s, operationId: op }, { actor, tenant }) : api('GET', `/v1/agents/sessions/${s}/operations/${op}`, undefined, { actor, tenant });
export const opId = (surface, r) => (surface === 'web' ? r.json.operationId : r.json.id);
export const replayHdr = (r) => r.headers['x-qwen-idempotent-replay'];
export const statusOf = (surface, r) => (r.json.status ?? '').toString();
export const code = (r) => r.json.error?.code ?? r.json.code ?? '';
export function caps(surface, r) {
  const c = r.json.capabilities ?? {};
  return surface === 'web'
    ? { close: c.sessionClose, archive: c.sessionArchive, unarchive: c.sessionUnarchive, delete: c.sessionDelete }
    : { close: c.session_close, archive: c.session_archive, unarchive: c.session_unarchive, delete: c.session_delete, lifecycle: c.session_lifecycle };
}
export async function waitOpDone(surface, s, op, timeoutMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await opRead(surface, s, op);
    if (['completed', 'failed'].includes(r.json.status)) return { ...r, waited: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { ...r, waited: Date.now() - t0, timeout: true };
    await new Promise((res) => setTimeout(res, 150));
  }
}
export const input = (s, key, actor = 'alice') =>
  api('POST', `/v1/agents/sessions/${s}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'PLAIN after lifecycle' }] }, { key, actor });
export const webTurn = (s, key, actor = 'alice') =>
  api('POST', `${WEB}/turns/submit`, { sessionId: s, idempotencyKey: key, input: [{ type: 'input_text', text: 'PLAIN after lifecycle' }] }, { actor });

// Direct call to the in-process Runtime Broker (what the Harness calls before a Turn), from inside the container.
export function warm(session) {
  const env = fs.readFileSync(`${RIG}/lx/env.sh`, 'utf8');
  const port = env.match(/BROKER_PORT=(\d+)/)[1];
  const token = env.match(/BTOKEN=(\S+)/)[1];
  const body = JSON.stringify({ protocolVersion: 1, requestId: `warm-${Date.now()}`, harnessSessionId: session });
  const out = LX(`curl -s -m 20 -w '\\n%{http_code}' -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -X POST --data '${body}' http://127.0.0.1:${port}/internal/runtime-broker/v1/runtimes:warm || true`);
  const lines = out.split('\n');
  return { status: Number(lines.at(-1)), body: lines.slice(0, -1).join('\n').slice(0, 300) };
}

// ---- spies: anything the Runtime/Harness side would have to touch ----
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).length : 0);
const h = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
export function runtimeSnapshot(session, binding) {
  return {
    tap: fs.existsSync(TAP_LOG) ? fs.readFileSync(TAP_LOG, "utf8").split("\n").filter((l) => l.includes(session)).length : 0,
    model: lines(MODEL_LOG),
    binding: h(sql(`SELECT * FROM qwen_runtime_binding WHERE binding_id='${binding}'`)),
    runtimeSessions: h(sql(`SELECT * FROM qwen_runtime_session WHERE binding_id='${binding}' ORDER BY 1`)),
    leases: h(sql(`SELECT * FROM managed_workspace_execution_lease WHERE binding_id='${binding}' ORDER BY 1`)),
    drains: h(sql(`SELECT * FROM qwen_runtime_harness_drain WHERE harness_session_id='${session}' ORDER BY 1`)),
    registrations: LX(`cd ${LXRUN}/${STATE_DIR} 2>/dev/null && find . -maxdepth 1 -type f -printf '%f %s %T@\\n' | sort | sha256sum | cut -c1-16 || echo none`),
    workers: LX(`ps -eo pid=,args= | awk 'index($0, "/dist/") && $0 !~ / serve / && $0 !~ /java/ && $0 !~ /awk/ {print $1}' | sort | tr '\\n' ' '`).trim(),
  };
}
export function diffSnap(a, b) {
  return Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} -> ${b[k]}`);
}

// MySQL general log (file) as a statement-level spy; this mysqld only serves the rig.
const MYSQL_ROOT = `${RIG}/mysql`;
export const GENLOG = `${MYSQL_ROOT}/general-p94.log`;
export function genlogOn() {
  sql(`SET GLOBAL general_log_file='${GENLOG}'`, 'mysql');
  sql('SET GLOBAL general_log=ON', 'mysql');
  return fs.existsSync(GENLOG) ? fs.statSync(GENLOG).size : 0;
}
export function genlogOff() {
  sql('SET GLOBAL general_log=OFF', 'mysql');
}
// Returns write statements (INSERT/UPDATE/DELETE/REPLACE) since `offset` that touch any of the given tables.
export function genlogWrites(offset, tables, ids = []) {
  const buf = fs.readFileSync(GENLOG);
  const text = buf.subarray(offset).toString('utf8');
  const out = [];
  for (const raw of text.split('\n')) {
    const l = raw.replace(/[\u0000-\u0008]/g, '');
    const m = l.match(/\b(Query|Execute)\s+(.*)$/);
    if (!m) continue;
    const stmt = m[2];
    if (!/^\s*(\/\*.*?\*\/\s*)?(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(stmt)) continue;
    if (tables.some((t) => new RegExp(`\\b${t}\\b`, 'i').test(stmt)) && (!ids.length || ids.some((id) => stmt.includes(id)))) out.push(stmt.slice(0, 160));
  }
  return out;
}
export const RUNTIME_TABLES = ['qwen_runtime_binding', 'qwen_runtime_session', 'qwen_runtime_harness_drain', 'managed_workspace_execution_lease', 'qwen_runtime_[a-z_]+'];

export const events = (s) => sql(`SELECT event_type FROM managed_agent_event WHERE session_id='${s}' ORDER BY sequence_id`).map((r) => r[0]);
export const countEv = (s, type) => events(s).filter((e) => e === type).length;
export const ops = (s) => sql(`SELECT operation_kind, state, delivery_state, session_status_before, COALESCE(receipt_id,''), claim_generation, attempt_count FROM managed_agent_operation WHERE session_id='${s}' ORDER BY created_at, operation_id`);
export const retirement = (s) => sql(`SELECT operation_id, generation, recovery_protected FROM qwen_output_session_retirement WHERE session_id='${s}'`);
export const journalHead = (s) => sql(`SELECT state, recovery_status, COALESCE(writer_id,''), COALESCE(writer_lease_until,'') FROM qwen_managed_session_journal_head WHERE session_id='${s}'`)[0];
export const unarchiveCommands = (s) => Number(one(`SELECT COUNT(*) FROM managed_agent_command WHERE session_id='${s}' AND operation='UNARCHIVE_WORKSPACE_SESSION'`) ?? -1);
export { DB, RIG };

// Hold an InnoDB row lock from a separate connection for `seconds` (BEGIN; <lock query>; DO SLEEP; COMMIT).
import { spawn } from 'node:child_process';
export function holdLock(lockQuery, seconds, db = DB) {
  const env = Object.fromEntries(fs.readFileSync(`${RIG}/rig.env`, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const p = spawn(env.MYSQL, ['-h127.0.0.1', `-P${env.DBPORT}`, '-uroot', `-p${env.DBPASS}`, '-N', db, '-e', `BEGIN; ${lockQuery}; DO SLEEP(${seconds}); COMMIT;`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise((res) => p.on('exit', (c) => res(c)));
  // kill: end the holder's server-side connection (a client-side kill would leave DO SLEEP running and the lock held)
  const kill = () => { for (const [id] of sql("SELECT id FROM information_schema.processlist WHERE info LIKE 'DO SLEEP%'")) { try { sql(`KILL ${id}`); } catch {} } p.kill('SIGKILL'); };
  return { proc: p, done, kill };
}
export async function waitFor(fn, timeoutMs = 30_000, stepMs = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return { v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { v, ms: Date.now() - t0, timeout: true };
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
export const lockWaits = () => Number(one("SELECT COUNT(*) FROM performance_schema.data_lock_waits"));
export const opState = (op) => sql(`SELECT state, delivery_state, claim_generation, attempt_count, COALESCE(error_code,''), COALESCE(lease_owner,''), COALESCE(lease_until,0) FROM managed_agent_operation WHERE operation_id='${op}'`)[0];
export const revoke = (ws, actor, canRead) => sql(`UPDATE managed_workspace_access SET can_read=${canRead ? 'TRUE' : 'FALSE'} WHERE workspace_id='${ws}' AND actor_id='${actor}'`);
