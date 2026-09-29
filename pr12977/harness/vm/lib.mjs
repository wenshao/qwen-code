// PR #12977 rig helpers (run inside the dedicated Linux VM as the service user).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as d from './drive.mjs';
import * as H from './hosted-lib.mjs';
import { startFakeOpenAIServer, fakeToolCall } from './fake-openai-server.mjs';

export { d, H };
export const SHELL_PROFILE = 'hosted-workspace-shell/1';
export const MAINT_JAR = process.env.MAINT_JAR ?? '/opt/qwen/pr12977-operator-recovery.jar';
export const OUT = process.env.OUT ?? '/rig/out/e2e';
fs.mkdirSync(OUT, { recursive: true });

let logFile;
export function openLog(name) { logFile = path.join(OUT, `${name}.log`); fs.writeFileSync(logFile, ''); }
export const say = (...a) => { const line = `${new Date().toISOString().slice(11, 23)} ${a.join(' ')}`; console.log(line); if (logFile) fs.appendFileSync(logFile, line + '\n'); };
export const sleep = d.sleep;

export function env() {
  return Object.fromEntries(fs.readFileSync('/etc/qwen-w0e3.env', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
}
export const stateDir = () => `/var/lib/qwen-rt/${d.DB}`;

// ---- the operator's maintenance command, configured through the environment as the runbook says
export function maint(args, { extraEnv = {}, javaOpts = [], user } = {}) {
  const e = {
    PATH: '/opt/qwen/bin:/usr/local/bin:/usr/bin:/bin',
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:3306/${d.DB}?allowPublicKeyRetrieval=true&useSSL=false`,
    SPRING_DATASOURCE_USERNAME: 'root', SPRING_DATASOURCE_PASSWORD: 'rootpw',
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: stateDir(),
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_PROVISIONER: 'local-process',
    QWEN_MANAGED_AGENT_RUNTIME_OPERATOR_RECOVERY_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'rig',
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: '<rig-credential-key>',
    ...extraEnv };
  for (const [k, v] of Object.entries(e)) if (v === null) delete e[k];
  const argv = ['/opt/qwen/jdk/bin/java', ...javaOpts, '-jar', MAINT_JAR, ...args];
  const cmd = user ? 'sudo' : argv[0];
  const cmdArgs = user ? ['-u', user, 'env', ...Object.entries(e).map(([k, v]) => `${k}=${v}`), ...argv] : argv.slice(1);
  const t0 = Date.now();
  const r = spawnSync(cmd, cmdArgs, { env: e, encoding: 'utf8', timeout: 180000, cwd: '/tmp' });
  const all = `${r.stdout}\n${r.stderr}`;
  const stdoutLines = r.stdout.split('\n').filter((l) => l.trim());
  // Spring logs share stdout; the command's own result is its last non-log line.
  const result = stdoutLines.filter((l) => !/^\d{4}-\d\d-\d\dT| INFO | WARN |^\s+\.   ____|^ \/\\\\|^\( \( \)|^ \\\\\/|^  '  \||^ ={5,}|^ :: Spring/.test(l)).pop() ?? '';
  const cause = [...all.matchAll(/(?:Exception|Error): ([^\n]+)/g)].map((m) => m[1]).filter((m) => !/^\s*$/.test(m));
  return { code: r.status, signal: r.signal, ms: Date.now() - t0, result, cause: cause.at(-1) ?? '', stdout: r.stdout, stderr: r.stderr };
}
export function sayMaint(label, r) {
  say(`  maint ${label}: exit=${r.code}${r.signal ? ` signal=${r.signal}` : ''} ${r.ms} ms -> ${r.code === 0 ? r.result : `REFUSED: ${r.cause}`}`);
  fs.writeFileSync(path.join(OUT, `maint-${label.replace(/[^a-z0-9-]+/gi, '_')}.txt`), `${r.stdout}\n----stderr----\n${r.stderr}`);
  return r;
}

// ---- SQL facts
export const q1 = (query) => d.sql(query)[0] ?? [];
export function binding(sid) {
  const r = q1(`SELECT binding_id, runtime_generation, binding_state, record_version, IFNULL(operation_owner,'-'), operation_generation,
    IF(loss_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.source'))),
    IF(stop_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.source'))), drain_requested
    FROM qwen_runtime_binding WHERE isolation_key='${sid}' ORDER BY runtime_generation DESC LIMIT 1`);
  return { id: r[0], gen: Number(r[1]), state: r[2], ver: r[3], opOwner: r[4], opGen: r[5], loss: r[6], stop: r[7], drain: r[8] };
}
export const bstr = (b) => `binding ${b.id?.slice(0, 8)} gen=${b.gen} state=${b.state} v=${b.ver} opOwner=${b.opOwner} loss=${b.loss} stop=${b.stop}`;
export function holder(storage) {
  const r = q1(`SELECT IFNULL(holder_key,'<none>'), IFNULL(binding_id,'<none>'), IFNULL(runtime_generation,0), IFNULL(runtime_session_id,'<none>')
    FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${storage}'), 256)`);
  return { key: r[0] ?? '<no row>', bid: r[1], gen: r[2], rsid: r[3] };
}
export const hstr = (h) => `holder ${h.key === '<none>' || h.key === '<no row>' ? h.key : h.key.slice(0, 12) + '…'} (binding ${h.bid?.slice(0, 8)} gen=${h.gen} rsid=${h.rsid?.slice(0, 8)})`;
export function audit() {
  return d.sql(`SELECT LEFT(recovery_id,8), LEFT(binding_id,8), runtime_generation, operator_id, reason, IFNULL(LEFT(attestation_sha256,12),'-'),
    IF(attested_at IS NULL,'-','set'), IF(completed_at IS NULL,'-','set'), blocked_execution_call_id FROM managed_workspace_operator_recovery ORDER BY prepared_at`);
}
export const astr = () => audit().map((r) => `audit ${r[0]} binding=${r[1]} gen=${r[2]} operator=${r[3]} reason="${r[4]}" attestation=${r[5]} attested=${r[6]} completed=${r[7]}`).join('\n') || 'audit: (no rows)';
export function executions(bid) {
  return d.sql(`SELECT tool_call_id, execution_state, IFNULL(JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.capture.captureStatus')),'-'),
    IFNULL(JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.capture.captureReason')),'-'), LEFT(execution_call_id,8), JSON_UNQUOTE(JSON_EXTRACT(reference_json,'$.toolName'))
    FROM qwen_tool_execution ${bid ? `WHERE binding_id='${bid}'` : ''} ORDER BY execution_call_id`);
}

// ---- host facts
export const sh = (c) => execFileSync('bash', ['-c', c], { encoding: 'utf8' }).trim();
export function workerPids() {
  return sh("for p in $(pgrep -x node || true); do tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -q 'managed-runtime-worker' && echo $p; done || true").split('\n').filter(Boolean).map(Number);
}
export function registrations() {
  // The Broker's durable registration files (JSON) in the private state directory.
  const dir = stateDir(); const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); out.push({ file: f, ...j }); } catch (e) { out.push({ file: f, error: String(e) }); }
  }
  return out;
}
export function markerLines(storage) { try { return fs.readFileSync(`/srv/ws/${storage}/project/escaped-marker`, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } }
export function escapedPids() {
  return sh("for p in $(pgrep -f 'escaped-marker' || true); do [ \"$p\" != \"$$\" ] && tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -q '^sh -c i=0' && echo $p; done || true").split('\n').filter(Boolean).map(Number);
}
export function procIds(pid) { try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); const f = s.slice(s.lastIndexOf(')') + 2).split(' '); return { ppid: f[1], pgid: f[2], sid: f[3] }; } catch { return null; } }
export function shellCalls(storage) { try { return fs.readFileSync(`/srv/ws/${storage}/project/.shell-calls`, 'utf8').split('\n').filter(Boolean); } catch { return []; } }

// ---- scripted model: the prompt text chooses the Shell command
export const ESCAPE_CMD = `echo "call escape $(date +%s.%N)" >> .shell-calls; setsid sh -c 'i=0; while :; do i=$((i+1)); echo "seq=$i at=$(date +%s.%N) pid=$$" >> escaped-marker; sleep 0.5; done' & echo "escaped writer started"`;
export async function startModel() {
  return startFakeOpenAIServer(({ body }) => {
    const messages = body.messages;
    const lastUser = messages.findLastIndex((m) => m.role === 'user');
    const text = JSON.stringify(messages[lastUser]?.content ?? '');
    const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
    if (receipts.length) return { content: `DONE after ${receipts.length} tool result(s)` };
    let command;
    let m;
    if (/ESCAPE/.test(text)) command = ESCAPE_CMD;
    else if ((m = text.match(/HELLO (\w+)/))) command = `echo "call hello ${m[1]} $(date +%s.%N)" >> .shell-calls; echo "hello from ${m[1]}" > hello-${m[1]}.txt; cat hello-${m[1]}.txt`;
    else if ((m = text.match(/SLEEP (\d+)/))) command = `echo "call sleep ${m[1]} $(date +%s.%N)" >> .shell-calls; perl -e 'select(undef,undef,undef,${m[1]})'; echo "slept ${m[1]}"`;
    else return { content: 'nothing to do' };
    return { content: 'Running a Shell command.', toolCalls: [fakeToolCall('run_shell_command', { command, is_background: false, description: 'rig command' })] };
  });
}

export async function startHarness(tag) {
  const model = await startModel();
  const proxy = await H.startBrokerProxy('http://127.0.0.1:4182');
  const h = await new H.Harness({ name: tag, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
  return { model, proxy, h, async stop() { await h.stop(); await proxy.close(); await model.close(); } };
}
export async function shellSession(h, workspace) {
  const sid = await d.createSession(workspace);
  const s = new H.HSession(h, sid, workspace);
  const r = await s.h.json('/session', { sessionId: sid, sessionScope: 'thread', managedSessionStore: s.connection, toolProfile: SHELL_PROFILE });
  if (r.status === 200) s.clientId = r.json.clientId;
  s.createStatus = r.status;
  return s;
}
export function turnSummary(r) {
  const tools = [];
  for (const e of r.events ?? []) for (const p of e.data?.record?.message?.parts ?? []) {
    if (p.functionResponse) { const resp = p.functionResponse.response ?? {}; tools.push(`${p.functionResponse.name}: ${JSON.stringify(resp).slice(0, 220)}`); }
  }
  const errs = (r.terminal ?? []).filter((t) => t.type === 'turn_error').map((t) => JSON.stringify(t.data).slice(0, 240));
  return `${H.summarize(r)}${tools.length ? `\n      tool result: ${tools.join(' | ')}` : ''}${errs.length ? `\n      turn_error: ${errs.join(' | ')}` : ''}`;
}
export function seedWs(storage) { try { d.seed(`ws-${storage}`, `st-${storage}`); } catch { /* already seeded */ } }

export function writeEvidence(name, recoveryId, overrides = {}, mode = 0o600) {
  const file = path.join(stateDir(), name);
  const body = { version: 1, recoveryId, verifiedAt: new Date(Date.now() - 1000).toISOString().replace(/\.\d+Z$/, 'Z'),
    method: 'host inspection (ps, /proc/*/fd, fuser on the Workspace)', actions: 'Killed registered worker and the setsid writer; confirmed escaped-marker stopped growing for 5 s; rig has no restart source for the writer', restartPrevention: true, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete body[k];
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, typeof overrides.__raw === 'string' ? overrides.__raw : JSON.stringify(body), { mode });
  fs.chmodSync(file, mode);
  return file;
}
