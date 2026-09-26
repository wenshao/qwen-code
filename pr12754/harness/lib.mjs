// Verification rig for PR #12754 (W0c-3). Drives the real Spring server's
// public API, its embedded private Runtime Broker, and MySQL directly.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RIG = path.dirname(new URL(import.meta.url).pathname);
export const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const TOKEN = 'rig-broker-token';
const PREFIX = '/internal/runtime-broker/v1';

let logFile = null;
export function openLog(name) {
  logFile = path.join(RIG, 'out', `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
}
export function say(tag, text) {
  const line = `[${tag}] ${text}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}

export function sql(db, query) {
  const out = execFileSync(
    MYSQL,
    ['-uroot', '-p<local-mysql-password>', '-h127.0.0.1', '-P13754', '-N', '-B', db, '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out
    .split('\n')
    .filter((l) => l.length)
    .map((l) => l.split('\t'));
}

export function holders(db) {
  try {
    return sql(
      db,
      'SELECT LEFT(storage_key,8), IFNULL(runtime_session_id,"<none>") FROM managed_workspace_execution_lease ORDER BY storage_key',
    );
  } catch (e) {
    return [['<no table>', String(e.stderr || e.message).trim().split('\n').pop()]];
  }
}

export async function waitHealth(port, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/actuator/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server on ${port} not healthy`);
}

export function startServer(arm, name, http, broker, db, extra = []) {
  const child = spawn(path.join(RIG, 'server.sh'), [arm, name, String(http), String(broker), db, ...extra], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  fs.writeFileSync(path.join(RIG, 'run', `${name}.pid`), String(child.pid));
  return child.pid;
}

export function stopServer(name, signal = 'SIGTERM') {
  const pidFile = path.join(RIG, 'run', `${name}.pid`);
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid, signal);
  } catch {}
}

export async function api(port, method, url, { tenant, actor, idem, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (tenant) headers['X-Qwen-Tenant-Id'] = tenant;
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
  return { status: r.status, json };
}

export async function broker(port, method, url, body) {
  const r = await fetch(`http://127.0.0.1:${port}${PREFIX}${url}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify({ protocolVersion: 1, requestId: randomUUID(), ...body }),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

export function brief(res) {
  const j = res.json;
  if (j && typeof j === 'object') {
    if (typeof j.error === "string" && j.code) return `${res.status} ${j.code} retryable=${j.retryable} (${j.error})`;
    if (j.error) return `${res.status} ${j.error.code ?? j.error.type ?? JSON.stringify(j.error)}${j.error.retryable !== undefined ? ` retryable=${j.error.retryable}` : ''}`;
    if (j.code) return `${res.status} ${j.code}${j.retryable !== undefined ? ` retryable=${j.retryable}` : ''}`;
  }
  return `${res.status} ${JSON.stringify(j).slice(0, 300)}`;
}

export async function acquire(port, harnessSessionId, runtimeSessionId) {
  return broker(port, 'POST', '/tool-sessions:acquire', {
    harnessSessionId,
    runtimeSessionId,
    turnKind: 'bootstrap',
  });
}

export async function release(port, harnessSessionId, runtimeSessionId) {
  return broker(port, 'POST', `/tool-sessions/${encodeURIComponent(runtimeSessionId)}:release`, { harnessSessionId });
}

let callSeq = 0;
export function reference(runtimeSessionId, toolName, input) {
  const argsDigest = 'sha256:' + createHash('sha256').update(JSON.stringify({ toolName, input })).digest('hex');
  return {
    sessionId: runtimeSessionId,
    promptId: 'prompt-rig',
    callId: `call-${++callSeq}-${randomUUID().slice(0, 8)}`,
    argsDigest,
    toolName,
    input,
  };
}

// Creates an execution and polls it to settlement; returns the final envelope.
export async function run(port, harnessSessionId, runtimeSessionId, toolName, input, { waitMs = 30000 } = {}) {
  const ref = reference(runtimeSessionId, toolName, input);
  const created = await broker(port, 'POST', '/executions', {
    idempotencyKey: ref.callId,
    harnessSessionId,
    runtimeSessionId,
    turnId: 'turn-rig',
    toolCallId: ref.callId,
    requestDigest: ref.argsDigest,
    reference: ref,
  });
  if (created.status !== 200 && created.status !== 201 && created.status !== 202) return { created, final: created };
  const id = created.json.executionCallId;
  const end = Date.now() + waitMs;
  let final = created;
  while (final.json?.status?.state !== 'settled' && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    final = await broker(
      port,
      'GET',
      `/executions/${encodeURIComponent(id)}?requestId=${randomUUID()}&harnessSessionId=${encodeURIComponent(harnessSessionId)}&runtimeSessionId=${encodeURIComponent(runtimeSessionId)}`,
    );
  }
  return { created, final, id };
}

// Starts an execution without waiting for it.
export async function start(port, harnessSessionId, runtimeSessionId, toolName, input) {
  const ref = reference(runtimeSessionId, toolName, input);
  const created = await broker(port, 'POST', '/executions', {
    idempotencyKey: ref.callId,
    harnessSessionId,
    runtimeSessionId,
    turnId: 'turn-rig',
    toolCallId: ref.callId,
    requestDigest: ref.argsDigest,
    reference: ref,
  });
  return { created, id: created.json?.executionCallId };
}

export async function poll(port, harnessSessionId, runtimeSessionId, id, waitMs = 30000) {
  const end = Date.now() + waitMs;
  let final;
  do {
    final = await broker(
      port,
      'GET',
      `/executions/${encodeURIComponent(id)}?requestId=${randomUUID()}&harnessSessionId=${encodeURIComponent(harnessSessionId)}&runtimeSessionId=${encodeURIComponent(runtimeSessionId)}`,
    );
    if (final.json?.status?.state === 'settled') return final;
    await new Promise((r) => setTimeout(r, 200));
  } while (Date.now() < end);
  return final;
}

export function outcome(res) {
  const st = res.final?.json?.status;
  if (!st) return brief(res.final ?? res.created);
  const r = st.result ?? {};
  let text = '';
  if (Array.isArray(r.responseParts)) {
    text = JSON.stringify(r.responseParts.map((p) => p.functionResponse?.response ?? p.text ?? p));
  }
  if (r.error) text += ' error=' + JSON.stringify(r.error);
  return `${st.state} executionStatus=${r.executionStatus} ${text}`.slice(0, 420);
}

export function seedRegistry(db, tenant, workspace, storage, { config = 'managed-runtime-tools/1', policy = 'preapproved-workspace-tools/1', actors = ['alice'] } = {}) {
  sql(
    db,
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${tenant}','${workspace}',1,'${storage}','${workspace}','${config}','${policy}','ACTIVE')`,
  );
  for (const actor of actors) {
    sql(db, `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${tenant}','${workspace}',CAST('${actor}' AS BINARY),TRUE,TRUE)`);
  }
}

export async function createSession(port, tenant, actor, workspace, cwd) {
  const ws = cwd === undefined ? { workspace_id: workspace } : { workspace_id: workspace, cwd_relative: cwd };
  const res = await api(port, 'POST', '/v1/agents/sessions', {
    tenant,
    actor,
    idem: randomUUID(),
    body: { agent_id: 'qwen-code', workspace: ws },
  });
  return res;
}

export async function createLegacySession(port, tenant) {
  return api(port, 'POST', '/v1/agents/sessions', { tenant, idem: randomUUID(), body: { agent_id: 'qwen-code' } });
}

export function launches(name) {
  const f = path.join(RIG, 'run', name, 'launches.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : [];
}

export function workerPids() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => l.includes('managed-runtime-worker') && l.includes('qwen-code-pr127'))
    .map((l) => l.trim().split(/\s+/).slice(0, 2).map(Number));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
