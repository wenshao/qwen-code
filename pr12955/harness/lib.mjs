// VERIFICATION RIG ONLY: helpers for probes against the Spring rig.
import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';

export const SP =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad';
export const R = `${SP}/rig`;
export const BASE = 'http://127.0.0.1:18955';
export const TENANT = process.env.TENANT ?? 't-g0';
export const DB = process.env.DB ?? 'g0pr';
export const MODEL_LOG = process.env.MODEL_LOG ?? `${R}/run/model-requests.jsonl`;
export const TAP_LOG = process.env.TAP_LOG ?? `${R}/run/tap.jsonl`;

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

export function sql(query, db = DB) {
  const r = spawnSync(
    '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql',
    ['-h127.0.0.1', '-P23955', '-uroot', '-prig12955', '-N', '-B', db, '-e', query],
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

export function register(workspace, storage, { actors = ['alice'], state = 'ACTIVE', config = 'managed-runtime-tools/1', policy = 'preapproved-workspace-tools/1', canCreate = true } = {}) {
  sql(
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','${config}','${policy}','${state}')`,
  );
  for (const a of actors) {
    sql(
      `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}','${a}',TRUE,${canCreate ? 'TRUE' : 'FALSE'})`,
    );
  }
}

export const modelCalls = () =>
  fs.existsSync(MODEL_LOG) ? fs.readFileSync(MODEL_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0;

export const tapEntries = () =>
  fs.existsSync(TAP_LOG)
    ? fs.readFileSync(TAP_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

export const turnRow = (session) =>
  sql(`SELECT turn_id, status, COALESCE(error_code,''), retry_count FROM managed_agent_turn WHERE session_id='${session}'`);

export async function waitTurn(session, { timeoutMs = 60_000, until = ['COMPLETED', 'FAILED', 'CANCELLED'] } = {}) {
  const start = Date.now();
  for (;;) {
    const rows = turnRow(session);
    if (rows.length && until.includes(rows[0][1])) return { rows, ms: Date.now() - start };
    if (Date.now() - start > timeoutMs) return { rows, ms: Date.now() - start, timeout: true };
    await sleep(250);
  }
}

export function liveWorkers() {
  try {
    return execSync(`pgrep -f 'wt-.*/dist/cli.js.*runtime-worker|runtime-worker.*wt-.*/dist/cli.js' || true`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean).length;
  } catch {
    return -1;
  }
}

export const g0Rest = (workspace, text, cwd = 'child') => ({
  agent_id: 'qwen-code',
  input: [{ type: 'input_text', text }],
  workspace: { workspace_id: workspace, cwd_relative: cwd },
});

export const g0WebShell = (workspace, key, text, cwd = 'child') => ({
  agentId: 'qwen-code',
  idempotencyKey: key,
  input: [{ type: 'input_text', text }],
  workspace: { workspaceId: workspace, cwdRelative: cwd },
});

export function out(file, obj) {
  fs.mkdirSync(`${R}/out`, { recursive: true });
  fs.writeFileSync(`${R}/out/${file}`, JSON.stringify(obj, null, 2));
}
