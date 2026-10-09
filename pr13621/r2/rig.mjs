// PR #13621 real-stack rig: private MySQL 8.4.7 (127.0.0.1:13621) + the
// Spring fat jar of one arm + the packaged Hosted Harness (dist/cli.js serve
// --profile hosted-harness) + a fake OpenAI model. Every Turn is a real Turn:
// Spring dispatches it to the Harness, the Harness drives the model and
// journals into Spring's Session Store, Spring publishes the events.
// Usage: node rig.mjs <config.json>
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';

const RIG = '/Users/wenshao/pr13621-rig';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MYSQL_PORT = 13621;
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const JAVA = `${process.env.HOME}/Install/jdk21/bin/java`;
const JCMD = `${process.env.HOME}/Install/jdk21/bin/jcmd`;
const cliBundle = `${RIG}/src-${cfg.harnessArm ?? 'head'}/dist/cli.js`;
const springJar = `${RIG}/server/${cfg.arm}-server.jar`;
const runDir = `${RIG}/runs/${cfg.name}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const db = cfg.db;
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';
const actor = cfg.noTrustedActor ? null : 'rig-actor';
const WS_TENANT = 'ws-tenant';
const WS_ID = 'rig-workspace';
const WS_STORAGE = 'rig-storage';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
  console.log(line);
  fs.appendFileSync(`${runDir}/rig.log`, line + '\n');
};
const results = {};
const record = (k, v) => {
  results[k] = v;
  fs.writeFileSync(`${runDir}/results.json`, JSON.stringify(results, null, 2));
};
const checks = [];
function check(id, ok, detail) {
  checks.push({ id, ok: !!ok, detail });
  log(ok ? 'CHECK PASS' : 'CHECK FAIL', id, detail ?? '');
  record('checks', checks);
}

function sql(query, dbName) {
  const args = ['--protocol=tcp', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-uroot', '--batch', '--skip-column-names', '--raw'];
  if (dbName) args.push(dbName);
  const r = spawnSync(MYSQL, [...args, '-e', query], { encoding: 'utf8', maxBuffer: 512 << 20 });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}\n${query.slice(0, 300)}`);
  return r.stdout.replace(/\n$/, '');
}
const q = (v) => `'${String(v).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const rows = (text) => (text ? text.split('\n').map((l) => l.split('\t')) : []);

// ---------- fake model ----------
// The main agent call follows the prompt's [[RIG:{...}]] directive. cutAfter
// makes the FIRST attempt of a plan id stream that many deltas and then drop
// the socket mid-message, so the Harness restarts the attempt and journals a
// message.retracted (#13319) — Spring answers with an in-band stream
// reconciliation that deletes the Snapshot.
let modelCalls = 0;
const attempts = new Map();
const modelLog = fs.createWriteStream(`${runDir}/model-calls.jsonl`);
async function startFakeModel() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      modelCalls++;
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      const model = body.model ?? 'fake-model';
      const id = 'chatcmpl-' + randomBytes(6).toString('hex');
      const created = Math.floor(Date.now() / 1000);
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
      const lastText = typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) ? last.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n') : '';
      const m = [...lastText.matchAll(/\[\[RIG:(\{[^\]]*\})\]\]/g)].pop();
      let plan = { n: 3, gap: 0 };
      if (m && body.stream === true) { try { plan = { ...plan, ...JSON.parse(m[1]) }; } catch {} }
      const attempt = plan.id ? (attempts.get(plan.id) ?? 0) + 1 : 1;
      if (plan.id && m && body.stream === true) attempts.set(plan.id, attempt);
      modelLog.write(JSON.stringify({ t: Date.now() - T0, stream: body.stream === true, marker: !!m, plan, attempt }) + '\n');
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage }));
        return;
      }
      const chunk = (delta, finish = null, u) => ({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
      send(chunk({ role: 'assistant' }));
      const cut = m && plan.cutAfter && attempt === 1 ? plan.cutAfter : null;
      let i = 0;
      const finish = () => { if (res.destroyed) return; send(chunk({}, 'stop', usage)); res.end('data: [DONE]\n\n'); };
      const step = () => {
        if (res.destroyed) return;
        if (cut !== null && i >= cut) { setTimeout(() => res.destroy(), 50); return; }
        if (i < plan.n) {
          send(chunk({ content: `${plan.word ?? 'tok'}-${i++} ` }));
          if (plan.gap > 0) setTimeout(step, plan.gap); else setImmediate(step);
          return;
        }
        finish();
      };
      step();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

// ---------- processes ----------
const children = [];
function start(name, cmd, args, env) {
  const out = fs.openSync(`${runDir}/${name}.log`, 'a');
  const child = spawn(cmd, args, { env, cwd: RIG, detached: true, stdio: ['ignore', out, out] });
  const rec = { name, child };
  children.push(rec);
  child.on('exit', (code, signal) => log(`${name}.exit`, code, signal));
  return rec;
}
async function stop(rec) {
  if (!rec || rec.child.exitCode !== null || rec.child.signalCode !== null) return;
  try { process.kill(-rec.child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 150 && rec.child.exitCode === null && rec.child.signalCode === null; i++) await sleep(100);
  try { process.kill(-rec.child.pid, 'SIGKILL'); } catch {}
}
async function waitFor(name, fn, timeoutMs, rec) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (rec && (rec.child.exitCode !== null || rec.child.signalCode !== null)) throw new Error(`${name} exited early`);
    try { if (await fn()) return; } catch {}
    await sleep(200);
  }
  throw new Error(`${name} not ready in ${timeoutMs}ms`);
}
async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(https?|all|no)_proxy$/i.test(k) &&
      !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(k) &&
      !/(api_?key|token|secret|password|credentials?)$/i.test(k),
  ),
);
const tmp = `${runDir}/tmp`;
// Deployment directories are stable per database (the Session Store
// workspace id is derived from the workspace path).
const stable = `${RIG}/wsroot/${db}`;
const freshMount = !fs.existsSync(`${stable}/workspace-mount`);
const workspace = `${stable}/workspace`;
const workspaceMount = `${stable}/workspace-mount`;
const harnessHome = `${stable}/harness-home`;
const runtimeHome = `${stable}/runtime-home`;
const runtimeState = `${stable}/runtime-state`;
for (const d of [tmp, workspace, `${workspaceMount}/child`, `${harnessHome}/.qwen`, `${runtimeHome}/.qwen`, runtimeState]) fs.mkdirSync(d, { recursive: true });
if (freshMount) fs.utimesSync(workspaceMount, new Date(1), new Date(1));
for (const h of [harnessHome, runtimeHome]) fs.writeFileSync(`${h}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
// Real model: the Harness HOME gets a settings.json that selects qwen3.8-max.
if (cfg.realModel) { const r = spawnSync(process.execPath, [`${RIG}/gen-home.mjs`, `${harnessHome}/.qwen/settings.json`], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); }
const trustedFolders = `${tmp}/trusted-folders.json`;
fs.writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
const harnessToken = randomBytes(24).toString('hex');
const brokerToken = randomBytes(24).toString('hex');
const credentialKey = randomBytes(32).toString('base64');
const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
let springPort, harnessPort, brokerPort, fake, spring, harness;

function springEnv() {
  return {
    ...cleanEnv,
    HOME: runtimeHome, QWEN_HOME: `${runtimeHome}/.qwen`, TMPDIR: tmp, TZ: 'UTC',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(springPort),
    SPRING_DATASOURCE_PASSWORD: '',
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${MYSQL_PORT}/${db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${harnessPort}`,
    QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
    QWEN_MANAGED_AGENT_HARNESS_TOKEN: harnessToken,
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    ...(actor ? { QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: trustedActorHeader } : {}),
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'false',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(brokerPort),
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: brokerToken,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: credentialKey,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'rig-local-v1',
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: runtimeState,
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${springPort}`,
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '60s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_CLI_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
    // The PR's gate. On the base jar the property does not exist, so the env
    // is inert there; that is the control.
    ...(cfg.floor !== undefined ? { QWEN_MANAGED_AGENT_REPLAY_FLOOR_ENABLED: String(cfg.floor) } : {}),
    ...(cfg.floorInterval ? { QWEN_MANAGED_AGENT_REPLAY_FLOOR_INTERVAL: cfg.floorInterval } : {}),
    ...(cfg.springEnv ?? {}),
  };
}
async function startSpring(extraEnv = {}) {
  const t = Date.now();
  spring = start('spring', JAVA, [...(cfg.javaOpts ?? []), '-jar', springJar,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${WS_TENANT}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=${WS_STORAGE}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`,
    ...(cfg.springArgs ?? [])], { ...springEnv(), ...extraEnv });
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 240000, spring);
  log('spring.ready', Date.now() - t, 'ms', 'pid', spring.child.pid);
}
async function startHarness() {
  harness = start('harness', process.execPath, [
    cliBundle, 'serve', '--profile', 'hosted-harness', '--port', String(harnessPort), '--hostname', '127.0.0.1',
    '--require-auth', '--no-web', '--workspace', workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${brokerPort}`,
    `--managed-runtime-broker-token=${brokerToken}`,
  ], {
    ...cleanEnv,
    HOME: harnessHome, QWEN_HOME: `${harnessHome}/.qwen`,
    QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_SERVER_TOKEN: harnessToken,
    ...(cfg.realModel ? {} : { OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model' }),
    QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
    ...(cfg.harnessEnv ?? {}),
  });
  await waitFor('harness', async () => (await fetch(`http://127.0.0.1:${harnessPort}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 120000, harness);
  log('harness.ready');
}

// ---------- API ----------
const actorHeaders = () => (actor ? { [trustedActorHeader]: actor } : {});
async function api(tenant, method, p, body, extraHeaders = {}) {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${springPort}${p}`, {
    method,
    headers: { 'x-qwen-tenant-id': tenant, ...actorHeaders(), ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, code: json?.error?.code ?? null, ms: Date.now() - t0 };
}
const createSession = (tenant, title, ws) =>
  api(tenant, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', ...(ws ? { workspace: { workspace_id: WS_ID } } : {}), metadata: { title } }, { 'idempotency-key': randomUUID() });
const submit = (tenant, sessionId, text) =>
  api(tenant, 'POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text }] }, { 'idempotency-key': randomUUID() });
const directive = (plan) => `[[RIG:${JSON.stringify(plan)}]] please answer`;
function registerWorkspace() {
  if (sql(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id=${q(WS_TENANT)} AND workspace_id=${q(WS_ID)}`, db) !== '0') return;
  sql(`INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(WS_TENANT)}, ${q(WS_ID)}, 1, ${q(WS_STORAGE)}, 'Rig', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`, db);
  const cols = sql(`SELECT GROUP_CONCAT(COLUMN_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=${q(db)} AND TABLE_NAME='managed_workspace_access'`);
  if (/\brole\b/.test(cols)) sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(WS_TENANT)}, ${q(WS_ID)}, ${q(actor)}, 'OWNER')`, db);
  else sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (${q(WS_TENANT)}, ${q(WS_ID)}, ${q(actor)}, TRUE, TRUE)`, db);
}
// The DB view of the replay window: what the PR's store reads.
function windowRow(tenant, sid) {
  const [r] = rows(sql(`SELECT s.last_sequence, s.replay_floor_sequence, COALESCE(n.covered_sequence,-1), COALESCE(p.covered_sequence,-1), (SELECT COUNT(*) FROM managed_agent_event e WHERE e.tenant_id=s.tenant_id AND e.session_id=s.session_id), (SELECT COALESCE(MIN(sequence_id),-1) FROM managed_agent_event e WHERE e.tenant_id=s.tenant_id AND e.session_id=s.session_id) FROM managed_agent_session s LEFT JOIN managed_agent_snapshot n ON n.tenant_id=s.tenant_id AND n.session_id=s.session_id LEFT JOIN managed_agent_consumer_progress p ON p.tenant_id=s.tenant_id AND p.session_id=s.session_id AND p.consumer_name='message_projection' WHERE s.tenant_id=${q(tenant)} AND s.session_id=${q(sid)}`, db));
  return { last: +r[0], floor: +r[1], snapshot: +r[2], progress: +r[3], events: +r[4], minSeq: +r[5] };
}
async function waitTurns(tenant, sid, timeoutMs = 240000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const active = sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)} AND status IN ('ACCEPTED','RUNNING','CANCELLING')`, db);
    if (active === '0') return rows(sql(`SELECT turn_id, status, COALESCE(error_code,'') FROM managed_agent_turn WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)} ORDER BY created_at`, db));
    await sleep(150);
  }
  throw new Error(`turns of ${sid} not settled`);
}
async function waitMaterialized(tenant, sid, timeoutMs = 60000) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const r = windowRow(tenant, sid);
    if (r.progress === r.last && r.snapshot === r.last) return { ...r, ms: Date.now() - t };
    await sleep(50);
  }
  return { ...windowRow(tenant, sid), ms: null, timedOut: true };
}
async function runTurn(tenant, sid, plan) {
  const t = Date.now();
  const s = await submit(tenant, sid, directive(plan));
  if (s.status !== 202) throw new Error(`submit ${s.status} ${s.text}`);
  const turns = await waitTurns(tenant, sid);
  const last = turns[turns.length - 1];
  return { turnMs: Date.now() - t, status: last[1], error: last[2] };
}
async function waitFloor(tenant, sid, pred, timeoutMs) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const r = windowRow(tenant, sid);
    if (pred(r)) return { ...r, ms: Date.now() - t };
    await sleep(100);
  }
  return { ...windowRow(tenant, sid), ms: null, timedOut: true };
}

// ---------- SSE client (keeps whole frames) ----------
function openSse(tenant, path, init, label, { maxMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const rec = { label, frames: [], status: null, endReason: null, ctrl };
  const timer = setTimeout(() => ctrl.abort(), maxMs);
  rec.done = (async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${springPort}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: { 'x-qwen-tenant-id': tenant, ...actorHeaders(), accept: 'text/event-stream', ...(init?.headers ?? {}) },
      });
      rec.status = r.status;
      if (!r.ok) { rec.body = await r.text(); rec.endReason = 'http-error'; return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) { rec.endReason = 'server-closed'; break; }
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const id = /^id:(.*)$/m.exec(frame)?.[1]?.trim();
          const ev = /^event:(.*)$/m.exec(frame)?.[1]?.trim();
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch {}
          if (id || ev || data) rec.frames.push({ t: Date.now(), id: id ? Number(id) : null, ev: ev ?? null, type: parsed?.type ?? null, data: parsed });
        }
      }
    } catch (e) {
      rec.endReason = ctrl.signal.aborted ? 'client-aborted(timeout)' : `error:${e.message}`;
    } finally { clearTimeout(timer); }
  })();
  return rec;
}
const summarizeSse = (x) => ({
  status: x.status, endReason: x.endReason, frames: x.frames.length,
  ids: x.frames.filter((f) => f.id !== null).map((f) => f.id),
  resync: x.frames.filter((f) => f.ev === 'agent.session.resync_required' || f.type === 'agent.session.resync_required').map((f) => ({ id: f.id, ev: f.ev, data: f.data })),
  ...(x.body ? { body: x.body.slice(0, 400) } : {}),
});
const publicSse = (tenant, sid, after, label, headers = {}) =>
  openSse(tenant, `/v1/agents/sessions/${sid}/events?stream=true${after === null ? '' : `&after=${after}`}`, { headers }, label);
const webShellSse = (tenant, sid, after, label) =>
  openSse(tenant, '/api/agent/web-shell/v1/events/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, afterSequence: after }) }, label);

// ---------- steps ----------
const floorOn = () => cfg.expectAdvance === true;
async function core(step) {
  registerWorkspace();
  const out = {};
  const sessions = [];
  for (const ws of [true, false]) {
    const tenant = ws ? WS_TENANT : 'rig-unbound';
    const c = await createSession(tenant, `core ${ws ? 'bound' : 'unbound'}`, ws);
    if (c.status !== 202) throw new Error(`create ${c.status} ${c.text}`);
    sessions.push({ tenant, sid: c.json.id, ws });
  }
  for (const s of sessions) {
    s.turns = [];
    for (const word of ['alpha', 'beta']) s.turns.push(await runTurn(s.tenant, s.sid, { n: step.n ?? 40, word }));
    s.materialized = await waitMaterialized(s.tenant, s.sid);
    log('core.turns', s.ws ? 'bound' : 'unbound', JSON.stringify(s.turns), 'window', JSON.stringify(s.materialized));
    check(`${s.ws ? 'bound' : 'unbound'}.turns-completed`, s.turns.every((t) => t.status === 'COMPLETED'), s.turns.map((t) => t.status).join(','));
  }
  const waitMs = step.floorWaitMs ?? 15000;
  for (const s of sessions) {
    const k = s.ws ? 'bound' : 'unbound';
    const before = windowRow(s.tenant, s.sid);
    const w = floorOn()
      ? await waitFloor(s.tenant, s.sid, (r) => r.floor > 0 && r.floor === r.snapshot, waitMs)
      : (await sleep(waitMs), { ...windowRow(s.tenant, s.sid), ms: null });
    s.window = w;
    const sess = await api(s.tenant, 'GET', `/v1/agents/sessions/${s.sid}`);
    const floor = sess.json?.replay_floor_sequence;
    const snapThrough = sess.json?.snapshot_through_sequence;
    const ev0 = await api(s.tenant, 'GET', `/v1/agents/sessions/${s.sid}/events?after=0&limit=5`);
    const evBelow = floor > 0 ? await api(s.tenant, 'GET', `/v1/agents/sessions/${s.sid}/events?after=${floor - 1}&limit=5`) : null;
    const evAt = await api(s.tenant, 'GET', `/v1/agents/sessions/${s.sid}/events?after=${floor}&limit=100`);
    const sse0 = publicSse(s.tenant, s.sid, 0, 'public-sse-after-0');
    const sseLei = publicSse(s.tenant, s.sid, null, 'public-sse-last-event-id-0', { 'last-event-id': '0' });
    const ws0 = webShellSse(s.tenant, s.sid, 0, 'webshell-sse-after-0');
    await Promise.all([sse0.done, sseLei.done, ws0.done]);
    const items = await api(s.tenant, 'GET', `/v1/agents/sessions/${s.sid}/items?limit=100`);
    const itemsThrough = items.json?.snapshot_through_sequence;
    const evResume = await api(s.tenant, 'GET', `/v1/agents/sessions/${s.sid}/events?after=${itemsThrough}&limit=100`);
    const transcript = await api(s.tenant, 'POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: s.sid });
    const tLast = transcript.json?.lastSequence;
    const wsResume = webShellSse(s.tenant, s.sid, tLast, 'webshell-sse-after-transcript');
    await wsResume.done;
    const targets = rows(sql(`SELECT s.session_id FROM managed_agent_session s JOIN managed_agent_snapshot p ON p.tenant_id = s.tenant_id AND p.session_id = s.session_id WHERE p.covered_sequence > s.replay_floor_sequence AND s.session_id=${q(s.sid)}`, db)).length;
    const after = windowRow(s.tenant, s.sid);
    out[k] = {
      sessionId: s.sid, turns: s.turns, materialized: s.materialized, windowBefore: before, window: w, windowAfter: after,
      session: { replay_floor_sequence: floor, snapshot_through_sequence: snapThrough, last_event_id: sess.json?.last_event_id },
      eventsAfter0: { status: ev0.status, code: ev0.code, body: ev0.status === 409 ? ev0.json : { count: ev0.json?.data?.length, first: ev0.json?.data?.[0]?.sequence } },
      eventsBelowFloor: evBelow && { status: evBelow.status, code: evBelow.code },
      eventsAtFloor: { status: evAt.status, count: evAt.json?.data?.length, first: evAt.json?.data?.[0]?.sequence ?? null },
      publicSseAfter0: summarizeSse(sse0), publicSseLastEventId0: summarizeSse(sseLei), webShellSseAfter0: summarizeSse(ws0),
      items: { status: items.status, count: items.json?.data?.length, snapshot_through_sequence: itemsThrough },
      resumeAfterItems: { status: evResume.status, count: evResume.json?.data?.length },
      transcript: { status: transcript.status, lastSequence: tLast, snapshotSequence: transcript.json?.snapshotSequence, items: transcript.json?.items?.length },
      webShellSseAfterTranscript: summarizeSse(wsResume),
      targetsRemaining: targets,
    };
    record(step.label ?? 'core', out);
    log('core.result', k, JSON.stringify({ floor, snapThrough, ev0: ev0.status, code: ev0.code, sse0: summarizeSse(sse0).resync.length, ws0: summarizeSse(ws0).resync.length }));
    if (floorOn()) {
      check(`${k}.floor-raised-to-snapshot`, floor > 0 && floor === snapThrough && floor === after.snapshot, `floor ${before.floor}->${floor}, snapshot ${after.snapshot}, last ${after.last}, ${w.ms}ms after materialized`);
      check(`${k}.after-0-409-cursor_expired`, ev0.status === 409 && ev0.code === 'cursor_expired' && ev0.json?.error?.replay_floor_sequence === floor, `${ev0.status} ${ev0.code} ${JSON.stringify(ev0.json?.error ?? null)}`);
      check(`${k}.after-floor-minus-1-409`, evBelow?.status === 409, `${evBelow?.status}`);
      check(`${k}.after-floor-200`, evAt.status === 200, `${evAt.status} count=${evAt.json?.data?.length}`);
      const rs = summarizeSse(sse0), rl = summarizeSse(sseLei), rw = summarizeSse(ws0);
      check(`${k}.public-sse-after-0-resync`, rs.resync.length === 1 && rs.ids.length === 0 && rs.endReason === 'server-closed', JSON.stringify(rs.resync));
      check(`${k}.public-sse-last-event-id-0-resync`, rl.resync.length === 1 && rl.ids.length === 0, JSON.stringify(rl.resync));
      check(`${k}.webshell-sse-after-0-resync`, rw.resync.length === 1 && rw.ids.length === 0 && rw.endReason === 'server-closed', JSON.stringify(rw.resync));
      check(`${k}.items-resume-200`, items.status === 200 && itemsThrough >= floor && evResume.status === 200, `items through ${itemsThrough}, resume ${evResume.status}`);
      check(`${k}.webshell-transcript-resume-no-resync`, transcript.status === 200 && summarizeSse(wsResume).resync.length === 0, `transcript last ${tLast}, stream status ${wsResume.status} ${summarizeSse(wsResume).endReason}`);
      check(`${k}.converged-not-reselected`, targets === 0, `targets=${targets}`);
    } else {
      check(`${k}.floor-stays-0`, floor === 0 && after.floor === 0, `floor ${floor}, snapshot ${after.snapshot} after ${waitMs}ms`);
      check(`${k}.after-0-200-all-events`, ev0.status === 200 && ev0.json?.data?.[0]?.sequence === 1, `${ev0.status} first=${ev0.json?.data?.[0]?.sequence}`);
      const rs = summarizeSse(sse0), rw = summarizeSse(ws0);
      check(`${k}.public-sse-after-0-replays`, rs.resync.length === 0 && rs.ids[0] === 1, `ids ${rs.ids.slice(0, 3)}… (${rs.ids.length})`);
      check(`${k}.webshell-sse-after-0-replays`, rw.resync.length === 0 && rw.ids[0] === 1, `ids ${rw.ids.slice(0, 3)}… (${rw.ids.length})`);
    }
    check(`${k}.no-events-deleted`, after.events === after.last && after.minSeq === 1, `events ${after.events}, last ${after.last}, min ${after.minSeq}`);
  }
  state.core = sessions.map((s) => ({ tenant: s.tenant, sid: s.sid, ws: s.ws }));
}

// A stream attached at the floor keeps receiving a live Turn while the pass
// raises the floor behind it.
async function live(step) {
  const s = state.core.find((x) => x.ws);
  const w0 = windowRow(s.tenant, s.sid);
  const sse = openSse(s.tenant, `/v1/agents/sessions/${s.sid}/events?stream=true&after=${w0.floor}`, {}, 'live', { maxMs: step.maxMs ?? 90000 });
  await sleep(500);
  const floorSamples = [];
  const sampler = setInterval(() => { try { floorSamples.push({ t: Date.now(), ...windowRow(s.tenant, s.sid) }); } catch {} }, 250);
  const turn = await runTurn(s.tenant, s.sid, step.plan ?? { n: 300, gap: 15, word: 'live' });
  await waitMaterialized(s.tenant, s.sid);
  await sleep(step.settleMs ?? 6000);
  clearInterval(sampler);
  sse.ctrl.abort();
  await sse.done;
  const w1 = windowRow(s.tenant, s.sid);
  const sum = summarizeSse(sse);
  const ids = sum.ids;
  const contiguous = ids.every((id, i) => id === w0.floor + 1 + i);
  const floorsSeen = [...new Set(floorSamples.map((x) => x.floor))];
  record(step.label ?? 'live', { sessionId: s.sid, turn, startFloor: w0.floor, endWindow: w1, frames: sum.frames, firstId: ids[0], lastId: ids.at(-1), contiguous, resync: sum.resync, floorsSeenWhileAttached: floorsSeen });
  check('live.turn-completed', turn.status === 'COMPLETED', turn.status);
  check('live.stream-contiguous-to-head', contiguous && ids.at(-1) === w1.last && sum.resync.length === 0, `ids ${ids[0]}..${ids.at(-1)} (${ids.length}), last ${w1.last}, resync ${sum.resync.length}`);
  if (floorOn()) check('live.floor-advanced-while-attached', floorsSeen.length > 1 && w1.floor === w1.snapshot && w1.floor > w0.floor, `floors seen ${floorsSeen.join('→')}`);
}

// In-band retraction (#13319) on a Session whose floor was raised: Spring
// deletes the Snapshot and rebuilds it from sequence 0. The PR's R1-1 guard
// serves cursors below the floor until the rebuilt Snapshot backs it again.
async function retract(step) {
  registerWorkspace();
  const c = await createSession(WS_TENANT, 'retract', true);
  const sid = c.json.id;
  const hist = [];
  for (let i = 0; i < (step.historyTurns ?? 2); i++) hist.push(await runTurn(WS_TENANT, sid, { n: step.historyDeltas ?? 1500, word: `h${i}` }));
  await waitMaterialized(WS_TENANT, sid);
  const raised = floorOn()
    ? await waitFloor(WS_TENANT, sid, (r) => r.floor > 0 && r.floor === r.snapshot, step.floorWaitMs ?? 15000)
    : windowRow(WS_TENANT, sid);
  log('retract.history', JSON.stringify(hist), JSON.stringify(raised));
  const floorBefore = raised.floor;
  const samples = [];
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const w = windowRow(WS_TENANT, sid);
      const r = await api(WS_TENANT, 'GET', `/v1/agents/sessions/${sid}/events?after=0&limit=1`);
      samples.push({ t: Date.now(), floor: w.floor, snapshot: w.snapshot, progress: w.progress, last: w.last, status: r.status, code: r.code, details: r.json?.error ? { floor: r.json.error.replay_floor_sequence, snapshotThrough: r.json.error.snapshot_through_sequence } : null });
      await sleep(step.pollMs ?? 20);
    }
  })();
  const planId = `cut-${randomBytes(3).toString('hex')}`;
  const turn = await runTurn(WS_TENANT, sid, { id: planId, n: step.cutTurnDeltas ?? 60, cutAfter: step.cutAfter ?? 20, word: 'retry', gap: 5 });
  await waitMaterialized(WS_TENANT, sid, 120000);
  if (floorOn()) await waitFloor(WS_TENANT, sid, (r) => r.floor === r.snapshot && r.snapshot === r.last, 15000);
  await sleep(500);
  polling = false;
  await poller;
  const reconciled = rows(sql(`SELECT sequence_id, event_type FROM managed_agent_event WHERE tenant_id=${q(WS_TENANT)} AND session_id=${q(sid)} AND event_type='stream.reconciled'`, db));
  const inWindow = samples.filter((x) => x.floor > x.snapshot);
  const outside = samples.filter((x) => !(x.floor > x.snapshot) && x.floor > 0);
  const by = (arr) => arr.reduce((m, x) => ((m[`${x.status}${x.code ? ' ' + x.code : ''}`] = (m[`${x.status}${x.code ? ' ' + x.code : ''}`] ?? 0) + 1), m), {});
  const first = inWindow[0], lastW = inWindow.at(-1);
  const res = {
    sessionId: sid, history: hist, floorBefore, turn, modelAttempts: attempts.get(planId), reconciledEvents: reconciled,
    samples: samples.length, windowSamples: inWindow.length, windowMs: first && lastW ? lastW.t - first.t : 0,
    windowStatuses: by(inWindow), outsideStatuses: by(outside),
    windowExample: first ?? null, window409Details: inWindow.filter((x) => x.status === 409).slice(0, 3).map((x) => x.details),
    end: windowRow(WS_TENANT, sid),
  };
  fs.writeFileSync(`${runDir}/retract-samples.json`, JSON.stringify(samples));
  record(step.label ?? 'retract', res);
  log('retract.result', JSON.stringify(res));
  check('retract.turn-completed', turn.status === 'COMPLETED', turn.status);
  check('retract.model-restarted-and-reconciled', (attempts.get(planId) ?? 0) >= 2 && reconciled.length >= 1, `attempts ${attempts.get(planId)}, stream.reconciled ${reconciled.length}`);
  check('retract.window-observed', inWindow.length > 0, `${inWindow.length} samples with floor > snapshot over ${res.windowMs} ms`);
  if (step.expectWindow === 'served') check('retract.window-served-200', inWindow.length > 0 && inWindow.every((x) => x.status === 200), JSON.stringify(res.windowStatuses));
  if (step.expectWindow === 'expired') check('retract.window-409-without-backing-snapshot', inWindow.some((x) => x.status === 409), JSON.stringify(res.windowStatuses));
  if (floorOn()) check('retract.after-rebuild-409-again', outside.filter((x) => x.t > (lastW?.t ?? 0)).some((x) => x.status === 409), JSON.stringify(by(outside.filter((x) => x.t > (lastW?.t ?? 0)))));
}

async function threadDump(step) {
  const r = spawnSync(JCMD, [String(spring.child.pid), 'Thread.print'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  fs.writeFileSync(`${runDir}/${step.label ?? 'threads'}.txt`, r.stdout);
  const sched = (r.stdout.match(/^"scheduling-\d+"/gm) ?? []);
  record(step.label ?? 'threads', { schedulingThreads: sched });
  log('threads', JSON.stringify(sched));
}

// ---------- scale ----------
// Phase A (flag off): one real Session with a real Turn is the template;
// N copies of its session + snapshot + projection-progress rows model an
// existing deployment's history (floor 0, Snapshot covering N events).
async function scalePrep(step) {
  const tenant = 'scale-tenant';
  const c = await createSession(tenant, 'scale template', false);
  const tsid = c.json.id;
  await runTurn(tenant, tsid, { n: 5, word: 'tpl' });
  await waitMaterialized(tenant, tsid);
  const colsOf = (t) => sql(`SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=${q(db)} AND TABLE_NAME=${q(t)}`).split(',');
  const N = step.n;
  const CH = 50000;
  const t0 = Date.now();
  const sid = (expr) => `CONCAT('scale-', LPAD(${expr}, 8, '0'))`;
  for (let from = 1; from <= N; from += CH) {
    const to = Math.min(N, from + CH - 1);
    const seq = `WITH RECURSIVE n(i) AS (SELECT ${from} UNION ALL SELECT i+1 FROM n WHERE i < ${to})`;
    const sCols = colsOf('managed_agent_session');
    const sSel = sCols.map((c) => c === 'session_id' ? sid('n.i') : c === 'updated_at' || c === 'created_at' ? `t.${c} - (${N} - n.i) * 1000` : c === 'replay_floor_sequence' ? '0' : `t.${c}`);
    sql(`SET SESSION cte_max_recursion_depth=10000000; INSERT INTO managed_agent_session (${sCols.join(',')}) ${seq} SELECT ${sSel.join(',')} FROM managed_agent_session t JOIN n WHERE t.tenant_id=${q(tenant)} AND t.session_id=${q(tsid)}`, db);
    const pCols = colsOf('managed_agent_snapshot');
    sql(`SET SESSION cte_max_recursion_depth=10000000; INSERT INTO managed_agent_snapshot (${pCols.join(',')}) ${seq} SELECT ${pCols.map((c) => (c === 'session_id' ? sid('n.i') : `t.${c}`)).join(',')} FROM managed_agent_snapshot t JOIN n WHERE t.tenant_id=${q(tenant)} AND t.session_id=${q(tsid)}`, db);
    const gCols = colsOf('managed_agent_consumer_progress');
    sql(`SET SESSION cte_max_recursion_depth=10000000; INSERT INTO managed_agent_consumer_progress (${gCols.join(',')}) ${seq} SELECT ${gCols.map((c) => (c === 'session_id' ? sid('n.i') : `t.${c}`)).join(',')} FROM managed_agent_consumer_progress t JOIN n WHERE t.tenant_id=${q(tenant)} AND t.session_id=${q(tsid)}`, db);
    log('scalePrep.chunk', to, Date.now() - t0, 'ms');
  }
  // The template's projection row may carry a deferred-rewrite marker; the
  // copies must not, or the materializer spends its ticks rewriting them.
  sql(`UPDATE managed_agent_consumer_progress SET snapshot_stale_since = NULL WHERE session_id LIKE 'scale-%'`, db);
  sql(`ANALYZE TABLE managed_agent_session, managed_agent_snapshot, managed_agent_consumer_progress`, db);
  const counts = rows(sql(`SELECT (SELECT COUNT(*) FROM managed_agent_session), (SELECT COUNT(*) FROM managed_agent_snapshot), (SELECT COUNT(*) FROM managed_agent_session s JOIN managed_agent_snapshot p ON p.tenant_id=s.tenant_id AND p.session_id=s.session_id WHERE p.covered_sequence > s.replay_floor_sequence)`, db))[0];
  record('scalePrep', { template: tsid, n: N, ms: Date.now() - t0, sessions: +counts[0], snapshots: +counts[1], candidates: +counts[2], templateWindow: windowRow(tenant, tsid) });
  log('scalePrep.done', JSON.stringify(results.scalePrep));
}
const TARGETS_DIGEST_LIKE = "%`covered_sequence` > `s` . `replay_floor_sequence` ORDER BY%";
function targetsDigest() {
  const r = rows(sql(`SELECT COALESCE(SUM(COUNT_STAR),0), COALESCE(ROUND(SUM(SUM_TIMER_WAIT)/1e9),0), COALESCE(SUM(SUM_ROWS_EXAMINED),0), COALESCE(ROUND(MAX(MAX_TIMER_WAIT)/1e9,1),0) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME=${q(db)} AND DIGEST_TEXT LIKE ${q(TARGETS_DIGEST_LIKE)}`))[0];
  return { count: +r[0], ms: +r[1], rowsExamined: +r[2], maxMs: +r[3] };
}
// Phase B: Spring was (re)started on that database. Probe Turns on a fresh
// Session measure how long their Snapshot takes to catch up while the first
// replay-floor pass runs on the shared scheduling thread.
async function scaleProbe(step) {
  const tenant = 'scale-tenant';
  const c = await createSession(tenant, 'scale probe', false);
  const psid = c.json.id;
  const probes = [];
  const progress = [];
  const tStart = Date.now();
  let dumped = false;
  const pending = () => +sql(`SELECT COUNT(*) FROM managed_agent_session WHERE tenant_id='scale-tenant' AND session_id LIKE 'scale-%' AND replay_floor_sequence = 0`, db);
  let tail = step.tailProbes ?? 3;
  for (let i = 0; i < (step.maxProbes ?? 200); i++) {
    const p0 = pending();
    progress.push({ t: Date.now() - tStart, pendingFloors: p0, digest: targetsDigest() });
    if (!dumped && p0 > 0 && i >= 1 && cfg.floor) { await threadDump({ label: 'threads-during-pass' }); dumped = true; }
    const t = Date.now();
    const s = await submit(tenant, psid, directive({ n: 5, word: `p${i}` }));
    if (s.status !== 202) throw new Error(`probe submit ${s.status}`);
    await waitTurns(tenant, psid);
    const turnMs = Date.now() - t;
    const done = Date.now();
    const m = await waitMaterialized(tenant, psid, step.materializeTimeoutMs ?? 600000);
    const items = await api(tenant, 'GET', `/v1/agents/sessions/${psid}/items?limit=100`);
    probes.push({ i, t: t - tStart, turnMs, snapshotLagMs: m.ms === null ? null : Date.now() - done, pendingFloorsAtStart: p0, itemsThrough: items.json?.snapshot_through_sequence, last: m.last });
    log('probe', JSON.stringify(probes.at(-1)));
    record(step.label ?? 'scaleProbe', { probeSession: psid, probes, progress });
    if (p0 === 0 && pending() === 0 && --tail <= 0) break;
    await sleep(step.gapMs ?? 1000);
  }
  progress.push({ t: Date.now() - tStart, pendingFloors: pending(), digest: targetsDigest() });
  record(step.label ?? 'scaleProbe', { probeSession: psid, probes, progress });
}
async function explainTargets(step) {
  const query = `SELECT s.tenant_id, s.session_id FROM managed_agent_session s JOIN managed_agent_snapshot p ON p.tenant_id = s.tenant_id AND p.session_id = s.session_id WHERE p.covered_sequence > s.replay_floor_sequence ORDER BY s.updated_at ASC LIMIT 64`;
  const explain = sql(`EXPLAIN FORMAT=TREE ${query}`, db);
  const times = [];
  let analyze = '';
  for (let i = 0; i < (step.reps ?? 5); i++) {
    const t = Date.now();
    analyze = sql(`EXPLAIN ANALYZE ${query}`, db);
    times.push(Date.now() - t);
  }
  const sessions = +sql('SELECT COUNT(*) FROM managed_agent_session', db);
  record(step.label ?? 'explainTargets', { sessions, explain, analyze, wallMs: times });
  log('explain', sessions, JSON.stringify(times), analyze.replace(/\\n/g, ' | ').slice(0, 600));
}

// Keeps the stack up for an external driver (the browser probe).
async function hold(step) {
  fs.writeFileSync(`${runDir}/stack.json`, JSON.stringify({ springPort, harnessPort, springPid: spring.child.pid, db, floor: cfg.floor ?? null, floorInterval: cfg.floorInterval ?? null, runDir }));
  log('hold.ready', springPort);
  const end = Date.now() + (step.maxMs ?? 3600000);
  while (Date.now() < end && !fs.existsSync(`${runDir}/stop`)) await sleep(500);
}

const state = {};
const steps = { hold, core, live, retract, threadDump, scalePrep, scaleProbe, explainTargets, sleep: async (s) => sleep(s.ms) };

let error = null;
try {
  springPort = await freePort();
  harnessPort = await freePort();
  brokerPort = await freePort();
  fake = await startFakeModel();
  if (cfg.createDb) { sql(`DROP DATABASE IF EXISTS ${db}`); sql(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
  await startSpring();
  await startHarness();
  for (const step of cfg.steps) {
    log('STEP', step.step, step.label ?? '');
    await steps[step.step](step);
  }
} catch (err) {
  error = String(err?.stack ?? err);
  console.error(err);
} finally {
  for (const c of [...children].reverse()) await stop(c);
  const springLog = fs.existsSync(`${runDir}/spring.log`) ? fs.readFileSync(`${runDir}/spring.log`, 'utf8') : '';
  record('summary', { name: cfg.name, arm: cfg.arm, harnessArm: cfg.harnessArm ?? 'head', db, floorEnv: cfg.floor ?? null, jar: springJar, jarSha: createHash('sha256').update(fs.readFileSync(springJar)).digest('hex').slice(0, 16), error, modelCalls, pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).length, springErrors: (springLog.match(/\bERROR\b/g) ?? []).length, replayFloorWarns: (springLog.match(/Failed to advance the replay floor/g) ?? []).length });
  fake?.server.closeAllConnections?.();
  fake?.server.close();
  console.log(`RESULT ${JSON.stringify({ name: cfg.name, error, pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).map((c) => c.id) })}`);
  process.exit(0);
}
