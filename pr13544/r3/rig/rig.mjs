// PR #13544 real-stack rig: Spring fat jar of one arm + packaged Hosted Harness
// (dist/cli.js serve --profile hosted-harness) + fake OpenAI model, against a
// private MySQL 8.4.7 (127.0.0.1:13544) or MariaDB 10.11.18 (tunnel 127.0.0.1:13545).
// Usage: node rig.mjs <seed|upgrade|boot> <mysql|mariadb> <arm> <lineage>
//   seed:    fresh DB, old arm, grant matrix + sessions + Turns, probe matrix, SSE revoke
//   upgrade: same DB, new arm (applies the roles migration), DB dump, probe matrix + diff,
//            owner writes, SQL constraint matrix, padded-role blast radius, candidate CHECK
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';

const [phase, engine, arm, lineage] = process.argv.slice(2);
const RIG = '/Users/wenshao/pr13544-rig';
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const JAVA = `${process.env.HOME}/Install/jdk21/bin/java`;
const DBPORT = engine === 'mysql' ? 13544 : 13545;
const DBPW = engine === 'mysql' ? '' : fs.readFileSync(`${RIG}/mariadb.pw`, 'utf8').trim();
// Round 2: head 28734793da carries main (L3) and changes no TS, so it runs main's packaged Harness.
const cliArm = arm === 'base' ? 'base' : 'main';
const cliBundle = `${RIG}/src-${cliArm}/dist/cli.js`;
const springJar = `${RIG}/server/${arm}-server.jar`;
const db = `r13544_${lineage}_${engine}`;
const runDir = `${RIG}/runs/${db}-${phase}-${arm}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const stateFile = `${RIG}/state/${db}.json`;
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const ACTOR_HEADER = 'x-rig-actor';
const T = 'ws-tenant';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
  console.log(line);
  fs.appendFileSync(`${runDir}/rig.log`, line + '\n');
};
const results = { phase, engine, arm, lineage, db, jar: springJar, cli: cliBundle };
const record = (k, v) => {
  results[k] = v;
  fs.writeFileSync(`${runDir}/results.json`, JSON.stringify(results, null, 2));
};

// ---------- SQL ----------
function sqlRaw(query, dbName) {
  const args = ['--protocol=tcp', '-h127.0.0.1', `-P${DBPORT}`, '-uroot', '--batch', '--skip-column-names', '--raw'];
  if (DBPW) args.push(`-p${DBPW}`);
  if (dbName) args.push(dbName);
  const r = spawnSync(MYSQL, [...args, '-e', query], { encoding: 'utf8', maxBuffer: 256 << 20 });
  return { ok: r.status === 0, out: r.stdout.replace(/\n$/, ''), err: r.stderr.split('\n').filter((l) => !/Using a password/.test(l)).join('\n').trim() };
}
function sql(query, dbName = db) {
  const r = sqlRaw(query, dbName);
  if (!r.ok) throw new Error(`sql failed: ${r.err}\n${query.slice(0, 300)}`);
  return r.out;
}
const q = (v) => `'${String(v).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const rows = (text) => (text ? text.split('\n').map((l) => l.split('\t')) : []);

// ---------- fake model ----------
let modelCalls = 0;
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
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage }));
        return;
      }
      const chunk = (delta, finish = null, u) => ({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
      send(chunk({ role: 'assistant' }));
      send(chunk({ content: 'rig answer ' + randomBytes(3).toString('hex') }));
      send(chunk({}, 'stop', usage));
      res.end('data: [DONE]\n\n');
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
    await sleep(250);
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
// Deployment directories are stable per database (the Session Store workspace id
// is derived from the workspace path).
const stable = `${RIG}/wsroot/${db}`;
const tmp = `${runDir}/tmp`;
const workspace = `${stable}/workspace`;
const harnessHome = `${stable}/harness-home`;
const runtimeHome = `${stable}/runtime-home`;
const runtimeState = `${stable}/runtime-state`;
const STORAGES = ['st1', 'st2', 'st3', 'st5'];
const mount = (st) => `${stable}/mounts/${st}`;
const fresh = !fs.existsSync(`${stable}/mounts`);
for (const d of [tmp, workspace, `${harnessHome}/.qwen`, `${runtimeHome}/.qwen`, runtimeState]) fs.mkdirSync(d, { recursive: true });
for (const st of STORAGES) for (const c of ['c-seed', 'c-upgrade']) fs.mkdirSync(`${mount(st)}/${c}`, { recursive: true });
if (fresh) for (const st of STORAGES) fs.utimesSync(mount(st), new Date(1), new Date(1));
for (const h of [harnessHome, runtimeHome]) fs.writeFileSync(`${h}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
const trustedFolders = `${tmp}/trusted-folders.json`;
fs.writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
const harnessToken = randomBytes(24).toString('hex');
const brokerToken = randomBytes(24).toString('hex');
const credentialKey = state.credentialKey ?? randomBytes(32).toString('base64');
state.credentialKey = credentialKey;
const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
let springPort, harnessPort, brokerPort, fake, spring, harness;

function springEnv() {
  return {
    ...cleanEnv,
    HOME: runtimeHome, QWEN_HOME: `${runtimeHome}/.qwen`, TMPDIR: tmp, TZ: 'UTC',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(springPort),
    SPRING_DATASOURCE_PASSWORD: DBPW,
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${DBPORT}/${db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${harnessPort}`,
    QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
    QWEN_MANAGED_AGENT_HARNESS_TOKEN: harnessToken,
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: ACTOR_HEADER,
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
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '15s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_CLI_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
  };
}
async function startSpring() {
  const t = Date.now();
  const mounts = STORAGES.flatMap((st, i) => [
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].tenant-id=${T}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].storage-id=${st}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].root=${mount(st)}`,
  ]);
  spring = start('spring', JAVA, ['-jar', springJar, ...mounts], springEnv());
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 300000, spring);
  const springLog = fs.readFileSync(`${runDir}/spring.log`, 'utf8');
  const flyway = springLog.split('\n').filter((l) => /Successfully applied|Successfully validated|Current version of schema|Migrating schema .* to version "5[0-9]/i.test(l)).map((l) => l.replace(/^.*?(INFO|WARN|ERROR)\s+\d+\s+---\s+\[[^\]]*\]\s+\[[^\]]*\]\s+/, ''));
  record('springBoot', { ms: Date.now() - t, flyway });
  log('spring.ready', Date.now() - t, 'ms', flyway.join(' | '));
}
async function startHarness() {
  harness = start('harness', process.execPath, [
    cliBundle, 'serve', '--profile', 'hosted-harness', '--port', String(harnessPort), '--hostname', '127.0.0.1',
    '--require-auth', '--no-web', '--workspace', workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${brokerPort}`,
    `--managed-runtime-broker-token=${brokerToken}`,
  ], {
    ...cleanEnv,
    HOME: harnessHome, QWEN_HOME: `${harnessHome}/.qwen`, TMPDIR: tmp,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_SERVER_TOKEN: harnessToken,
    OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
  });
  await waitFor('harness', async () => (await fetch(`http://127.0.0.1:${harnessPort}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 180000, harness);
  log('harness.ready');
}

// ---------- API ----------
async function api(tenant, actor, method, p, body, extraHeaders = {}) {
  const r = await fetch(`http://127.0.0.1:${springPort}${p}`, {
    method,
    headers: { 'x-qwen-tenant-id': tenant, ...(actor ? { [ACTOR_HEADER]: actor } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, code: json?.error?.code ?? json?.code ?? null };
}
const createSession = (tenant, actor, title, ws) =>
  api(tenant, actor, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', ...(ws ? { workspace: { workspace_id: ws } } : {}), metadata: { title } }, { 'idempotency-key': randomUUID() });
const submit = (tenant, actor, sid, text) =>
  api(tenant, actor, 'POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text }] }, { 'idempotency-key': randomUUID() });

async function waitTurns(sid, timeoutMs = 240000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const active = sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id=${q(sid)} AND status IN ('ACCEPTED','RUNNING','CANCELLING')`);
    if (active === '0') return rows(sql(`SELECT turn_id, status, COALESCE(error_code,'') FROM managed_agent_turn WHERE session_id=${q(sid)} ORDER BY created_at, turn_id`));
    await sleep(250);
  }
  return null;
}
async function runTurn(actor, sid) {
  const before = (await waitTurns(sid)) ?? [];
  const s = await submit(T, actor, sid, 'rig turn please answer');
  if (s.status !== 202) return { status: s.status, code: s.code };
  const t = Date.now();
  const after = await waitTurns(sid);
  if (!after) return { status: 202, turn: 'NOT_SETTLED_240s' };
  const fresh = after.filter((r) => !before.some((b) => b[0] === r[0]));
  const last = fresh[fresh.length - 1] ?? after[after.length - 1];
  return { status: 202, turn: last[1], turnError: last[2] || null, ms: Date.now() - t };
}

// SSE: open, report status, keep the reader for revocation tests.
function openSse(tenant, actor, path) {
  const ctrl = new AbortController();
  const rec = { status: null, frames: 0, opened: null, ended: null, endReason: null, ctrl, lastFrames: [] };
  rec.done = (async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${springPort}${path}`, {
        signal: ctrl.signal,
        headers: { 'x-qwen-tenant-id': tenant, ...(actor ? { [ACTOR_HEADER]: actor } : {}), accept: 'text/event-stream' },
      });
      rec.status = r.status;
      rec.opened = Date.now();
      if (r.status !== 200) { rec.body = (await r.text()).slice(0, 300); rec.ended = Date.now(); rec.endReason = 'non-200'; return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) { rec.ended = Date.now(); rec.endReason = 'server-closed'; break; }
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          rec.frames++;
          rec.lastFrames.push({ t: Date.now(), frame: frame.slice(0, 300) });
          if (rec.lastFrames.length > 5) rec.lastFrames.shift();
        }
      }
    } catch (e) {
      rec.ended = Date.now();
      rec.endReason = ctrl.signal.aborted ? 'client-aborted' : `error:${e.message}`;
    }
  })();
  return rec;
}
async function sseStatus(tenant, actor, sid) {
  const rec = openSse(tenant, actor, `/v1/agents/sessions/${sid}/events?stream=true`);
  for (let i = 0; i < 40 && rec.status === null && !rec.ended; i++) await sleep(100);
  await sleep(300);
  rec.ctrl.abort();
  await rec.done;
  return { status: rec.status, code: rec.body ? (JSON.parse(rec.body || '{}')?.error?.code ?? null) : null };
}

// Decision view of a JSON body: ids and boolean leaves, no timestamps.
function boolLeaves(o, prefix = '', out = {}, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'boolean') out[p] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) boolLeaves(v, p, out, depth + 1);
  }
  return out;
}
const itemsOf = (j) => j?.data ?? j?.items ?? j?.sessions ?? j?.workspaces ?? [];
const seedIds = () => new Set(Object.values(state.sessions ?? {}));
const sessionName = (id) => Object.entries(state.sessions ?? {}).find(([, v]) => v === id)?.[0] ?? null;
function wsView(r) {
  if (r.status !== 200) return { status: r.status, code: r.code };
  const items = itemsOf(r.json).map((i) => ({ id: i.id ?? i.workspace_id ?? i.workspaceId, state: i.state, create: i.can_create_session ?? i.canCreateSession })).sort((a, b) => a.id.localeCompare(b.id));
  const def = r.json.default_workspace ?? r.json.defaultWorkspace ?? null;
  return { status: 200, items, default: def ? (def.id ?? def.workspace_id ?? def.workspaceId) : null };
}
function sessListView(r) {
  if (r.status !== 200) return { status: r.status, code: r.code };
  const ids = seedIds();
  const items = itemsOf(r.json).map((i) => ({ id: i.id ?? i.session_id ?? i.sessionId, ...i })).filter((i) => ids.has(i.id));
  return { status: 200, visible: items.map((i) => ({ s: sessionName(i.id), ...boolLeaves(i) })).sort((a, b) => a.s.localeCompare(b.s)) };
}
function findRevision(o) {
  if (!o || typeof o !== 'object') return null;
  for (const [k, v] of Object.entries(o)) {
    if (/context_revision|contextRevision/.test(k) && typeof v === 'number') return v;
    if (v && typeof v === 'object') { const r = findRevision(v); if (r !== null) return r; }
  }
  return null;
}
async function waitOperation(sid, opId, actor, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    const r = await api(T, actor, 'GET', `/v1/agents/sessions/${sid}/operations/${opId}`);
    const st = r.json?.status ?? r.json?.state;
    if (r.status !== 200) return { status: r.status, code: r.code };
    if (st && /completed|succeeded|failed|rejected|cancel|abandon|expired/i.test(st)) return { state: st, error: r.json?.error?.code ?? null };
    last = st;
    await sleep(300);
  }
  return { state: `NOT_SETTLED(last=${last})` };
}

// ---------- the probe matrix ----------
const PROBE_ACTORS = ['op', 'rd', 'cr', 'nn', 'dn', 'zz', 'rv2', 'pd'];
const WORKSPACES = ['W1', 'W2', 'W3', 'W404'];
async function probeMatrix(tag) {
  const P = {};
  const put = (k, v) => { P[k] = v; };
  const sessions = state.sessions;
  for (const a of PROBE_ACTORS) {
    put(`${a}|GET /workspaces`, wsView(await api(T, a, 'GET', '/v1/agents/workspaces?limit=50')));
    put(`${a}|POST web-shell workspaces/query`, wsView(await api(T, a, 'POST', '/api/agent/web-shell/v1/workspaces/query', { limit: 50 })));
    for (const w of WORKSPACES) {
      const r = await api(T, a, 'GET', `/v1/agents/workspaces/${w}`);
      put(`${a}|GET /workspaces/${w}`, { status: r.status, code: r.code, create: r.json?.can_create_session ?? null, state: r.json?.state ?? null });
      const r2 = await api(T, a, 'POST', '/api/agent/web-shell/v1/workspaces/get', { workspaceId: w });
      put(`${a}|POST web-shell workspaces/get ${w}`, { status: r2.status, code: r2.code, create: r2.json?.canCreateSession ?? r2.json?.can_create_session ?? null });
    }
    put(`${a}|GET /sessions`, sessListView(await api(T, a, 'GET', '/v1/agents/sessions?limit=100')));
    put(`${a}|POST web-shell sessions/query`, sessListView(await api(T, a, 'POST', '/api/agent/web-shell/v1/sessions/query', { limit: 100 })));
    for (const [name, sid] of Object.entries(sessions)) {
      const g = await api(T, a, 'GET', `/v1/agents/sessions/${sid}`);
      put(`${a}|GET /sessions/${name}`, { status: g.status, code: g.code });
      const wg = await api(T, a, 'POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: sid });
      put(`${a}|POST web-shell sessions/get ${name}`, { status: wg.status, code: wg.code, ...(wg.status === 200 ? boolLeaves(wg.json) : {}) });
      const tl = await api(T, a, 'GET', `/v1/agents/sessions/${sid}/turns`);
      put(`${a}|GET /sessions/${name}/turns`, { status: tl.status, code: tl.code });
      const ev = await api(T, a, 'GET', `/v1/agents/sessions/${sid}/events?limit=5`);
      put(`${a}|GET /sessions/${name}/events`, { status: ev.status, code: ev.code });
      put(`${a}|SSE /sessions/${name}/events`, await sseStatus(T, a, sid));
    }
  }
  // Cross-tenant control: same actor id, other tenant.
  put(`other:op|GET /workspaces`, wsView(await api('other-tenant', 'op', 'GET', '/v1/agents/workspaces')));
  put(`other:op|GET /workspaces/W1`, (({ status, code }) => ({ status, code }))(await api('other-tenant', 'op', 'GET', '/v1/agents/workspaces/W1')));
  put(`other:op|GET /sessions/s_op_w1`, (({ status, code }) => ({ status, code }))(await api('other-tenant', 'op', 'GET', `/v1/agents/sessions/${sessions.s_op_w1}`)));
  // Turn submission (only creator + OPERATOR on an ACTIVE Workspace may submit to a bound Session).
  const submitPlan = [];
  for (const a of PROBE_ACTORS) for (const name of ['s_op_w1', 's_rd_w2', 's_op_w3', 's_cr_w1', 's_dn_w1']) submitPlan.push([a, name]);
  submitPlan.push(['op', 's_op_unb'], ['zz', 's_op_unb']);
  for (const [a, name] of submitPlan) put(`${a}|POST /sessions/${name}/events (submit)`, await runTurn(a, sessions[name]));
  // cwd change (hasCwdChangeRegistryFacts: creator's grant must be OPERATOR on an ACTIVE registry).
  const target = phase === 'seed' ? 'c-seed' : 'c-upgrade';
  for (const a of PROBE_ACTORS) for (const name of ['s_op_w1', 's_rd_w2', 's_op_w3', 's_dn_w1']) {
    const sid = sessions[name];
    const g = await api(T, 'op', 'GET', `/v1/agents/sessions/${sid}`);
    const rev = findRevision(g.json) ?? 0;
    const r = await api(T, a, 'POST', `/v1/agents/sessions/${sid}/cwd`, { cwd_relative: target, expected_context_revision: rev }, { 'idempotency-key': randomUUID() });
    const v = { status: r.status, code: r.code };
    if (r.status === 202 && r.json?.id) v.op = await waitOperation(sid, r.json.id, a);
    put(`${a}|POST /sessions/${name}/cwd`, v);
  }
  // Creation (resolveForCreation: no read -> 404, read without create -> 403).
  for (const a of PROBE_ACTORS) for (const w of WORKSPACES) {
    const r = await createSession(T, a, `probe-${tag}-${a}-${w}`, w);
    put(`${a}|POST /sessions (workspace ${w})`, { status: r.status, code: r.code });
    if (r.status === 202) (state.probeCreated ??= []).push({ phase, actor: a, ws: w, id: r.json?.id });
    const r2 = await api(T, a, 'POST', '/api/agent/web-shell/v1/sessions/create', { idempotencyKey: randomUUID(), agentId: 'qwen-code', title: `probe-wsh-${tag}-${a}-${w}`, workspace: { workspaceId: w } });
    put(`${a}|POST web-shell sessions/create (workspace ${w})`, { status: r2.status, code: r2.code });
    const nid = r2.json?.id ?? r2.json?.sessionId ?? r2.json?.session?.sessionId ?? r2.json?.session?.id;
    if (r2.status >= 200 && r2.status < 300) (state.probeCreated ??= []).push({ phase, actor: a, ws: w, id: nid, via: 'web-shell' });
  }
  saveState();
  return P;
}

// SSE revocation: a READER watches s_op_w1, its grant row is deleted, the stream must end.
async function revokeTest(actor) {
  const rec = openSse(T, actor, `/v1/agents/sessions/${state.sessions.s_op_w1}/events?stream=true`);
  for (let i = 0; i < 100 && rec.status === null && !rec.ended; i++) await sleep(100);
  await sleep(1500);
  const opened = rec.status;
  const t = Date.now();
  const deleted = sql(`DELETE FROM managed_workspace_access WHERE tenant_id=${q(T)} AND workspace_id='W1' AND actor_id=${q(actor)}; SELECT ROW_COUNT();`);
  // Drive events on the session so a recheck has something to gate.
  const turn = runTurn('op', state.sessions.s_op_w1);
  const end = Date.now() + 90000;
  while (!rec.ended && Date.now() < end) await sleep(200);
  const out = { actor, opened, deletedRows: deleted, ended: !!rec.ended, endReason: rec.endReason, closeMs: rec.ended ? rec.ended - t : null, framesBeforeClose: rec.frames, lastFrames: rec.lastFrames.map((f) => f.frame.replace(/\n/g, ' | ')) };
  if (!rec.ended) { rec.ctrl.abort(); await rec.done; }
  out.turnDuring = await turn;
  out.afterReopen = await sseStatus(T, actor, state.sessions.s_op_w1);
  return out;
}

function dbDump(label) {
  const hasRole = sql(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=${q(db)} AND table_name='managed_workspace_access' AND column_name='role'`) === '1';
  const hasOwner = sql(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=${q(db)} AND table_name='managed_agent_session' AND column_name='owner_actor_key'`) === '1';
  const access = rows(sql(`SELECT workspace_id, CAST(actor_id AS CHAR), ${hasRole ? "CONCAT('[', role, ']')" : "CONCAT('read=', can_read, ' create=', can_create)"} FROM managed_workspace_access WHERE tenant_id=${q(T)} ORDER BY workspace_id, actor_id`)).map(([w, a, g]) => ({ w, a, g }));
  const sess = rows(sql(`SELECT session_id, title, COALESCE(CAST(creator_actor_key AS CHAR),'NULL'), ${hasOwner ? "COALESCE(CAST(owner_actor_key AS CHAR),'NULL')" : "'-'"}, COALESCE(workspace_id,'') FROM managed_agent_session ORDER BY created_at, session_id`)).map(([id, title, creator, owner, ws]) => ({ name: sessionName(id) ?? title, ws, creator, owner }));
  const cols = rows(sql(`SELECT column_name, column_type, is_nullable, COALESCE(column_default,'(none)'), COALESCE(collation_name,'') FROM information_schema.columns WHERE table_schema=${q(db)} AND table_name='managed_workspace_access' ORDER BY ordinal_position`));
  const checks = rows(sqlRaw(`SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_schema=${q(db)} AND (constraint_name LIKE 'managed_workspace_access%' OR check_clause LIKE '%role%')`).out);
  const flyway = rows(sql(`SELECT version, description, success, execution_time FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 3`));
  const out = { access, sessions: sess, cols, checks, flyway };
  record(`db.${label}`, out);
  return out;
}

const CHK_VALUES = [
  ['READER', "'READER'"], ['OPERATOR', "'OPERATOR'"], ['OWNER', "'OWNER'"],
  ['NONE', "'NONE'"], ['reader', "'reader'"], ['SPECTATOR', "'SPECTATOR'"], ['(empty)', "''"],
  ['READER<sp>', "'READER '"], ['OPERATOR<sp>', "'OPERATOR '"], ['OWNER<sp>', "'OWNER '"], ['READER<sp><sp><sp>', "'READER   '"],
  ['READER<tab>', "CONCAT('READER', CHAR(9))"], ['<sp>READER', "' READER'"],
  ['Reader', "'Reader'"], ['READER<nul>', "CONCAT('READER', CHAR(0))"], ['READER<nbsp>', "CONCAT('READER', _utf8mb4 X'C2A0')"], ['REA DER', "'REA DER'"],
];
function constraintMatrix(label) {
  const out = [];
  let i = 0;
  for (const [name, expr] of CHK_VALUES) {
    const key = `chk-${label}-${i++}`;
    const r = sqlRaw(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, 'W1', ${q(key)}, ${expr}); SELECT CONCAT('[', role, ']'), LENGTH(role) FROM managed_workspace_access WHERE actor_id=${q(key)};`, db);
    out.push({ value: name, accepted: r.ok, stored: r.ok ? r.out : null, error: r.ok ? null : r.err.replace(/^ERROR /, '').slice(0, 160) });
  }
  for (const [name, pre] of [['omit role (strict sql_mode)', ''], ["omit role (sql_mode='')", "SET SESSION sql_mode='';"]]) {
    const key = `chk-${label}-${i++}`;
    const r = sqlRaw(`${pre} INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id) VALUES (${q(T)}, 'W1', ${q(key)}); SELECT CONCAT('[', role, ']') FROM managed_workspace_access WHERE actor_id=${q(key)};`, db);
    out.push({ value: name, accepted: r.ok, stored: r.ok ? r.out : null, error: r.ok ? null : r.err.replace(/^ERROR /, '').slice(0, 160) });
  }
  // UPDATE path (out-of-band relabel of an existing canonical row)
  const key = `chk-${label}-${i++}`;
  sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, 'W1', ${q(key)}, 'READER')`);
  const u = sqlRaw(`UPDATE managed_workspace_access SET role='OPERATOR ' WHERE actor_id=${q(key)}; SELECT CONCAT('[', role, ']') FROM managed_workspace_access WHERE actor_id=${q(key)};`, db);
  out.push({ value: "UPDATE READER -> 'OPERATOR '", accepted: u.ok, stored: u.ok ? u.out : null, error: u.ok ? null : u.err.slice(0, 160) });
  const up = sqlRaw(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, 'W1', ${q(key)}, 'READER') ON DUPLICATE KEY UPDATE role='OWNER '; SELECT CONCAT('[', role, ']') FROM managed_workspace_access WHERE actor_id=${q(key)};`, db);
  out.push({ value: "UPSERT ON DUPLICATE KEY -> 'OWNER '", accepted: up.ok, stored: up.ok ? up.out : null, error: up.ok ? null : up.err.slice(0, 160) });
  const rp = sqlRaw(`REPLACE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, 'W1', ${q(key)}, 'READER '); SELECT CONCAT('[', role, ']') FROM managed_workspace_access WHERE actor_id=${q(key)};`, db);
  out.push({ value: "REPLACE -> 'READER '", accepted: rp.ok, stored: rp.ok ? rp.out : null, error: rp.ok ? null : rp.err.slice(0, 160) });
  sql(`DELETE FROM managed_workspace_access WHERE actor_id LIKE 'chk-%'`);
  record(`constraint.${label}`, out);
  log('CONSTRAINT', label, out.map((o) => `${o.value}:${o.accepted ? 'ACCEPT' : 'reject'}`).join(' '));
  return out;
}

async function paddedProbes(tag) {
  const s = state.sessions;
  const P = {};
  const g = async (k, f) => { const r = await f(); P[k] = { status: r.status, code: r.code, ...(r.extra ?? {}) }; };
  P['GET /workspaces'] = wsView(await api(T, 'pd', 'GET', '/v1/agents/workspaces'));
  P['POST web-shell workspaces/query'] = wsView(await api(T, 'pd', 'POST', '/api/agent/web-shell/v1/workspaces/query', { limit: 50 }));
  await g('GET /workspaces/W1', () => api(T, 'pd', 'GET', '/v1/agents/workspaces/W1'));
  await g('GET /workspaces/W2', () => api(T, 'pd', 'GET', '/v1/agents/workspaces/W2'));
  P['GET /sessions'] = sessListView(await api(T, 'pd', 'GET', '/v1/agents/sessions?limit=100'));
  P['POST web-shell sessions/query'] = sessListView(await api(T, 'pd', 'POST', '/api/agent/web-shell/v1/sessions/query', { limit: 100 }));
  await g('GET /sessions/s_op_w1 (W1)', () => api(T, 'pd', 'GET', `/v1/agents/sessions/${s.s_op_w1}`));
  await g('GET /sessions/s_pd_w2 (own, W2)', () => api(T, 'pd', 'GET', `/v1/agents/sessions/${s.s_pd_w2}`));
  await g('POST web-shell sessions/get s_pd_w2', () => api(T, 'pd', 'POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: s.s_pd_w2 }));
  P['SSE /sessions/s_op_w1'] = await sseStatus(T, 'pd', s.s_op_w1);
  P['POST /sessions/s_pd_w2/events (submit, own, W2)'] = await runTurn('pd', s.s_pd_w2);
  for (const w of ['W1', 'W2']) {
    const r = await createSession(T, 'pd', `probe-pad-${tag}-${w}`, w);
    P[`POST /sessions (workspace ${w})`] = { status: r.status, code: r.code };
  }
  // Bystander: another actor on the same Workspace is unaffected.
  P['op: GET /workspaces'] = wsView(await api(T, 'op', 'GET', '/v1/agents/workspaces'));
  return P;
}

// Pre-existing analogue (base and head): registry state with a trailing space.
async function stateTrailingProbe() {
  sql(`UPDATE managed_workspace_registry SET state='ACTIVE ' WHERE tenant_id=${q(T)} AND workspace_id='W5'`);
  const stored = sql(`SELECT CONCAT('[', state, ']') FROM managed_workspace_registry WHERE workspace_id='W5'`);
  const P = { stored };
  P['GET /workspaces'] = wsView(await api(T, 'ps', 'GET', '/v1/agents/workspaces'));
  const g = await api(T, 'ps', 'GET', '/v1/agents/workspaces/W5');
  P['GET /workspaces/W5'] = { status: g.status, code: g.code, state: g.json?.state ?? null, create: g.json?.can_create_session ?? null };
  const c = await createSession(T, 'ps', 'probe-state-pad', 'W5');
  P['POST /sessions (workspace W5)'] = { status: c.status, code: c.code };
  sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE tenant_id=${q(T)} AND workspace_id='W5'`);
  return P;
}

function diffProbes(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const same = [], diff = [];
  const norm = (v) => {
    if (!v) return v;
    const c = { ...v };
    delete c.ms;
    if (c.op) c.op = { ...c.op };
    return JSON.stringify(c);
  };
  for (const k of keys) (norm(a[k]) === norm(b[k]) ? same : diff).push(k);
  return { total: keys.length, same: same.length, diff: diff.map((k) => ({ k, before: a[k], after: b[k] })) };
}

// ---------- phases ----------
async function seedPhase() {
  sql(`DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`, '');
  delete state.sessions; delete state.probeCreated;
  await bootStack();
  const reg = (w, st) => `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(T)}, '${w}', 1, '${st}', 'Rig ${w}', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`;
  sql([reg('W1', 'st1'), reg('W2', 'st2'), reg('W3', 'st3'), reg('W5', 'st5')].join(';'));
  const grant = (w, a, r, c) => `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (${q(T)}, '${w}', '${a}', ${r ? 'TRUE' : 'FALSE'}, ${c ? 'TRUE' : 'FALSE'})`;
  sql([
    grant('W1', 'op', 1, 1), grant('W2', 'op', 1, 0), grant('W3', 'op', 1, 1),
    grant('W1', 'rd', 1, 0), grant('W2', 'rd', 1, 1),
    grant('W1', 'cr', 1, 1), grant('W1', 'nn', 0, 0), grant('W1', 'dn', 1, 1),
    grant('W1', 'rv1', 1, 0), grant('W1', 'rv2', 1, 0),
    grant('W1', 'pd', 1, 0), grant('W2', 'pd', 1, 1), grant('W5', 'ps', 1, 0),
  ].join(';'));
  const plan = [['s_op_w1', 'op', 'W1'], ['s_rd_w2', 'rd', 'W2'], ['s_op_w3', 'op', 'W3'], ['s_cr_w1', 'cr', 'W1'], ['s_dn_w1', 'dn', 'W1'], ['s_op_unb', 'op', null], ['s_pd_w2', 'pd', 'W2']];
  state.sessions = {};
  const seedTurns = {};
  for (const [name, a, w] of plan) {
    const c = await createSession(T, a, `seed-${name}`, w);
    if (c.status !== 202) throw new Error(`seed create ${name}: ${c.status} ${c.text}`);
    state.sessions[name] = c.json.id;
    seedTurns[name] = await runTurn(a, c.json.id);
    log('seed', name, c.json.id, JSON.stringify(seedTurns[name]));
  }
  saveState();
  record('seedTurns', seedTurns);
  // Post-creation grant changes that model existing deployments.
  sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE tenant_id=${q(T)} AND workspace_id='W3'`);
  sql(`UPDATE managed_workspace_access SET can_read=FALSE, can_create=TRUE WHERE tenant_id=${q(T)} AND workspace_id='W1' AND actor_id='cr'`);
  sql(`UPDATE managed_workspace_access SET can_read=TRUE, can_create=FALSE WHERE tenant_id=${q(T)} AND workspace_id='W1' AND actor_id='dn'`);
  dbDump('beforeUpgrade');
  const P = await probeMatrix('seed');
  fs.writeFileSync(`${RIG}/state/${db}.probes-${phase}.json`, JSON.stringify(P, null, 2));
  record('probeCount', Object.keys(P).length);
  record('stateTrailing', await stateTrailingProbe());
  record('revoke', await revokeTest('rv1'));
  dbDump('endOfSeed');
}

async function upgradePhase() {
  await bootStack();
  const dbAfter = dbDump('afterUpgrade');
  const before = JSON.parse(fs.readFileSync(`${RIG}/state/${db}.probes-seed.json`, 'utf8'));
  const P = await probeMatrix('upgrade');
  fs.writeFileSync(`${RIG}/state/${db}.probes-${phase}.json`, JSON.stringify(P, null, 2));
  const d = diffProbes(before, P);
  record('probeDiff', d);
  log('PROBE-DIFF', `${d.same}/${d.total} identical`, d.diff.map((x) => x.k).join('; '));
  record('stateTrailing', await stateTrailingProbe());
  record('revoke', await revokeTest('rv2'));
  // Owner writes on the new binary.
  const owners = {};
  const nb = await createSession(T, 'op', 'owner-bound', 'W1');
  const nu = await createSession(T, 'op', 'owner-unbound', null);
  const na = await createSession(T, null, 'owner-anon', null);
  for (const [k, r] of [['bound(op,W1)', nb], ['unbound(op)', nu], ['anonymous unbound', na]]) {
    owners[k] = { status: r.status, code: r.code };
    if (r.status === 202) owners[k].row = rows(sql(`SELECT COALESCE(CAST(creator_actor_key AS CHAR),'NULL'), COALESCE(CAST(owner_actor_key AS CHAR),'NULL') FROM managed_agent_session WHERE session_id=${q(r.json.id)}`))[0];
  }
  owners.probeCreated = rows(sql(`SELECT title, COALESCE(CAST(creator_actor_key AS CHAR),'NULL'), COALESCE(CAST(owner_actor_key AS CHAR),'NULL') FROM managed_agent_session WHERE title LIKE 'probe-%' ORDER BY title`)).map(([t, c, o]) => ({ t, c, o, equal: c === o }));
  owners.allSessionsOwnerEqualsCreator = sql(`SELECT SUM(NOT (owner_actor_key <=> creator_actor_key)), COUNT(*) FROM managed_agent_session`);
  record('owners', owners);
  // SQL constraint matrix on the shipped CHECK.
  constraintMatrix('shipped');
  // Padded role blast radius for actor pd (W1 READER -> 'READER ').
  const padBefore = await paddedProbes('canonical');
  const w1 = sqlRaw(`UPDATE managed_workspace_access SET role='READER ' WHERE tenant_id=${q(T)} AND workspace_id='W1' AND actor_id='pd'`, db);
  const w2 = sqlRaw(`UPDATE managed_workspace_access SET role='OPERATOR ' WHERE tenant_id=${q(T)} AND workspace_id='W2' AND actor_id='pd'`, db);
  const padStored = rows(sql(`SELECT workspace_id, CONCAT('[', role, ']') FROM managed_workspace_access WHERE actor_id='pd' ORDER BY workspace_id`));
  const padWrite = { readerPadded: w1.ok ? 'ACCEPTED' : w1.err.replace(/^ERROR /, '').slice(0, 160), operatorPadded: w2.ok ? 'ACCEPTED' : w2.err.replace(/^ERROR /, '').slice(0, 160), stored: padStored };
  log('PADDED-WRITE', JSON.stringify(padWrite));
  const padAfter = await paddedProbes('after-padded-attempt');
  sql(`UPDATE managed_workspace_access SET role='READER' WHERE actor_id='pd' AND workspace_id='W1'; UPDATE managed_workspace_access SET role='OPERATOR' WHERE actor_id='pd' AND workspace_id='W2'`);
  const padDiff = diffProbes(padBefore, padAfter);
  record('padded', { write: padWrite, before: padBefore, afterPaddedAttempt: padAfter, diff: padDiff });
  log('PADDED-PROBES', `${padDiff.same}/${padDiff.total} unchanged`);
  const springLog = fs.readFileSync(`${runDir}/spring.log`, 'utf8');
  record('paddedLogLines', [...new Set(springLog.split('\n').filter((l) => /No enum constant|IllegalArgumentException/.test(l)).map((l) => l.replace(/^.*?(WARN|ERROR|DEBUG|INFO)/, '$1').slice(0, 260)))].slice(0, 8));
}

// Rollback without a DB restore: the previous binary against the migrated (V52) schema.
async function oldJarPhase() {
  springPort = await freePort(); harnessPort = await freePort(); brokerPort = await freePort();
  fake = await startFakeModel();
  try { await startSpring(); } catch (e) {
    const tail = fs.readFileSync(`${runDir}/spring.log`, 'utf8').split('\n').filter((l) => /ERROR|Exception|Validate failed|migration/i.test(l)).slice(-6);
    record('oldJarBoot', { booted: false, error: String(e.message), tail });
    return;
  }
  await startHarness();
  const s = state.sessions;
  const P = {};
  for (const a of ['op', 'rd']) {
    P[`${a}|GET /workspaces`] = wsView(await api(T, a, 'GET', '/v1/agents/workspaces'));
    const g = await api(T, a, 'GET', '/v1/agents/workspaces/W1');
    P[`${a}|GET /workspaces/W1`] = { status: g.status, code: g.code };
    P[`${a}|GET /sessions`] = sessListView(await api(T, a, 'GET', '/v1/agents/sessions?limit=100'));
    const gs = await api(T, a, 'GET', `/v1/agents/sessions/${s.s_op_w1}`);
    P[`${a}|GET /sessions/s_op_w1`] = { status: gs.status, code: gs.code };
    const c = await createSession(T, a, `oldjar-${a}`, 'W1');
    P[`${a}|POST /sessions (W1)`] = { status: c.status, code: c.code };
  }
  P['op|submit s_op_w1'] = await runTurn('op', s.s_op_w1);
  const springLog = fs.readFileSync(`${runDir}/spring.log`, 'utf8');
  record('oldJarBoot', { booted: true, flyway: results.springBoot?.flyway, probes: P, sqlErrors: [...new Set(springLog.split('\n').filter((l) => /Unknown column|can_read|BadSqlGrammar/.test(l)).map((l) => l.replace(/^.*?(WARN|ERROR)/, '$1').slice(0, 220)))].slice(0, 4) });
  log('OLDJAR', JSON.stringify(P));
}

async function bootStack() {
  springPort = await freePort(); harnessPort = await freePort(); brokerPort = await freePort();
  fake = await startFakeModel();
  await startSpring();
  await startHarness();
}

const shutdown = async () => {
  for (const c of [...children].reverse()) await stop(c);
  fake?.server.close();
};
process.on('SIGINT', async () => { await shutdown(); process.exit(130); });
try {
  if (phase === 'seed') await seedPhase();
  else if (phase === 'upgrade') await upgradePhase();
  else if (phase === 'oldjar') await oldJarPhase();
  else throw new Error(`unknown phase ${phase}`);
  record('modelCalls', modelCalls);
  record('ok', true);
  log('DONE', phase, Math.round((Date.now() - T0) / 1000), 's');
} catch (e) {
  record('error', String(e.stack ?? e));
  log('FAILED', String(e.stack ?? e));
  process.exitCode = 1;
} finally {
  saveState();
  await shutdown();
}
