// VERIFICATION RIG ONLY: helpers for probes against the PR #13107 rig.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export const RIG = '/Users/wenshao/pr13107-rig';
const env = Object.fromEntries(
  fs
    .readFileSync(`${RIG}/rig.env`, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
export const DB = process.env.DB ?? 'ui';
export const RUN = `${RIG}/run/${DB}`;
export const BASE = `http://127.0.0.1:${env.SPRING_PORT}`;
export const HARNESS = `http://127.0.0.1:${env.HARNESS_PORT}`;
export const TENANT = process.env.TENANT ?? env.TENANT;
export const MODEL_LOG = `${RUN}/model-requests.jsonl`;
export const TAP_LOG = `${RUN}/tap.jsonl`;
export const TAP_RULES = `${RUN}/tap-rules.json`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(method, path, body, { key, actor = 'alice', tenant = TENANT, timeoutMs = 20_000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (tenant) headers['X-Qwen-Tenant-Id'] = tenant;
  if (actor) headers['X-Rig-Actor'] = actor;
  if (key) headers['Idempotency-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (process.env.HTTP_LOG !== '0') {
    fs.mkdirSync(`${RIG}/out/${DB}`, { recursive: true });
    fs.appendFileSync(`${RIG}/out/${DB}/http.jsonl`, JSON.stringify({ t: new Date().toISOString(), probe: process.argv[1]?.split('/').pop(), method, path, actor, tenant, key, status: res.status, body: body === undefined ? undefined : body, json }) + '\n');
  }
  return { status: res.status, json, headers: Object.fromEntries(res.headers), ms: Date.now() - started };
}

export function sql(query, db = DB) {
  const r = spawnSync(env.MYSQL, ['-h127.0.0.1', `-P${env.DBPORT}`, '-uroot', `-p${env.DBPASS}`, '-N', '-B', db, '-e', query], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
}
export const one = (q, db) => sql(q, db)[0]?.[0];

// alice creates; bob may only read; carol may create too (another creator); mallory has no access.
export function register(workspace, storage, { creators = ['alice', 'carol'], readers = ['bob'] } = {}) {
  sql(
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`,
  );
  for (const a of creators) sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}','${a}',TRUE,TRUE)`);
  for (const a of readers) sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}','${a}',TRUE,FALSE)`);
}
export function ensureWorkspace(workspace, storage) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${workspace}'`) === '0') register(workspace, storage);
}

const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
export const modelCalls = () => lines(MODEL_LOG).length;
export const modelEntries = () => lines(MODEL_LOG).map((l) => JSON.parse(l));
export const tapEntries = () => lines(TAP_LOG).map((l) => JSON.parse(l));
export const setTapRules = (rules) => fs.writeFileSync(TAP_RULES, JSON.stringify(rules));

export const turnRow = (session) => sql(`SELECT turn_id, status, COALESCE(error_code,''), retry_count FROM managed_agent_turn WHERE session_id='${session}' ORDER BY created_at`);
export async function waitTurn(session, { timeoutMs = 60_000, until = ['COMPLETED', 'FAILED', 'CANCELLED'] } = {}) {
  const start = Date.now();
  for (;;) {
    const rows = turnRow(session);
    if (rows.length && until.includes(rows.at(-1)[1])) return { status: rows.at(-1)[1], error: rows.at(-1)[2], ms: Date.now() - start };
    if (Date.now() - start > timeoutMs) return { status: rows.at(-1)?.[1], error: rows.at(-1)?.[2], ms: Date.now() - start, timeout: true };
    await sleep(200);
  }
}

// Create a Workspace Session through either surface. Returns { session, status, json }.
export async function createSession(surface, workspace, text, { actor = 'alice', key = `k-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, cwd = 'child' } = {}) {
  const input = [{ type: 'input_text', text }];
  const r =
    surface === 'web'
      ? await api('POST', '/api/agent/web-shell/v1/sessions/create', { agentId: 'qwen-code', idempotencyKey: key, input, workspace: { workspaceId: workspace, cwdRelative: cwd } }, { actor })
      : await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input, workspace: { workspace_id: workspace, cwd_relative: cwd } }, { actor, key });
  return { ...r, session: r.json.sessionId ?? r.json.id, key };
}

export const listActions = (surface, session, opts = {}) =>
  surface === 'web'
    ? api('POST', '/api/agent/web-shell/v1/actions/query', { sessionId: session, ...(opts.limit ? { limit: opts.limit } : {}), ...(opts.cursor ? { cursor: opts.cursor } : {}) }, opts)
    : api('GET', `/v1/agents/sessions/${session}/actions${opts.limit || opts.cursor ? '?' + new URLSearchParams({ ...(opts.limit ? { limit: opts.limit } : {}), ...(opts.cursor ? { cursor: opts.cursor } : {}) }) : ''}`, undefined, opts);

export const getAction = (surface, session, id, opts = {}) =>
  surface === 'web' ? api('POST', '/api/agent/web-shell/v1/actions/get', { sessionId: session, actionId: id }, opts) : api('GET', `/v1/agents/sessions/${session}/actions/${id}`, undefined, opts);

// Answer an Action. `action` is the view the same surface returned (so revisions use that surface's field names).
export function respond(surface, session, action, optionId, { key, actor = 'alice', tenant = TENANT, override = {}, requestId = 'rig-req' } = {}) {
  const id = action.actionId ?? action.id;
  if (surface === 'web') {
    const response = { kind: 'permission', optionId, inputRevision: action.inputRevision ?? action.input_revision, policyRevision: action.policyRevision ?? action.policy_revision, ...override };
    return api('POST', '/api/agent/web-shell/v1/actions/respond', { sessionId: session, actionId: id, idempotencyKey: key, requestId, response }, { actor, tenant });
  }
  const response = { kind: 'permission', option_id: optionId, input_revision: action.input_revision ?? action.inputRevision, policy_revision: action.policy_revision ?? action.policyRevision, ...override };
  return api('POST', `/v1/agents/sessions/${session}/actions/${id}/responses`, response, { key, actor, tenant });
}

export const getOp = (surface, session, op, opts = {}) =>
  surface === 'web' ? api('POST', '/api/agent/web-shell/v1/operations/query', { sessionId: session, operationId: op }, opts) : api('GET', `/v1/agents/sessions/${session}/operations/${op}`, undefined, opts);

export async function waitPending(session, { timeoutMs = 40_000, surface = 'public', actor = 'alice', not = [] } = {}) {
  const start = Date.now();
  for (;;) {
    const r = await listActions(surface, session, { actor });
    const fresh = (r.json.data ?? []).filter((a) => !not.includes(a.actionId ?? a.id));
    if (r.status === 200 && fresh.length) return { action: fresh[0], ms: Date.now() - start, page: r.json };
    if (Date.now() - start > timeoutMs) return { timeout: true, ms: Date.now() - start, last: r };
    await sleep(150);
  }
}

export async function waitOp(session, op, { timeoutMs = 30_000, until = ['completed', 'failed'], surface = 'public' } = {}) {
  const start = Date.now();
  for (;;) {
    const r = await getOp(surface, session, op);
    if (until.includes(r.json.status)) return { ...r, ms: Date.now() - start };
    if (Date.now() - start > timeoutMs) return { ...r, ms: Date.now() - start, timeout: true };
    await sleep(150);
  }
}

export const opRow = (op) =>
  sql(`SELECT state, admission_stage, delivery_state, attempt_count, claim_generation, COALESCE(error_code,''), COALESCE(decision_receipt_id,'') FROM managed_agent_operation WHERE operation_id='${op}'`)[0];
export const actionRow = (id) => sql(`SELECT state, COALESCE(decision_receipt_id,''), COALESCE(decision_digest,'') FROM managed_agent_action WHERE action_id='${id}'`)[0];
export const sessionRow = (s) => sql(`SELECT status, approval_mode, last_sequence FROM managed_agent_session WHERE session_id='${s}'`)[0];
export const wsFile = (storage, rel) => `${RUN}/ws/${storage}/${rel}`;
export const readWs = (storage, rel) => (fs.existsSync(wsFile(storage, rel)) ? fs.readFileSync(wsFile(storage, rel), 'utf8') : null);
export const executions = (session) => Number(one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${session}'`));
export async function finalText(session) {
  const r = await api('GET', `/v1/agents/sessions/${session}/events?limit=100`);
  const s = JSON.stringify(r.json);
  const m = s.match(/UI_DONE[^"]*?results=(\[.*?\])(?=\\*")/);
  return m ? m[0].replace(/\\+"/g, '"') : s.includes('PLAIN_OK') ? 'PLAIN_OK' : null;
}

// Transcript: every probe prints labelled checks and writes JSON next to it.
export class Report {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.pass = 0;
    this.fail = 0;
    fs.mkdirSync(`${RIG}/out/${DB}`, { recursive: true });
    this.file = `${RIG}/out/${DB}/${name}`;
    fs.writeFileSync(`${this.file}.log`, '');
    this.say(`# ${name}  db=${DB}  ${new Date().toISOString()}`);
  }
  say(line) {
    console.log(line);
    fs.appendFileSync(`${this.file}.log`, line + '\n');
  }
  check(label, ok, detail = '') {
    ok ? this.pass++ : this.fail++;
    this.rows.push({ label, ok, detail });
    this.say(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
    return ok;
  }
  note(label, detail = '') {
    this.rows.push({ label, note: true, detail });
    this.say(`NOTE  ${label}${detail ? '  -> ' + detail : ''}`);
  }
  done(extra = {}) {
    this.say(`== ${this.name}: ${this.pass} passed, ${this.fail} failed`);
    fs.writeFileSync(`${this.file}.json`, JSON.stringify({ name: this.name, pass: this.pass, fail: this.fail, rows: this.rows, ...extra }, null, 2));
    return this.fail === 0;
  }
}
export const j = (v) => JSON.stringify(v);

// The rig model writes the prompt's content= value in upper case, so the written bytes never appear in the prompt itself.
export const written = (content) => content.toUpperCase();
// Scenarios share Workspace ws-a, and a Turn waiting on an approval holds it: refuse to start on a busy rig.
export const WS = process.env.WS ?? 'ws-a';
export const ST = process.env.ST ?? 'a';
export function assertIdle() {
  const busy = sql(`SELECT t.session_id FROM managed_agent_turn t JOIN managed_agent_session s ON s.session_id = t.session_id WHERE s.workspace_id = '${WS}' AND t.status NOT IN ('COMPLETED','FAILED','CANCELLED')`);
  if (busy.length) { console.error('RIG BUSY: unfinished Turns in ' + WS + ' ' + JSON.stringify(busy)); process.exit(2); }
}
