// VERIFICATION RIG ONLY: helpers for probes against the PR 13099 Spring rig.
import { spawnSync, execFileSync, spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';

export const SP =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad';
export const R = `${SP}/rig`;
export const BASE = 'http://127.0.0.1:18099';
export const TENANT = 't-13099';
export const DB = process.env.DB ?? 'rig';
export const MODEL_LOG = `${R}/run/model-requests.jsonl`;
export const TAP_LOG = `${R}/run/tap.jsonl`;
export const RULES = `${TAP_LOG}.rules.json`;
export const SPRING_LOG = `${SP}/logs/spring-${DB}.log`;
export const HARNESS_LOG = `${SP}/logs/harness-${DB}.log`;
const MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql';
const JDK = `${process.env.HOME}/Install/jdk21/bin`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(method, path, body, { key, actor = 'alice', tenant = TENANT } = {}) {
  const headers = { Accept: 'application/json' };
  if (tenant) headers['X-Qwen-Tenant-Id'] = tenant;
  if (actor) headers['X-Rig-Actor'] = actor;
  if (key) headers['Idempotency-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

export function sql(query, db = DB, delimiter) {
  const r = spawnSync(
    MYSQL,
    ['-h127.0.0.1', '-P23099', '-uroot', '-prig13099', '-N', '-B', ...(delimiter ? [`--delimiter=${delimiter}`] : []), db, '-e', query],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
}

export const one = (q, db) => sql(q, db)[0]?.[0];

export function register(workspace, storage, { actors = ['alice'], state = 'ACTIVE' } = {}) {
  sql(
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','${state}')`,
  );
  for (const a of actors) {
    sql(
      `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}','${a}',TRUE,TRUE)`,
    );
  }
}

const lines = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];

export const modelCalls = () => lines(MODEL_LOG).length;
export const tapEntries = () => lines(TAP_LOG).map((l) => JSON.parse(l));
export const springLines = () => lines(SPRING_LOG);
export const harnessLines = () => lines(HARNESS_LOG);

export const turnRow = (session) =>
  sql(
    `SELECT turn_id, status, COALESCE(error_code,''), retry_count, submission_attempted, COALESCE(harness_event_epoch,'-') FROM managed_agent_turn WHERE session_id='${session}'`,
  )[0];

export async function waitTurn(session, { timeoutMs = 60_000, until = ['COMPLETED', 'FAILED', 'CANCELLED'] } = {}) {
  const start = Date.now();
  for (;;) {
    const row = turnRow(session);
    if (row && until.includes(row[1])) return { row, ms: Date.now() - start };
    if (Date.now() - start > timeoutMs) return { row, ms: Date.now() - start, timeout: true };
    await sleep(200);
  }
}

export async function waitFor(check, { timeoutMs = 60_000, everyMs = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return undefined;
    await sleep(everyMs);
  }
}

export const create = (workspace, text, key, cwd = 'child') =>
  api(
    'POST',
    '/v1/agents/sessions',
    {
      agent_id: 'qwen-code',
      input: [{ type: 'input_text', text }],
      workspace: { workspace_id: workspace, cwd_relative: cwd },
    },
    { key },
  );

export function setRules(rules) {
  fs.writeFileSync(RULES, JSON.stringify(rules));
}
export function clearRules() {
  fs.rmSync(RULES, { force: true });
}

/** Public terminal events of a Session, as a client sees them. */
export async function terminalEvents(session) {
  const ev = await api('GET', `/v1/agents/sessions/${session}/events`);
  return (ev.json.data ?? []).filter((e) => e.terminal).map((e) => ({ type: e.type, data: e.data }));
}

/**
 * Dump the live JFR recording and return thrown exceptions whose class ends
 * with one of `classes`, oldest first: { t, ms, cls, message, frames[] }
 * (application frames only, innermost first). The text output is parsed as a
 * stream: a JVM start alone throws thousands of unrelated exceptions.
 */
export async function thrown(classes, { sinceMs = 0 } = {}) {
  const pid = fs.readFileSync(`${R}/run/spring.pid`, 'utf8').trim();
  const begin = `begin=-${Math.min(3600, Math.ceil((Date.now() - sinceMs) / 1000) + 5)}s`;
  const file = `${R}/run/dump-${Date.now()}.jfr`;
  execFileSync(`${JDK}/jcmd`, [pid, 'JFR.dump', 'name=rig', begin, `filename=${file}`], { encoding: 'utf8' });
  const child = spawn(`${JDK}/jfr`, ['print', '--stack-depth', '96', '--events', 'jdk.JavaExceptionThrow', file], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, TZ: 'UTC' },
  });
  const events = [];
  let cur;
  for await (const line of readline.createInterface({ input: child.stdout })) {
    const s = line.trim();
    if (s.startsWith('jdk.JavaExceptionThrow {')) cur = { frames: [] };
    else if (!cur) continue;
    else if (s.startsWith('startTime = ')) {
      const m = s.match(/startTime = (\S+) \((\d{4}-\d{2}-\d{2})\)/);
      cur.t = `${m[2]}T${m[1]}Z`;
      cur.ms = Date.parse(cur.t);
    } else if (s.startsWith('message = ')) cur.message = s.slice(10).replace(/^"|"$/g, '');
    else if (s.startsWith('thrownClass = ')) cur.cls = s.slice(14).split(' ')[0].split('.').pop();
    else if (s === '}') {
      if (classes.includes(cur.cls) && cur.ms >= sinceMs) events.push(cur);
      cur = undefined;
    } else {
      const f = s.match(/^com\.alibaba\.qwen\.[\w.$]*?([\w$]+)\.([\w$<>]+)\(.*\)\s+line: (\d+)/);
      if (f && f[2] !== '<init>') cur.frames.push(`${f[1]}.${f[2]}:${f[3]}`);
    }
  }
  fs.rmSync(file, { force: true });
  return events;
}

export function out(file, obj) {
  fs.mkdirSync(`${R}/out`, { recursive: true });
  fs.writeFileSync(`${R}/out/${file}`, JSON.stringify(obj, null, 2));
}
