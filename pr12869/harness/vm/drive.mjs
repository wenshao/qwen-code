// PR #12869 verification rig driver. Runs inside the dedicated Linux VM.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const env = Object.fromEntries(fs.readFileSync('/etc/qwen-w0e3.env', 'utf8').split('\n')
  .filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
export const DB = process.env.DB ?? env.DB;
export const TENANT = 't-rig';
export const TOKEN = 'rig-broker-token-12869';
export const API = 'http://127.0.0.1:8080';
export const BROKER = 'http://127.0.0.1:4182/internal/runtime-broker/v1';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => new Date().toISOString();

export function sql(query, { header = false } = {}) {
  const out = execFileSync('docker', ['exec', 'w0e3-db', 'mysql', '-uroot', '-prootpw', header ? '-t' : '-N', ...(header ? [] : ['-B']), DB, '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return header ? out : out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}

export function seed(workspace, storage, actors = ['alice']) {
  sql(`INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','${workspace}',1,'${storage}','${workspace}','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`);
  for (const actor of actors) sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','${workspace}',CAST('${actor}' AS BINARY),TRUE,TRUE)`);
}

export async function http(method, url, { headers = {}, body, timeoutMs = 130000 } = {}) {
  const started = Date.now();
  try {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, json: { error: String(error?.cause?.code ?? error?.message ?? error) }, ms: Date.now() - started };
  }
}

export async function createSession(workspace, cwd = 'project', actor = 'alice') {
  const res = await http('POST', `${API}/v1/agents/sessions`, {
    headers: { 'X-Qwen-Tenant-Id': TENANT, 'X-Rig-Actor': actor, 'Idempotency-Key': randomUUID() },
    body: { agent_id: 'qwen-code', workspace: { workspace_id: workspace, cwd_relative: cwd } } });
  if (res.status >= 300) throw new Error(`create session: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id ?? res.json.session_id ?? res.json.sessionId;
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const base = (extra) => ({ protocolVersion: 1, requestId: `rq-${randomUUID()}`, ...extra });
export const warm = (sid, opts) => http('POST', `${BROKER}/runtimes:warm`, { headers: auth, body: base({ harnessSessionId: sid }), ...opts });
export const acquire = (sid, rsid, opts) => http('POST', `${BROKER}/tool-sessions:acquire`, { headers: auth,
  body: base({ harnessSessionId: sid, runtimeSessionId: rsid, turnKind: 'bootstrap' }), ...opts });
export const release = (sid, rsid) => http('POST', `${BROKER}/tool-sessions/${rsid}:release`, { headers: auth, body: base({ harnessSessionId: sid }) });
export function shellRef(rsid, callId, command) {
  return { sessionId: rsid, promptId: 'prompt-1', callId, argsDigest: `digest-${callId}`, toolName: 'run_shell_command',
    input: { command, is_background: false } };
}
export const create = (sid, rsid, callId, command, opts) => http('POST', `${BROKER}/executions`, { headers: auth,
  body: base({ idempotencyKey: `idem-${sid}-${callId}`, harnessSessionId: sid, runtimeSessionId: rsid, turnId: 'prompt-1',
    toolCallId: callId, requestDigest: `digest-${callId}`, reference: shellRef(rsid, callId, command) }), ...opts });
export const status = (sid, rsid, exec) => http('GET',
  `${BROKER}/executions/${exec}?requestId=rq-${randomUUID()}&harnessSessionId=${sid}&runtimeSessionId=${rsid}`, { headers: auth });

export function snapshot() {
  const out = [];
  out.push(sql(`SELECT LEFT(binding_id,8) bid, runtime_generation gen, binding_state state, storage_id storage, record_version ver,
    IFNULL(operation_owner,'-') op_owner, IF(loss_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.source'))) loss_source,
    IF(stop_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.source'))) stop_source,
    IFNULL(runtime_endpoint,'-') endpoint FROM qwen_runtime_binding ORDER BY storage_id, runtime_generation`, { header: true }));
  out.push(sql(`SELECT LEFT(binding_id,8) bid, runtime_generation gen, runtime_session_id rsid, session_state state FROM qwen_runtime_session ORDER BY binding_id, runtime_generation`, { header: true }));
  out.push(sql(`SELECT LEFT(binding_id,8) bid, runtime_generation gen, tool_call_id call_id, execution_state state, IF(result_json IS NULL,'-','present') result FROM qwen_tool_execution ORDER BY binding_id, tool_call_id LIMIT 20`, { header: true }));
  out.push(sql(`SELECT LEFT(storage_key,8) storage_key, IFNULL(LEFT(holder_key,8),'<none>') holder, IFNULL(LEFT(binding_id,8),'<none>') bid, IFNULL(runtime_generation,0) gen, IFNULL(runtime_session_id,'<none>') rsid FROM managed_workspace_execution_lease ORDER BY storage_key`, { header: true }));
  return out.join('\n');
}

export function hostFacts() {
  const read = (p) => fs.readFileSync(p, 'utf8').trim();
  return { machine_id: read('/etc/machine-id'), boot_id: read('/proc/sys/kernel/random/boot_id'),
    uptime_s: Number(read('/proc/uptime').split(' ')[0]), kernel: read('/proc/sys/kernel/osrelease') };
}

export function workers() {
  return execFileSync('sh', ['-c', "ps -eo pid,ppid,stat,lstart,args | grep -E 'managed-runtime-worker|escaped-writer|qwen.*server.jar' | grep -v grep | cut -c1-170 || true"], { encoding: 'utf8' });
}
