// PR #13403 packaged-stack burst rig (derived from the #13388 rig): MySQL 8.4.7 (port 13403) +
// a counting/delaying proxy between Spring and the Harness +
// the Spring fat jar of one arm + the packaged Hosted Harness
// (dist/cli.js serve --profile hosted-harness) + a fake OpenAI model that
// answers instantly. One run = one fresh database, one Spring, one Harness;
// every round uses a fresh tenant. Usage: node burst.mjs <config.json>
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';

const S =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MYSQL_PORT = 13403;
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const ERROR_LOG = `${S}/mysql/error.log`;
const W = `${S}/wt-${cfg.arm}`;
const cliBundle = `${S}/wt-${cfg.cliArm ?? 'pr'}/dist/cli.js`;
const springJar = `${W}/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar`;
const runDir = `${S}/runs/${cfg.name}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const db = 'b_' + cfg.name.replace(/[^A-Za-z0-9]/g, '_') + '_' + Date.now().toString(36);
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';
const trustedActor = 'e2e-actor';
const boundWorkspaceId = 'e2e-workspace';
const boundStorageId = 'e2e-storage';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

function sql(query) {
  const r = spawnSync(MYSQL, ['--protocol=tcp', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-uroot', '--batch', '--skip-column-names', '-e', query], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return r.stdout.trim();
}
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const deadlocksLogged = () => Number(sql("SELECT count FROM information_schema.innodb_metrics WHERE name = 'lock_deadlocks'"));

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

// ---------- fake model: instant answer ----------
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
      const deltas = cfg.deltas ?? 20;
      const gap = Math.floor((cfg.replyMs ?? 0) / deltas);
      let i = 0;
      const step = () => {
        if (res.destroyed) return;
        if (i < deltas) { send(chunk({ content: `burst-reply-${i++} ` })); if (gap > 0) setTimeout(step, gap); else step(); return; }
        send(chunk({}, 'stop', usage));
        res.end('data: [DONE]\n\n');
      };
      step();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

// ---------- Spring -> Harness proxy: counts requests, optional /capabilities delay ----------
const proxyStats = { byRoute: {}, sessionCreates: {}, createInFlight: 0, createInFlightMax: 0, capabilities: [], firstRequestAt: null };
let capabilitiesDelayed = 0;
let harnessPortForProxy;
async function startProxy() {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const route = `${req.method} ${path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id')}`;
    proxyStats.byRoute[route] = (proxyStats.byRoute[route] ?? 0) + 1;
    proxyStats.firstRequestAt ??= Date.now();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const isCreate = req.method === 'POST' && path === '/session';
      if (isCreate) {
        let sid = '?';
        try { sid = JSON.parse(body.toString('utf8')).sessionId ?? '?'; } catch {}
        proxyStats.sessionCreates[sid] = (proxyStats.sessionCreates[sid] ?? 0) + 1;
        proxyStats.createInFlight++;
        proxyStats.createInFlightMax = Math.max(proxyStats.createInFlightMax, proxyStats.createInFlight);
      }
      if (req.method === 'GET' && path === '/capabilities') {
        const rec = { at: Date.now(), delayed: 0 };
        proxyStats.capabilities.push(rec);
        if (cfg.capabilitiesDelayMs && capabilitiesDelayed < (cfg.capabilitiesDelayCount ?? 1)) {
          capabilitiesDelayed++;
          rec.delayed = cfg.capabilitiesDelayMs;
          log('proxy.capabilities.delay', cfg.capabilitiesDelayMs);
          if (cfg.onCapabilitiesDelay) cfg.onCapabilitiesDelay();
          await sleep(cfg.capabilitiesDelayMs);
        }
      }
      const headers = { ...req.headers, host: `127.0.0.1:${harnessPortForProxy}` };
      delete headers['content-length'];
      if (body.length) headers['content-length'] = String(body.length);
      const up = httpRequest({ host: '127.0.0.1', port: harnessPortForProxy, method: req.method, path: req.url, headers }, (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
        const done = () => { if (isCreate) { proxyStats.createInFlight--; } };
        ur.on('end', done);
        ur.on('aborted', () => { res.destroy(); });
        ur.on('error', () => res.destroy());
        ur.on('close', () => { if (!res.writableEnded) res.destroy(); });
      });
      up.on('error', () => { if (isCreate) proxyStats.createInFlight--; if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
      res.on('close', () => up.destroy());
      up.end(body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

// ---------- processes ----------
const children = [];
function start(name, cmd, args, env, cwd) {
  const out = fs.openSync(`${runDir}/${name}.log`, 'a');
  const child = spawn(cmd, args, { env, cwd: cwd ?? W, detached: true, stdio: ['ignore', out, out] });
  const rec = { name, child };
  children.push(rec);
  child.on('exit', (code, signal) => log(`${name}.exit`, code, signal));
  return rec;
}
async function stop(rec) {
  if (!rec || rec.child.exitCode !== null || rec.child.signalCode !== null) return;
  try { process.kill(-rec.child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 100 && rec.child.exitCode === null && rec.child.signalCode === null; i++) await sleep(100);
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
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(https?|all|no)_proxy$/i.test(k) &&
      !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(k) &&
      !/(api_?key|token|secret|password|credentials?)$/i.test(k),
  ),
);

const tmp = `${runDir}/tmp`;
const workspace = `${tmp}/workspace`;
const workspaceMount = `${tmp}/workspace-mount`;
const harnessHome = `${tmp}/harness-home`;
const runtimeHome = `${tmp}/runtime-home`;
const runtimeState = `${tmp}/runtime-state`;
for (const d of [workspace, workspaceMount, `${harnessHome}/.qwen`, `${runtimeHome}/.qwen`, runtimeState]) fs.mkdirSync(d, { recursive: true });
for (const h of [harnessHome, runtimeHome]) fs.writeFileSync(`${h}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
const trustedFolders = `${tmp}/trusted-folders.json`;
fs.writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
const harnessToken = randomBytes(24).toString('hex');
const brokerToken = randomBytes(24).toString('hex');
const credentialKey = randomBytes(32).toString('base64');
const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
let springPort, harnessPort, brokerPort, fake, spring, harness, proxy;

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
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${cfg.noProxy ? harnessPort : proxy.port}`,
    QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
    QWEN_MANAGED_AGENT_HARNESS_TOKEN: harnessToken,
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: trustedActorHeader,
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'false',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(brokerPort),
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: brokerToken,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: credentialKey,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'e2e-local-v1',
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: runtimeState,
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${springPort}`,
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '60s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_CLI_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
  };
}
async function startSpring() {
  spring = start('spring', cfg.java ?? `${process.env.HOME}/Install/jdk21/bin/java`, [...(cfg.javaOpts ?? []), '-jar', springJar, '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=burst-mounts', `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=${boundStorageId}`, `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`], springEnv());
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 180000, spring);
  springReadyAt = Date.now();
  log('spring.ready');
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
    OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
  });
  await waitFor('harness', async () => (await fetch(`http://127.0.0.1:${harnessPort}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 120000, harness);
  harnessReadyAt = Date.now();
  log('harness.ready');
}

async function api(tenant, method, p, body, extraHeaders = {}) {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${springPort}${p}`, {
    method,
    headers: { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: trustedActor, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, code: json?.error?.code ?? null, ms: Date.now() - t0 };
}
const create = (tenant, key, ws) =>
  api(tenant, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', ...(ws ? { workspace: { workspace_id: boundWorkspaceId } } : {}), metadata: { title: 'PR13403 burst' } }, { 'idempotency-key': key });
const submit = (tenant, sessionId, key, text) =>
  api(tenant, 'POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text }] }, { 'idempotency-key': key });
function registerWorkspace(tenant) {
  sql(`INSERT INTO ${db}.managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(tenant)}, ${q(boundWorkspaceId)}, 1, ${q(boundStorageId)}, 'E2E', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`);
  sql(`INSERT INTO ${db}.managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (${q(tenant)}, ${q(boundWorkspaceId)}, ${q(trustedActor)}, TRUE, TRUE)`);
}
const hist = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
// Carrier pool size right now (ForkJoinPool-1-worker-* = virtual-thread carriers;
// more than #cores means the scheduler compensated for pinned/blocked carriers).
function carrierStats() {
  const out = spawnSync(`${process.env.HOME}/Install/jdk21/bin/jcmd`, [String(spring.child.pid), 'Thread.print'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout ?? '';
  return { carrierThreads: new Set(out.match(/"ForkJoinPool-1-worker-\d+"/g) ?? []).size, carriersBusy: (out.match(/Carrying virtual thread/g) ?? []).length };
}
// Public SSE subscribers: each GET ...events?stream=true parks one managed-agent
// virtual thread in SessionEventHub.await (synchronized + Object.wait).
const subscribers = [];
function subscribe(tenant, sessionId) {
  const ac = new AbortController();
  const rec = { ac, events: 0, completed: 0, status: null, opened: false };
  rec.done = fetch(`http://127.0.0.1:${springPort}/v1/agents/sessions/${sessionId}/events?stream=true`, {
    headers: { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: trustedActor, accept: 'text/event-stream' },
    signal: ac.signal,
  }).then(async (r) => {
    rec.status = r.status;
    rec.opened = true;
    const dec = new TextDecoder();
    for await (const chunk of r.body) {
      const s = dec.decode(chunk, { stream: true });
      rec.events += (s.match(/^event:/gm) ?? []).length;
      rec.completed += (s.match(/^event:\s*turn\.completed/gm) ?? []).length;
    }
  }).catch(() => {});
  subscribers.push(rec);
  return rec;
}
async function settle(tenant, expected, timeoutMs = cfg.settleTimeoutMs ?? 120000) {
  const t0 = Date.now();
  let rows = '';
  let midDump = null;
  while (Date.now() - t0 < timeoutMs) {
    rows = sql(`SELECT status, COUNT(*) FROM ${db}.managed_agent_turn WHERE tenant_id=${q(tenant)} GROUP BY status ORDER BY status`);
    const counts = Object.fromEntries(rows.split('\n').filter(Boolean).map((l) => l.split('\t')).map(([s, c]) => [s, Number(c)]));
    const active = (counts.ACCEPTED ?? 0) + (counts.RUNNING ?? 0) + (counts.CANCELLING ?? 0);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (active === 0 && total >= expected) return { settleMs: Date.now() - t0, turnStatus: counts, ...carrierStats(), ...(midDump ?? {}) };
    if (cfg.midDumpMs && !midDump && Date.now() - t0 >= cfg.midDumpMs) {
      const base = `${runDir}/mid-${tenant}`;
      const threads = spawnSync(`${process.env.HOME}/Install/jdk21/bin/jcmd`, [String(spring.child.pid), 'Thread.print'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout ?? '';
      fs.writeFileSync(`${base}-threads.txt`, threads);
      spawnSync(`${process.env.HOME}/Install/jdk21/bin/jcmd`, [String(spring.child.pid), 'Thread.dump_to_file', '-format=text', `${base}-vthreads.txt`], { encoding: 'utf8' });
      const trx = sql("SELECT trx_id, trx_state, TIMESTAMPDIFF(SECOND, trx_started, NOW()), trx_mysql_thread_id, IFNULL(trx_query,'') FROM information_schema.innodb_trx ORDER BY trx_started");
      const waits = sql('SELECT REQUESTING_ENGINE_TRANSACTION_ID, BLOCKING_ENGINE_TRANSACTION_ID FROM performance_schema.data_lock_waits');
      fs.writeFileSync(`${base}-innodb.txt`, `innodb_trx:\n${trx}\n\ndata_lock_waits:\n${waits}\n`);
      let pinned = null, vtStats = {};
      try {
        const vt = fs.readFileSync(`${base}-vthreads.txt`, 'utf8');
        pinned = (vt.match(/parkOnCarrierThread/g) ?? []).length;
        const vblocks = vt.split(/\n(?=#\d+ ")/);
        vtStats = {
          midVtInComputeIfAbsent: vblocks.filter((b) => b.includes('ConcurrentHashMap.computeIfAbsent') && b.includes('QwenHostedHarnessConnector')).length,
          midVtInClientInit: vblocks.filter((b) => b.includes('QwenHostedHarnessConnector.client(')).length,
          midVtInCreateSession: vblocks.filter((b) => b.includes('HostedHarnessClient.createSession')).length,
          midVtWaitingAttachmentLock: vblocks.filter((b) => b.includes('QwenHostedHarnessConnector.createOrLoad') && b.includes('ReentrantLock.lock')).length,
        };
      } catch {}
      const blocks = threads.split(/\n(?=")/).filter((b) => b.startsWith('"ForkJoinPool-1-worker'));
      midDump = { midCarriersInClient: blocks.filter((b) => b.includes('QwenHostedHarnessConnector.client(')).length, midCarriersInComputeIfAbsent: blocks.filter((b) => b.includes('ConcurrentHashMap.computeIfAbsent')).length, midAtMs: Date.now() - t0, midTrx: trx ? trx.split('\n').length : 0, midLockWaits: waits ? waits.split('\n').length : 0, midCarriersBusy: (threads.match(/Carrying virtual thread/g) ?? []).length, midPinned: pinned, midPoolWaiters: (threads.match(/DruidDataSource\.(pollLast|takeLast)/g) ?? []).length, ...vtStats };
    }
    await sleep(250);
  }
  const dump = `${runDir}/stall-${tenant}`;
  fs.writeFileSync(`${dump}-threads.txt`, spawnSync(`${process.env.HOME}/Install/jdk21/bin/jcmd`, [String(spring.child.pid), 'Thread.print'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout ?? '');
  spawnSync(`${process.env.HOME}/Install/jdk21/bin/jcmd`, [String(spring.child.pid), 'Thread.dump_to_file', '-format=text', `${dump}-vthreads.txt`], { encoding: 'utf8' });
  let pinned = null, carriersBusy = null;
  try { pinned = (fs.readFileSync(`${dump}-vthreads.txt`, 'utf8').match(/parkOnCarrierThread/g) ?? []).length; } catch {}
  try { carriersBusy = (fs.readFileSync(`${dump}-threads.txt`, 'utf8').match(/Carrying virtual thread/g) ?? []).length; } catch {}
  return { settleMs: null, turnStatus: rows, stalled: true, pinnedVirtualThreads: pinned, carriersBusy, ...(midDump ?? {}) };
}

const rounds = [];
let springReadyAt = null, harnessReadyAt = null;
async function round(scenario, n, rep) {
  const tenant = `${scenario}-${n}-${rep}-${randomBytes(4).toString('hex')}`;
  const dl0 = deadlocksLogged();
  const rec = { arm: cfg.arm, scenario, n, rep, tenant };
  if (scenario === 'diffkey') {
    const created = await Promise.all(Array.from({ length: n }, () => create(tenant, randomUUID(), false)));
    rec.create = hist(created.map((r) => r.code ? `${r.status}:${r.code}` : String(r.status)));
    const ids = created.filter((r) => r.status === 202).map((r) => r.json.id);
    const submitted = await Promise.all(ids.map(async (id, i) => { if (cfg.submitStaggerMs) await sleep(i * cfg.submitStaggerMs); return submit(tenant, id, randomUUID(), `[OK] burst ${i}`); }));
    rec.submit = hist(submitted.map((r) => r.code ? `${r.status}:${r.code}` : String(r.status)));
    rec.submitMsMax = Math.max(0, ...submitted.map((r) => r.ms));
    Object.assign(rec, await settle(tenant, submitted.filter((r) => r.status === 202).length));
  } else if (scenario === 'samekey-create' || scenario === 'samekey-create-ws' || scenario === 'diffkey-ws') {
    const ws = scenario !== 'samekey-create';
    if (ws) registerWorkspace(tenant);
    const key = randomUUID();
    const created = await Promise.all(Array.from({ length: n }, () => create(tenant, scenario === 'diffkey-ws' ? randomUUID() : key, ws)));
    rec.create = hist(created.map((r) => r.code ? `${r.status}:${r.code}` : String(r.status)));
    rec.distinctSessions = new Set(created.filter((r) => r.status === 202).map((r) => r.json.id)).size;
    rec.sessionRows = Number(sql(`SELECT COUNT(*) FROM ${db}.managed_agent_session WHERE tenant_id=${q(tenant)}`));
  } else if (scenario === 'watch' || scenario === 'idle-subs') {
    // watch: one SSE subscriber per Turn session (clients watching their Turns).
    // idle-subs: cfg.subscribers subscribers on other, idle sessions + n Turns.
    const subsN = scenario === 'watch' ? n : (cfg.subscribers ?? n);
    const created = await Promise.all(Array.from({ length: n }, () => create(tenant, randomUUID(), false)));
    rec.create = hist(created.map((r) => r.code ? `${r.status}:${r.code}` : String(r.status)));
    const ids = created.filter((r) => r.status === 202).map((r) => r.json.id);
    let subIds = ids;
    if (scenario === 'idle-subs') {
      const idle = [];
      for (let i = 0; i < subsN; i += 50) idle.push(...await Promise.all(Array.from({ length: Math.min(50, subsN - i) }, () => create(tenant, randomUUID(), false))));
      subIds = idle.filter((r) => r.status === 202).map((r) => r.json.id);
    }
    const subs = subIds.map((id) => subscribe(tenant, id));
    await sleep(cfg.subscribeSettleMs ?? 3000);
    rec.subscribers = subs.length;
    rec.subsOpen = subs.filter((s) => s.opened && s.status === 200).length;
    rec.beforeSubmit = carrierStats();
    const submitted = await Promise.all(ids.map((id, i) => submit(tenant, id, randomUUID(), `[OK] burst ${i}`)));
    rec.submit = hist(submitted.map((r) => r.code ? `${r.status}:${r.code}` : String(r.status)));
    rec.submitMsMax = Math.max(0, ...submitted.map((r) => r.ms));
    Object.assign(rec, await settle(tenant, submitted.filter((r) => r.status === 202).length));
    await sleep(1500);
    rec.subsEvents = subs.reduce((a, s) => a + s.events, 0);
    rec.subsSawCompletion = subs.filter((s) => s.completed > 0).length;
    for (const s of subs) s.ac.abort();
  } else if (scenario === 'samekey-submit') {
    const c = await create(tenant, randomUUID(), false);
    if (c.status !== 202) throw new Error(`setup create ${c.status}`);
    const key = randomUUID();
    const submitted = await Promise.all(Array.from({ length: n }, () => submit(tenant, c.json.id, key, '[OK] same key')));
    rec.submit = hist(submitted.map((r) => r.code ? `${r.status}:${r.code}` : String(r.status)));
    rec.turnRows = Number(sql(`SELECT COUNT(*) FROM ${db}.managed_agent_turn WHERE tenant_id=${q(tenant)}`));
    Object.assign(rec, await settle(tenant, 1));
  }
  await sleep(300);
  rec.deadlocks = deadlocksLogged() - dl0;
  if (spring.child.exitCode === null) {
    const histo = spawnSync(`${process.env.HOME}/Install/jdk21/bin/jcmd`, [String(spring.child.pid), 'GC.class_histogram'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout ?? '';
    const m = histo.match(/^\s*\d+:\s+(\d+)\s+\d+\s+com\.alibaba\.qwen\.code\.managedagent\.harness\.QwenHostedHarnessConnector\$AttachmentLock\b/m);
    rec.liveAttachmentLocks = m ? Number(m[1]) : 0;
  }
  const creates = Object.values(proxyStats.sessionCreates);
  rec.proxyCreatesTotal = creates.reduce((a, b) => a + b, 0);
  rec.proxyDuplicateCreates = creates.filter((c) => c > 1).length;
  rec.proxyCreateInFlightMax = proxyStats.createInFlightMax;
  rec.proxyCapabilities = proxyStats.capabilities.length;
  rounds.push(rec);
  fs.appendFileSync(`${runDir}/rounds.jsonl`, JSON.stringify(rec) + '\n');
  log('ROUND', JSON.stringify(rec));
}

let error = null;
try {
  springPort = await freePort();
  harnessPort = await freePort();
  brokerPort = await freePort();
  fake = await startFakeModel();
  harnessPortForProxy = harnessPort;
  proxy = await startProxy();
  sql(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await startSpring();
  await startHarness();
  for (let rep = 0; rep < (cfg.reps ?? 3); rep++) {
    for (const [scenario, sizes] of Object.entries(cfg.scenarios)) {
      for (const n of sizes) await round(scenario, n, rep);
    }
  }
} catch (err) {
  error = String(err?.stack ?? err);
  console.error(err);
} finally {
  for (const c of [...children].reverse()) await stop(c);
  const springLog = fs.existsSync(`${runDir}/spring.log`) ? fs.readFileSync(`${runDir}/spring.log`, 'utf8') : '';
  const summary = {
    name: cfg.name, arm: cfg.arm, jar: springJar, cli: cliBundle, error, modelCalls,
    springCannotAcquireLock: (springLog.match(/CannotAcquireLockException/g) ?? []).length,
    springDeadlockMsgs: (springLog.match(/Deadlock found when trying to get lock/g) ?? []).length,
    // -Djdk.tracePinnedThreads=full: one stack per pinning event, frames holding a monitor end in "<== monitors:N"
    pinnedTraces: (springLog.match(/^VirtualThread\[#\d+\]\/\S+ reason:MONITOR/gm) ?? []).length,
    pinnedMonitorFrames: hist((springLog.match(/^\s+\S+\(\S+\) <== monitors:\d+$/gm) ?? []).map((l) => l.trim().replace(/\(.*\)/, ''))),
    rounds: rounds.length,
    proxy: { byRoute: proxyStats.byRoute, sessionsCreated: Object.keys(proxyStats.sessionCreates).length, duplicateCreates: Object.values(proxyStats.sessionCreates).filter((c) => c > 1).length, createInFlightMax: proxyStats.createInFlightMax, capabilities: proxyStats.capabilities.map((c) => ({ ...c, at: c.at - (springReadyAt ?? 0) })) },
    springReadyAt, harnessReadyAt: harnessReadyAt ? harnessReadyAt - springReadyAt : null,
  };
  fs.writeFileSync(`${runDir}/summary.json`, JSON.stringify(summary, null, 2));
  fake?.server.closeAllConnections?.();
  fake?.server.close();
  proxy?.server.closeAllConnections?.();
  proxy?.server.close();
  console.log(`RESULT ${JSON.stringify(summary)}`);
  process.exit(0);
}
