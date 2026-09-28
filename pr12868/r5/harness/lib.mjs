// Verification rig for PR #12868 (generic Broker provider controls).
// Real MySQL 8.4.7 + Spring server jar (embedded Runtime Broker, production
// HTTP face and HttpRuntimeTransport) + real bundled workers (dist/cli.js),
// driven by the BUILT TypeScript BrokerManagedRuntimeProvider.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RIG = path.dirname(new URL(import.meta.url).pathname);
export const SP = path.dirname(RIG);
export const ARM = process.env.ARM ?? 'pr';
export const WT = path.join(SP, `wt-${ARM}`);
export const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
export const BROKER_TOKEN = process.env.BROKER_TOKEN ?? 'rig-broker-token-12868';
export const TENANT = 't-rig';
export const DB = process.env.DB ?? 'p868a';
export const HTTP_PORT = Number(process.env.HTTP_PORT ?? 18868);
export const BROKER_PORT = Number(process.env.BROKER_PORT ?? 19868);
export const PROXY_PORT = Number(process.env.PROXY_PORT ?? 17868);
export const ROOTS = process.env.ROOTS ?? path.join(RIG, 'roots');
export const BROKER_URL = `http://127.0.0.1:${BROKER_PORT}`;
export const LEDGER = path.join(RIG, 'run', `ledger-${DB}.jsonl`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let logFile = null;
export function openLog(name) {
  // LOG_ARM names the build under test when it differs from the arm whose
  // provider client is loaded (a candidate jar with the head's worker).
  if (process.env.LOG_ARM) name = name.replace(`-${ARM}-`, `-${process.env.LOG_ARM}-`).replace(`arm=${ARM}`, `arm=${process.env.LOG_ARM}`);
  logFile = path.join(RIG, 'out', `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
}
export function say(tag, text) {
  const line = `[${tag}] ${typeof text === 'string' ? text : JSON.stringify(text)}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}

const results = [];
export function check(id, title, ok, detail = '') {
  results.push({ id, title, ok });
  say(ok ? 'PASS' : 'FAIL', `${id} ${title}${detail ? ` :: ${detail}` : ''}`);
  return ok;
}
export function summary() {
  const failed = results.filter((r) => !r.ok);
  say('SUMMARY', `${results.length - failed.length}/${results.length} checks passed` +
    (failed.length ? ` — failed: ${failed.map((f) => f.id).join(', ')}` : ''));
  return failed.length === 0;
}

export function sql(query, db = DB) {
  const out = execFileSync(
    MYSQL,
    ['-uroot', '-prig12868', '-h127.0.0.1', '-P13868', '-N', '-B', '--raw', db, '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 },
  );
  return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}

export function executions(runtimeSessionId) {
  return sql(
    `SELECT execution_call_id, execution_state, IFNULL(execution_status,'-'), dispatch_generation, cancel_requested, reference_json, IFNULL(result_json,'-'), request_digest FROM qwen_tool_execution WHERE CAST(runtime_session_id AS BINARY)=${hexId(runtimeSessionId)} ORDER BY record_version, execution_call_id`,
  ).map(([id, state, status, generation, cancel, reference, result, digest]) => ({
    id, state, status, generation: Number(generation), cancel: cancel === '1',
    reference: JSON.parse(reference), result: result === '-' ? null : JSON.parse(result), digest,
  }));
}

// Ids in this rig may hold any character: compare them as hex.
export const hexId = (id) => `X'${Buffer.from(String(id), 'utf8').toString('hex')}'`;

export function runtimeSession(runtimeSessionId) {
  const rows = sql(
    `SELECT session_state, binding_id, runtime_generation, harness_session_id, turn_kind FROM qwen_runtime_session WHERE CAST(runtime_session_id AS BINARY)=${hexId(runtimeSessionId)}`,
  );
  return rows.length ? { state: rows[0][0], bindingId: rows[0][1], generation: Number(rows[0][2]), harness: rows[0][3], turnKind: rows[0][4] } : null;
}

export function holders() {
  return sql(
    'SELECT storage_key, IFNULL(runtime_session_id,"<none>") FROM managed_workspace_execution_lease ORDER BY storage_key',
  );
}

export function seedRegistry(workspace, storage, actors = ['alice']) {
  sql(
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`,
  );
  for (const actor of actors)
    sql(
      `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}',CAST('${actor}' AS BINARY),TRUE,TRUE)`,
    );
}

export async function api(method, url, { actor, idem, body } = {}) {
  const headers = { 'content-type': 'application/json', 'X-Qwen-Tenant-Id': TENANT };
  if (actor) headers['X-Rig-Actor'] = actor;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(`http://127.0.0.1:${HTTP_PORT}${url}`, {
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

export async function createSession(workspace, cwd = 'child', actor = 'alice') {
  const res = await api('POST', '/v1/agents/sessions', {
    actor,
    idem: randomUUID(),
    body: {
      agent_id: 'qwen-code',
      ...(workspace ? { workspace: { workspace_id: workspace, cwd_relative: cwd } } : {}),
    },
  });
  if (res.status >= 300) throw new Error(`create session: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id ?? res.json.session_id ?? res.json.sessionId;
}

// ---------------------------------------------------------------------------
// Raw Broker HTTP (the same private face the provider uses), for requests the
// provider would never send.
export async function broker(method, route, body) {
  const r = await fetch(`${BROKER_URL}/internal/runtime-broker/v1/${route}`, {
    method,
    headers: { authorization: `Bearer ${BROKER_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, code: json?.code, json };
}

// ---------------------------------------------------------------------------
// The built TypeScript provider from the worktree under test.
export async function loadProvider() {
  const mod = await import(
    pathToFileURL(path.join(WT, 'packages/cli/dist/src/serve/broker-managed-runtime-provider.js')).href
  );
  return mod;
}

export function prepareRequest(runtimeSessionId, turnKind = 'bootstrap', cwd = path.join(ROOTS, 'plain')) {
  return {
    protocolVersion: 1,
    tenantId: TENANT,
    workspaceId: 'rig-workspace',
    workspaceCwd: cwd,
    sessionId: runtimeSessionId,
    turnKind,
  };
}

export async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return {
      ok: false,
      status: error?.status,
      code: error?.code,
      name: error?.name,
      message: String(error?.message ?? error),
    };
  }
}
export function brief(a) {
  return a.ok ? `ok ${JSON.stringify(a.value)?.slice(0, 160)}` : `refused status=${a.status ?? '-'} code=${a.code ?? '-'} ${a.name}: ${a.message}`;
}

// ---------------------------------------------------------------------------
// Broker -> worker wire ledger (written by proxy.mjs).
// A mark is a line count: the proxy's own seq restarts with the proxy.
export function ledger(sinceLine = 0) {
  if (!fs.existsSync(LEDGER)) return [];
  return fs
    .readFileSync(LEDGER, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(sinceLine)
    .map((l) => JSON.parse(l));
}
export function ledgerMark() {
  return ledger().length;
}
export function wire(entries) {
  return entries.map(
    (e) => `${e.path.replace('/internal/managed-runtime', '')}${e.kind ? `[${e.kind}]` : ''} -> ${e.status}${e.fault ? ` (${e.fault})` : ''}`,
  );
}
export async function hook(spec) {
  const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/__rig/hook`, { method: 'POST', body: JSON.stringify(spec) });
  return r.json();
}
export async function clearHooks() {
  await fetch(`http://127.0.0.1:${PROXY_PORT}/__rig/clear`, { method: 'POST' });
}

// One request sent to a worker by the rig itself, with the headers the Broker
// last used for that worker. For orders of requests the Broker never sends.
export async function inject(port, route, body) {
  const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/__rig/send`, { method: 'POST', body: JSON.stringify({ port, path: `/internal/managed-runtime/${route}`, body }) });
  const answer = await r.json();
  return { status: answer.status, code: answer.json?.code, json: answer.json, error: answer.error };
}
export function workerPortOf(runtimeSessionId) {
  const hit = ledger().reverse().find((e) => JSON.stringify(e.request ?? {}).includes(runtimeSessionId));
  return hit?.port;
}

export function launches() {
  const f = path.join(RIG, 'run', `launches-${DB}.log`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : [];
}

export function workerPids() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => l.includes(`${WT}/dist/cli.js`) && l.includes('managed-runtime-worker'))
    .map((l) => {
      const [pid, ppid, rss] = l.trim().split(/\s+/);
      return { pid: Number(pid), ppid: Number(ppid), rssKb: Number(rss) };
    });
}

export function readLines(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}
