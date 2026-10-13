// PR 13986 scenario driver — runs ON the Linux host inside the rig. Derived
// from the H3 acceptance driver: production surfaces only (Spring public
// sessions, the hosted Harness session routes, the Runtime Broker HTTP API,
// the scripted fake model), plus host observation (SQL, cgroup, /proc).
// Every command prints [OBS] lines and one [RESULT] JSON line, and appends
// both to out/<case>/observations.log.
// usage: node driver.mjs <cmd> <case> [arg]
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const E = process.env;
const RIG = '/root/pr13986-rig';
const OUT = path.join(RIG, 'out');
const CGROUP_ROOT = '/sys/fs/cgroup/qwen-pr13986';
const TENANT = 't-13986';
const ACTOR = 'rig-actor';
const SPRING = 'http://127.0.0.1:18986';
const BROKER = 'http://127.0.0.1:18987';
const HARNESS = 'http://127.0.0.1:18988';
const PROXY = 'http://127.0.0.1:18989';
const FAKE = 'http://127.0.0.1:19986';
const secret = (n) => fs.readFileSync(path.join(RIG, 'secrets', n), 'utf8').trim();
const HARNESS_TOKEN = secret('harness-token');
const BROKER_TOKEN = secret('broker-token');
const DB_SOCKET = path.join(RIG, 'db/s.sock');
const DB_NAME = E.DB_NAME ?? 'q13986';
const DB_PASS = 'r13986';

let caseDir = OUT;
let counter = 0;
const stamp = () => new Date().toISOString().slice(11, 23);
function emit(line) {
  console.log(line);
  fs.appendFileSync(path.join(caseDir, 'observations.log'), `${stamp()} ${line}\n`);
}
const obs = (label, value) => emit(`[OBS ${String(++counter).padStart(2, '0')}] ${label} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
const result = (named, value) => emit(`[RESULT] ${named} ${JSON.stringify(value)}`);
function caseInit(name) {
  caseDir = path.join(OUT, name);
  fs.mkdirSync(caseDir, { recursive: true });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sql(query) {
  try {
    const out = execFileSync('mysql', ['--socket', DB_SOCKET, '-uroot', `-p${DB_PASS}`, '-N', '-B', DB_NAME, '-e', query], { encoding: 'utf8' });
    return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
  } catch (e) {
    return [[`SQLERR ${String(e.stderr ?? e.message).slice(0, 300)}`]];
  }
}

async function http(method, url, { headers = {}, body, timeoutMs = 60000 } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method, headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json, text: text.slice(0, 2000), headers: Object.fromEntries(res.headers), ms: Date.now() - t0 };
  } catch (e) {
    return { status: 'ERR', text: String(e), ms: Date.now() - t0, headers: {} };
  }
}

const springApi = (method, url, { body, idem } = {}) => http(method, `${SPRING}${url}`, {
  headers: { 'content-type': 'application/json', 'X-Qwen-Tenant-Id': TENANT, 'X-Rig-Actor': ACTOR, ...(idem ? { 'Idempotency-Key': idem } : {}) },
  body,
});
const HARNESS_HEADERS = { 'content-type': 'application/json', authorization: `Bearer ${HARNESS_TOKEN}`, 'x-qwen-harness-protocol-version': '1' };
function harnessApi(method, url, body, bootId, clientId, timeoutMs) {
  return http(method, `${HARNESS}${url}`, {
    headers: { ...HARNESS_HEADERS, ...(bootId ? { 'x-qwen-harness-boot-id': bootId } : {}), ...(clientId ? { 'x-qwen-client-id': clientId } : {}) },
    body, timeoutMs,
  });
}
const brokerApi = (method, url, body) => http(method, `${BROKER}/internal/runtime-broker/v1${url}`, {
  headers: { authorization: `Bearer ${BROKER_TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  body,
});

async function harnessBootId() {
  let last = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = await http('POST', `${HARNESS}/session`, { headers: HARNESS_HEADERS, body: {} });
    last = probe;
    const id = probe.headers['x-qwen-harness-boot-id'];
    if (id) return id;
    await sleep(1500);
  }
  throw new Error(`harness boot id probe failed: ${last?.status} ${last?.text}`);
}

// ---- host observation ----
function units() {
  try {
    return fs.readdirSync(CGROUP_ROOT).filter((n) => n.startsWith('qwen-')).map((unit) => {
      const read = (f) => { try { return fs.readFileSync(path.join(CGROUP_ROOT, unit, f), 'utf8').trim(); } catch { return null; } };
      return { unit: unit.slice(0, 40), populated: read('cgroup.events')?.match(/populated (\d)/)?.[1] ?? null };
    });
  } catch (e) { return [{ error: String(e) }]; }
}
// Processes whose command line carries the case's unique token.
function tokenProcs(token) {
  const out = [];
  for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
      if (cmd.includes(token) && !cmd.includes('driver.mjs') && !cmd.includes('mysql')) out.push({ pid: Number(pid), cmd: cmd.slice(0, 100) });
    } catch { /* raced exit */ }
  }
  return out;
}

const q = (s) => s.replaceAll("'", "''");
function runtimeSessions(springId) {
  return sql(`SELECT runtime_session_id, session_state, turn_kind, binding_id, runtime_generation FROM qwen_runtime_session WHERE harness_session_id='${q(springId)}' ORDER BY last_active_at`)
    .map(([id, state, kind, binding, gen]) => ({ id: id?.slice(0, 48), state, kind, binding: binding?.slice(0, 12), gen }));
}
function holdRows(springId) {
  return sql(`SELECT runtime_session_id, execution_state, execution_status, JSON_VALUE(reference_json, '$.dispatchMode') FROM qwen_tool_execution WHERE harness_session_id='${q(springId)}' ORDER BY execution_call_id_hash`)
    .map(([rs, st, status, mode]) => ({ rs: rs?.slice(0, 48), st, status, mode }));
}
function bindings() {
  return sql('SELECT binding_id, binding_state, runtime_generation FROM qwen_runtime_binding').map(([b, s, g]) => ({ b: b?.slice(0, 12), s, g }));
}
function childRecord(springId, kind) {
  const rows = sql(`SELECT resource_id, convert(inline_bytes using utf8) FROM qwen_managed_session_resource WHERE session_id='${q(springId)}' AND kind LIKE '%${kind}%' ORDER BY created_at DESC, resource_id DESC LIMIT 1`);
  if (!rows.length || rows[0][0].startsWith('SQLERR')) return { found: false, raw: rows[0]?.[0] };
  try {
    const p = JSON.parse(rows[0][1]);
    return { found: true, state: p.run?.state ?? p.state ?? null, stopReason: p.stopReason ?? null, stopRequested: p.stopRequested ?? null, exitCode: p.exitCode ?? null, exitSignal: p.exitSignal ?? null };
  } catch { return { found: true, unparsed: rows[0][1]?.slice(0, 200) }; }
}

function saveState(name, state) { fs.writeFileSync(path.join(OUT, `${name}.state.json`), JSON.stringify(state, null, 2)); }
function loadState(name) { return JSON.parse(fs.readFileSync(path.join(OUT, `${name}.state.json`), 'utf8')); }

function snapshot(st, label) {
  const s = {
    label,
    rs: runtimeSessions(st.springId),
    holds: holdRows(st.springId),
    bindings: bindings(),
    procs: tokenProcs(st.token).map((p) => p.pid),
    units: units().map((u) => `${u.unit}:${u.populated}`),
    record: childRecord(st.springId, st.recordKind ?? 'child_run'),
  };
  obs(`state[${label}]`, s);
  fs.writeFileSync(path.join(caseDir, `snap-${label}.json`), JSON.stringify(s, null, 2));
  return s;
}

function storeDescriptor(st, bootId) {
  return {
    baseUrl: SPRING, tenantId: TENANT, workspaceId: st.workspaceId, writerId: bootId,
    leaseDurationMs: st.leaseMs ?? 20000, allowInsecureHttp: true,
  };
}

// ============ commands ============
async function cmdSession(name, optsJson) {
  const o = optsJson ? JSON.parse(optsJson) : {};
  caseInit(name);
  const marker = o.marker ?? `P13986_${name.toUpperCase().replaceAll('-', '_')}`;
  const token = o.token ?? `${Math.floor(100000 + Math.random() * 800000)}`;
  const command = (o.command ?? 'echo BG-START; sleep TOKEN; echo BG-END').replaceAll('TOKEN', token);
  const toolName = o.toolName ?? 'run_shell_command';
  const input = o.input ? JSON.parse(JSON.stringify(o.input).replaceAll('TOKEN', token)) : { command, is_background: true };
  const workspaceId = `ws-${o.workspace ?? 'a'}`;
  const profile = o.profile ?? 'hosted-workspace-shell/2';
  const captureBytes = o.captureBytes ?? 268435456;
  const leaseMs = o.leaseMs ?? 20000;
  if (!o.keepScript) {
    const s = await http('PUT', `${FAKE}/script`, { headers: { 'content-type': 'application/json' }, body: { script: [
      { match: marker, tool: { name: toolName, args: input } },
      { match: 'P13986_', content: `settled-${marker}` },
    ] } });
    obs('fake model scripted', { marker, toolName, input, status: s.status });
  }
  const created = await springApi('POST', '/v1/agents/sessions', { idem: `${name}-${randomUUID()}`, body: { agent_id: 'qwen-code', workspace: { workspace_id: workspaceId } } });
  if (![200, 201, 202].includes(created.status)) throw new Error(`spring session create ${created.status}: ${created.text}`);
  const springId = created.json.id;
  obs('spring public session', { springId, status: created.json.status, workspaceId });
  const bootId = await harnessBootId();
  const st = { springId, bootId, marker, token, workspaceId, profile, captureBytes, leaseMs, toolName, input, recordKind: toolName === 'monitor' ? 'monitor_run' : 'child_run' };
  const hosted = await harnessApi('POST', '/session', {
    sessionId: springId, sessionScope: 'thread', toolProfile: profile, captureBytes, approvalMode: 'yolo',
    managedSessionStore: storeDescriptor(st, bootId),
  }, bootId);
  obs('harness session create', { status: hosted.status, ms: hosted.ms, body: hosted.json ?? hosted.text });
  if (hosted.status !== 200 && hosted.status !== 201) throw new Error(`hosted session create failed ${hosted.status}: ${hosted.text}`);
  st.clientId = hosted.json?.clientId;
  saveState(name, st);
  if (o.noPrompt) return result('session', { springId, token });
  await cmdPrompt(name, `${marker} start the requested background work`);
  result('session', { springId, token });
}

async function cmdPrompt(name, text) {
  caseInit(name);
  const st = loadState(name);
  const prompt = [{ type: 'text', text: text ?? `${st.marker} follow-up` }];
  const digest = `sha256:${createHash('sha256').update(JSON.stringify(prompt)).digest('hex')}`;
  const promptId = randomUUID();
  const r = await harnessApi('POST', `/session/${st.springId}/prompt`, { promptId, prompt, payloadDigest: digest }, st.bootId, st.clientId);
  obs('prompt', { status: r.status, body: r.json ?? r.text, promptId });
  st.promptIds = [...(st.promptIds ?? []), promptId];
  saveState(name, st);
  result('prompt', { status: r.status });
}

// Wait until the Harness reports no active prompt (or the timeout).
async function cmdSettle(name, timeoutS = '180') {
  caseInit(name);
  const st = loadState(name);
  const t0 = Date.now();
  let last;
  while ((Date.now() - t0) / 1000 < Number(timeoutS)) {
    const s = await harnessApi('GET', `/session/${st.springId}/status`, undefined, st.bootId, st.clientId);
    last = s.json ?? s.text;
    if (s.status === 200 && s.json && !s.json.hasActivePrompt) break;
    await sleep(1500);
  }
  obs('turn settled', { after_s: Math.round((Date.now() - t0) / 100) / 10, status: last });
  const snap = snapshot(st, 'settled');
  result('settle', { status: last, rs: snap.rs.map((r) => `${r.kind}:${r.state}`), holds: snap.holds.map((h) => `${h.mode}:${h.st}`), procs: snap.procs.length });
}

async function cmdSnap(name, label = 'snap') {
  caseInit(name);
  const snap = snapshot(loadState(name), label);
  result('snap', { rs: snap.rs.map((r) => `${r.kind}:${r.state}`), holds: snap.holds.map((h) => `${h.mode}:${h.st}`), procs: snap.procs.length, record: snap.record });
}

async function cmdHolds(name) {
  caseInit(name);
  const st = loadState(name);
  const r = await brokerApi('POST', '/tool-sessions:active-holds', { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: st.springId });
  obs('broker active-holds', { status: r.status, ms: r.ms, body: r.json ?? r.text });
  result('holds', { status: r.status, ids: r.json?.heldRuntimeSessionIds ?? null, code: r.json?.code ?? null });
}

async function cmdRelease(name, mode) {
  caseInit(name);
  const st = loadState(name);
  const target = sql(`SELECT runtime_session_id FROM qwen_tool_execution WHERE harness_session_id='${q(st.springId)}' AND reference_json LIKE '%background_v3%' LIMIT 1`)[0]?.[0];
  const r = await brokerApi('POST', `/tool-sessions/${encodeURIComponent(target)}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: st.springId, ...(mode === 'drain' ? { drain: true } : {}) });
  obs('broker release', { target: target?.slice(0, 48), mode: mode ?? 'routine', status: r.status, body: r.json ?? r.text });
  result('release', { status: r.status, code: r.json?.code ?? null });
}

async function cmdRestartHarness(name, signal = 'TERM') {
  caseInit(name);
  const pid = Number(fs.readFileSync(path.join(RIG, 'harness.pid'), 'utf8').trim());
  const t0 = Date.now();
  try { process.kill(pid, `SIG${signal}`); obs(`SIG${signal} harness pid ${pid}`, 'sent'); } catch (e) { obs(`SIG${signal} harness pid ${pid}`, String(e)); }
  for (let i = 0; i < 240; i++) { if (!fs.existsSync(`/proc/${pid}`)) break; await sleep(250); }
  obs('harness exited', { gone: !fs.existsSync(`/proc/${pid}`), after_ms: Date.now() - t0 });
  const st = loadState(name);
  snapshot(st, `after-${signal.toLowerCase()}`);
  const up = execFileSync('bash', [path.join(RIG, 'rig-up.sh'), 'harness'], { encoding: 'utf8', cwd: RIG, env: process.env });
  obs('harness boot', up.trim().split('\n').slice(-1)[0]);
  result('restart-harness', { signal });
}

async function cmdLoad(name) {
  caseInit(name);
  const st = loadState(name);
  const bootId = await harnessBootId();
  const t0 = Date.now();
  let r;
  for (let attempt = 0; attempt < 40; attempt++) {
    r = await harnessApi('POST', `/session/${st.springId}/load`, {
      toolProfile: st.profile, captureBytes: st.captureBytes, managedSessionStore: storeDescriptor(st, bootId),
    }, bootId, undefined, 90000);
    obs('load attempt', { attempt, status: r.status, ms: r.ms, code: r.json?.code ?? r.json?.error ?? null });
    if (r.status === 200 || r.status === 201) break;
    // A SIGKILLed writer keeps its lease until expiry: retry that refusal only.
    if (!(r.status === 409 || r.status === 503)) break;
    await sleep(3000);
  }
  obs('load answer', { status: r.status, total_ms: Date.now() - t0, body: r.json ?? r.text });
  if (r.status === 200 || r.status === 201) {
    st.bootId = bootId;
    st.clientId = r.json?.clientId;
    saveState(name, st);
  }
  result('load', { status: r.status, ms: r.ms, total_ms: Date.now() - t0 });
}

async function cmdClose(name, verb = 'DELETE') {
  caseInit(name);
  const st = loadState(name);
  const r = verb === 'detach'
    ? await harnessApi('POST', `/session/${st.springId}/detach`, {}, st.bootId, st.clientId, 120000)
    : await harnessApi('DELETE', `/session/${st.springId}`, undefined, st.bootId, st.clientId, 120000);
  obs(`${verb} answer`, { status: r.status, ms: r.ms, body: r.json ?? r.text });
  await sleep(3000);
  const snap = snapshot(st, `after-${verb.toLowerCase()}`);
  result('close', { verb, status: r.status, ms: r.ms, rs: snap.rs.map((x) => `${x.kind}:${x.state}`), holds: snap.holds.map((h) => `${h.mode}:${h.st}`), procs: snap.procs.length, record: snap.record });
}

async function cmdWaitProc(name, timeoutS = '120') {
  caseInit(name);
  const st = loadState(name);
  const t0 = Date.now();
  let p = [];
  while ((Date.now() - t0) / 1000 < Number(timeoutS)) {
    p = tokenProcs(st.token);
    if (p.length) break;
    await sleep(1000);
  }
  obs('token procs', { after_s: Math.round((Date.now() - t0) / 100) / 10, procs: p });
  result('wait-proc', { procs: p.length });
}

async function cmdWaitGone(name, timeoutS = '60') {
  caseInit(name);
  const st = loadState(name);
  const t0 = Date.now();
  let p = tokenProcs(st.token);
  while (p.length && (Date.now() - t0) / 1000 < Number(timeoutS)) { await sleep(1000); p = tokenProcs(st.token); }
  obs('token procs gone?', { after_s: Math.round((Date.now() - t0) / 100) / 10, left: p.length });
  result('wait-gone', { left: p.length });
}

async function cmdSql(_name, query) { console.log(sql(query).map((r) => r.join(' | ')).join('\n')); }

async function cmdProxy(_name, rulesJson) {
  const r = await http('PUT', `${PROXY}/__rig/rules`, { headers: { 'content-type': 'application/json' }, body: rulesJson ?? '[]' });
  console.log(`[RESULT] proxy ${JSON.stringify({ status: r.status, body: r.json })}`);
}
async function cmdRestartSpring(name) {
  caseInit(name);
  const pid = Number(fs.readFileSync(path.join(RIG, 'spring.pid'), 'utf8').trim());
  const t0 = Date.now();
  try { process.kill(pid, 'SIGTERM'); } catch (e) { obs('spring TERM', String(e)); }
  for (let i = 0; i < 80; i++) { if (!fs.existsSync(`/proc/${pid}`)) break; await sleep(250); }
  if (fs.existsSync(`/proc/${pid}`)) { process.kill(pid, 'SIGKILL'); await sleep(1000); }
  obs('spring stopped', { pid, after_ms: Date.now() - t0 });
  const up = execFileSync('bash', [path.join(RIG, 'rig-up.sh')], { encoding: 'utf8', cwd: RIG, env: process.env });
  obs('spring boot', up.trim().split('\n').slice(-1)[0]);
  // Give the Broker's startup reconciliation a moment to observe live rows.
  await sleep(8000);
  const snap = snapshot(loadState(name), 'after-spring-restart');
  result('restart-spring', { rs: snap.rs.map((r) => `${r.kind}:${r.state}`), holds: snap.holds.map((h) => `${h.mode}:${h.st}`), procs: snap.procs.length });
}

// The latest tool outcome and turn result of a Session (for the next-Session probe).
async function cmdOutcome(name) {
  caseInit(name);
  const st = loadState(name);
  const pick = (kind) => sql(`SELECT convert(inline_bytes using utf8) FROM qwen_managed_session_resource WHERE session_id='${q(st.springId)}' AND kind='${kind}' ORDER BY created_at DESC, resource_id DESC LIMIT 1`)[0]?.[0] ?? null;
  const outcome = pick('managed-tool-outcome');
  const turn = pick('managed-turn-result');
  let o = null, t = null;
  try { const p = JSON.parse(outcome); o = { decision: p.decision, status: p.envelope?.executionStatus, text: JSON.stringify(p.envelope?.responseParts ?? p.envelope ?? p).slice(0, 300) }; } catch { o = outcome?.slice(0, 300) ?? null; }
  try { const p = JSON.parse(turn); t = p.systemPayload ?? p; } catch { t = turn?.slice(0, 200) ?? null; }
  obs('tool outcome', o);
  obs('turn result', t);
  result('outcome', { tool: o, turn: t });
}

// Retry the DELETE: <case> "<n>x<intervalS>"
async function cmdCloseRetry(name, spec = '4x30') {
  caseInit(name);
  const st = loadState(name);
  const [n, every] = spec.split('x').map(Number);
  let r;
  for (let i = 1; i <= n; i++) {
    await sleep(every * 1000);
    r = await harnessApi('DELETE', `/session/${st.springId}`, undefined, st.bootId, st.clientId, 120000);
    obs(`DELETE retry ${i} (+${i * every}s)`, { status: r.status, ms: r.ms, body: r.json ?? r.text });
    if (r.status === 204 || r.status === 404) break;
  }
  await sleep(2000);
  const snap = snapshot(st, 'after-retries');
  result('close-retry', { last: r.status, rs: snap.rs.map((x) => `${x.kind}:${x.state}`), holds: snap.holds.map((h) => `${h.mode}:${h.st}`), procs: snap.procs.length });
}

async function cmdProxyLog(name) {
  caseInit(name);
  const r = await http('GET', `${PROXY}/__rig/log`);
  const holds = (r.json ?? []).filter((e) => e.path.endsWith('active-holds'));
  obs('proxy active-holds log', holds);
  result('proxy-log', { requests: (r.json ?? []).length, activeHolds: holds.length });
}

const [, , cmd, a1, a2] = process.argv;
const table = {
  session: () => cmdSession(a1, a2), prompt: () => cmdPrompt(a1, a2), settle: () => cmdSettle(a1, a2),
  snap: () => cmdSnap(a1, a2), holds: () => cmdHolds(a1), release: () => cmdRelease(a1, a2),
  'restart-harness': () => cmdRestartHarness(a1, a2), load: () => cmdLoad(a1), close: () => cmdClose(a1, a2),
  'wait-proc': () => cmdWaitProc(a1, a2), 'wait-gone': () => cmdWaitGone(a1, a2), sql: () => cmdSql(a1, a2),
  proxy: () => cmdProxy(a1, a2), 'proxy-log': () => cmdProxyLog(a1),
  'restart-spring': () => cmdRestartSpring(a1), outcome: () => cmdOutcome(a1),
  'close-retry': () => cmdCloseRetry(a1, a2),
}[cmd];
if (!table) { console.error(`unknown command ${cmd}`); process.exit(2); }
try { await table(); } catch (e) { emit(`[RESULT] error ${JSON.stringify(String(e?.stack ?? e).slice(0, 600))}`); process.exit(1); }
process.exit(0);
