// VERIFICATION RIG ONLY (PR #13351): helpers for probes against one arm of the rig (ARM=head|base).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export const RIG = '/Users/wenshao/pr13351-rig';
const env = Object.fromEntries(
  fs
    .readFileSync(`${RIG}/rig.env`, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
export const ARM = process.env.ARM ?? 'head';
const O = { head: 1, base: 2 }[ARM];
if (!O) throw new Error(`unknown ARM ${ARM}`);
export const PORTS = { spring: 18350 + O, harness: 17350 + O, model: 15350 + O, wire: 19350 + O, vite: 5350 + O, tap: 16350 + O };
export const DB = `pr13351_${ARM}`;
export const RUN = `${RIG}/run/${ARM}`;
export const BASE = `http://127.0.0.1:${PORTS.spring}`;
export const TENANT = env.TENANT;
export const MODEL_LOG = `${RUN}/model-requests.jsonl`;
export const TAP_LOG = `${RUN}/tap.jsonl`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const j = (v) => JSON.stringify(v);

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
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, ms: Date.now() - started };
}

export function sql(query, db = DB) {
  const r = spawnSync(env.MYSQL, ['-h127.0.0.1', `-P${env.DBPORT}`, '-uroot', `-p${env.DBPASS}`, '-N', '-B', db, '-e', query], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
}
export const one = (q, db) => sql(q, db)[0]?.[0];

export function ensureWorkspace(workspace, storage, actors = ['alice']) {
  if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${workspace}'`) !== '0') return;
  sql(
    `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`,
  );
  for (const a of actors) sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}','${a}',TRUE,TRUE)`);
}

const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
export const modelEntries = (id) => lines(MODEL_LOG).map((l) => JSON.parse(l)).filter((e) => !id || e.id === id);
export const tapEntries = () => lines(TAP_LOG).map((l) => JSON.parse(l));
export const release = (id) => fetch(`http://127.0.0.1:${PORTS.model}/__rig/release?id=${id}`, { method: 'POST' }).then((r) => r.json());

export async function createSession(text, { workspace = 'ws-a', actor = 'alice', key = `k-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` } = {}) {
  const input = [{ type: 'input_text', text }];
  const r = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input, ...(workspace ? { workspace: { workspace_id: workspace } } : {}) }, { actor, key });
  return { ...r, session: r.json.id, key };
}
export function submit(session, text, { actor = 'alice', key = `s-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` } = {}) {
  return api('POST', `/v1/agents/sessions/${session}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text }] }, { actor, key });
}
export async function allEvents(session) {
  const out = [];
  let after = 0;
  for (;;) {
    const r = await api('GET', `/v1/agents/sessions/${session}/events?after=${after}&limit=100`);
    const page = r.json.data ?? [];
    out.push(...page);
    if (page.length < 100) return out;
    after = page.at(-1).sequence;
  }
}
export const eventText = (e) => (e?.data && typeof e.data.text === 'string' ? e.data.text : '');
export const turnRows = (session) => sql(`SELECT turn_id, status, COALESCE(error_code,''), COALESCE(error_message,'') FROM managed_agent_turn WHERE session_id='${session}' ORDER BY created_at`);
export const dbEvents = (session) => sql(`SELECT sequence_id, event_type, COALESCE(turn_id,''), COALESCE(source_key,''), COALESCE(item_id,''), data_json FROM managed_agent_event WHERE session_id='${session}' ORDER BY sequence_id`);
export const journal = (session) => sql(`SELECT journal_revision, first_sequence, last_sequence, LEFT(operation, 200) FROM qwen_managed_session_journal_tx WHERE session_id='${session}' ORDER BY journal_revision`);
