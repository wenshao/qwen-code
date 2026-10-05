// PR #13402 packaged-stack rig: private MySQL 8.4.7 (port 13402) + the Spring
// fat jar of one arm + the packaged Hosted Harness (dist/cli.js serve
// --profile hosted-harness, built once from the trial merge) + a fake OpenAI
// model. One run = one fresh database, one fresh Spring JVM, one Harness.
// Usage: node hub.mjs <config.json>
//
// Scenarios (cfg.scenario):
//   idle-subs  cfg.subscribers SSE subscribers parked on idle sessions, then
//              cfg.turns Turns on other sessions; measures Turn settle time.
//   fanout     cfg.subscribers SSE subscribers spread round-robin over the
//              cfg.turns Turn sessions; every subscriber must receive the
//              whole committed event list (compared with the durable REST
//              list) including turn.completed.
//   cadence    cfg.subscribers idle subscribers held for cfg.holdMs; counts
//              keepalive comments and SQL statements per subscriber.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';

const S =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MYSQL_PORT = 13402;
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const W = `${S}/wt-${cfg.arm}`;
const cliBundle = `${S}/wt-merge/dist/cli.js`;
const springJar = `${W}/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar`;
const JAVA_HOME = cfg.javaHome ?? `${process.env.HOME}/Install/jdk21`;
const JCMD = `${JAVA_HOME}/bin/jcmd`;
const runDir = `${S}/runs/${cfg.name}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const db = 'h_' + cfg.name.replace(/[^A-Za-z0-9]/g, '_') + '_' + Date.now().toString(36);
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';
const trustedActor = 'e2e-actor';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const T0 = Date.now();
const rel = () => Date.now() - T0;

function sql(query) {
  const r = spawnSync(MYSQL, ['--protocol=tcp', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-uroot', '--batch', '--skip-column-names', '-e', query], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return r.stdout.trim();
}
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
// Statements executed against this run's schema (performance_schema digests).
function statementCount() {
  return Number(sql(`SELECT IFNULL(SUM(COUNT_STAR),0) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME=${q(db)}`));
}
function statementDigests() {
  const out = sql(`SELECT COUNT_STAR, LEFT(REPLACE(DIGEST_TEXT, '\\n', ' '), 140) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME=${q(db)} ORDER BY COUNT_STAR DESC LIMIT 12`);
  return out.split('\n').filter(Boolean).map((l) => { const [c, t] = l.split('\t'); return [Number(c), t]; });
}

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

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
      const deltas = cfg.deltas ?? 20;
      const gap = Math.floor((cfg.replyMs ?? 0) / deltas);
      let i = 0;
      const step = () => {
        if (res.destroyed) return;
        if (i < deltas) { send(chunk({ content: `hub-reply-${i++} ` })); if (gap > 0) setTimeout(step, gap); else step(); return; }
        send(chunk({}, 'stop', usage));
        res.end('data: [DONE]\n\n');
      };
      step();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
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
let springPort, harnessPort, brokerPort, fake, spring, harness;

function springEnv() {
  return {
    ...cleanEnv,
    JAVA_HOME,
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
  spring = start('spring', `${JAVA_HOME}/bin/java`, [...(cfg.javaOpts ?? []), '-jar', springJar, '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=hub-mounts', '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=e2e-storage', `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`], springEnv());
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 180000, spring);
  log('spring.ready', `pid=${spring.child.pid}`);
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
const create = (tenant, key) =>
  api(tenant, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', metadata: { title: 'PR13402 hub' } }, { 'idempotency-key': key });
const submit = (tenant, sessionId, key, text) =>
  api(tenant, 'POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text }] }, { 'idempotency-key': key });
async function createMany(tenant, n) {
  const out = [];
  for (let i = 0; i < n; i += 50) out.push(...await Promise.all(Array.from({ length: Math.min(50, n - i) }, () => create(tenant, randomUUID()))));
  return out;
}
const hist = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

function threadDump() {
  return spawnSync(JCMD, [String(spring.child.pid), 'Thread.print'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout ?? '';
}
// ForkJoinPool-1-worker-* are the virtual-thread carriers; more than #cores
// means the scheduler compensated for carriers pinned in Object.wait.
function carrierStats(tag) {
  const out = threadDump();
  if (tag) fs.writeFileSync(`${runDir}/threads-${tag}.txt`, out);
  return {
    carrierThreads: new Set(out.match(/"ForkJoinPool-1-worker-\d+"/g) ?? []).size,
    carriersBusy: (out.match(/Carrying virtual thread/g) ?? []).length,
    carriersInHubWait: (out.split(/\n\n/).filter((b) => /Carrying virtual thread/.test(b) && /SessionEventHub\$SessionBuffer\.await/.test(b))).length,
  };
}
function vthreadDump(tag) {
  const f = `${runDir}/vthreads-${tag}.txt`;
  spawnSync(JCMD, [String(spring.child.pid), 'Thread.dump_to_file', '-format=text', f], { encoding: 'utf8' });
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch {}
  const blocks = text.split(/\n(?=#\d+ ")/);
  const hubWaiters = blocks.filter((b) => /SessionEventHub\$SessionBuffer\.await/.test(b));
  return {
    hubWaiters: hubWaiters.length,
    hubWaitersPinned: hubWaiters.filter((b) => /Object\.wait|parkOnCarrierThread/.test(b)).length,
    hubWaitersUnmounted: hubWaiters.filter((b) => /ConditionObject\.awaitNanos/.test(b) && !/parkOnCarrierThread/.test(b)).length,
    pinnedAnywhere: (text.match(/parkOnCarrierThread/g) ?? []).length,
  };
}

// ---------- SSE subscribers ----------
const subscribers = [];
function subscribe(tenant, sessionId, idx) {
  const ac = new AbortController();
  const rec = { idx, sessionId, ac, startedAt: Date.now(), openedAt: null, status: null, events: [], keepalives: 0, completedAt: null, firstEventAt: null };
  rec.done = fetch(`http://127.0.0.1:${springPort}/v1/agents/sessions/${sessionId}/events?stream=true`, {
    headers: { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: trustedActor, accept: 'text/event-stream' },
    signal: ac.signal,
  }).then(async (r) => {
    rec.status = r.status;
    rec.openedAt = Date.now();
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, k);
        buf = buf.slice(k + 2);
        let id = null, name = null;
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) { if (/keepalive/.test(line)) rec.keepalives++; }
          else if (line.startsWith('id:')) id = line.slice(3).trim();
          else if (line.startsWith('event:')) name = line.slice(6).trim();
        }
        if (name) {
          rec.firstEventAt ??= Date.now();
          rec.events.push([Number(id), name]);
          if (name === 'turn.completed') rec.completedAt ??= Date.now();
        }
      }
    }
  }).catch(() => {});
  subscribers.push(rec);
  return rec;
}
async function durableEvents(tenant, sessionId) {
  const out = [];
  let after = 0;
  for (;;) {
    const r = await api(tenant, 'GET', `/v1/agents/sessions/${sessionId}/events?after=${after}&limit=100`);
    const data = r.json?.data ?? r.json?.events ?? [];
    if (r.status !== 200) throw new Error(`durable list ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    for (const e of data) out.push([Number(e.sequence), e.type]);
    if (data.length < 100) break;
    after = Number(data[data.length - 1].sequence);
  }
  return out;
}

async function settle(tenant, expected, timeoutMs = cfg.settleTimeoutMs ?? 120000) {
  const t0 = Date.now();
  let rows = '';
  while (Date.now() - t0 < timeoutMs) {
    rows = sql(`SELECT status, COUNT(*) FROM ${db}.managed_agent_turn WHERE tenant_id=${q(tenant)} GROUP BY status ORDER BY status`);
    const counts = Object.fromEntries(rows.split('\n').filter(Boolean).map((l) => l.split('\t')).map(([s, c]) => [s, Number(c)]));
    const active = (counts.ACCEPTED ?? 0) + (counts.RUNNING ?? 0) + (counts.CANCELLING ?? 0);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (active === 0 && total >= expected) return { settleMs: Date.now() - t0, turnStatus: counts };
    await sleep(250);
  }
  return { settleMs: null, stalled: true, turnStatus: rows };
}

const result = { name: cfg.name, arm: cfg.arm, scenario: cfg.scenario, jdk: JAVA_HOME.replace(/.*\//, ''), javaOpts: cfg.javaOpts ?? [] };
async function run(tenant) {
  const nTurns = cfg.turns ?? 0;
  const nSubs = cfg.subscribers ?? 0;
  const turnCreated = nTurns ? await createMany(tenant, nTurns) : [];
  const turnIds = turnCreated.filter((r) => r.status === 202).map((r) => r.json.id);
  result.turnSessions = turnIds.length;
  let subIds;
  if (cfg.scenario === 'fanout') {
    subIds = Array.from({ length: nSubs }, (_, i) => turnIds[i % turnIds.length]);
  } else {
    const idle = await createMany(tenant, nSubs);
    subIds = idle.filter((r) => r.status === 202).map((r) => r.json.id);
  }
  result.subscribers = subIds.length;
  const stmt0 = statementCount();
  const tSub = Date.now();
  const subs = subIds.map((id, i) => subscribe(tenant, id, i));
  await sleep(cfg.subscribeSettleMs ?? 5000);
  const openMs = subs.filter((s) => s.openedAt).map((s) => s.openedAt - s.startedAt);
  result.subsOpenBeforeSubmit = subs.filter((s) => s.status === 200).length;
  result.openMsP50 = pct(openMs, 0.5);
  result.openMsMax = openMs.length ? Math.max(...openMs) : null;
  result.beforeSubmit = { ...carrierStats('before'), ...vthreadDump('before') };
  log('parked', JSON.stringify({ open: result.subsOpenBeforeSubmit, ...result.beforeSubmit }));

  if (cfg.scenario === 'cadence') {
    await sleep(cfg.holdMs ?? 46000);
    const stmt1 = statementCount();
    const heldMs = Date.now() - tSub;
    result.heldMs = heldMs;
    result.statements = stmt1 - stmt0;
    result.statementsPerSubPerMin = +(((stmt1 - stmt0) / subs.length) / (heldMs / 60000)).toFixed(2);
    result.keepalives = hist(subs.map((s) => s.keepalives));
    result.digests = statementDigests();
    result.after = carrierStats('after');
  } else {
    const tSubmit = Date.now();
    const submitted = await Promise.all(turnIds.map((id, i) => submit(tenant, id, randomUUID(), `[OK] hub ${i}`)));
    result.submit = hist(submitted.map((r) => r.code ? `${r.status}:${r.code}` : String(r.status)));
    result.submitMsMax = Math.max(0, ...submitted.map((r) => r.ms));
    Object.assign(result, await settle(tenant, submitted.filter((r) => r.status === 202).length));
    result.afterSettle = carrierStats('after');
    // Give subscribers a bounded grace window to drain after the Turns settle.
    const graceEnd = Date.now() + (cfg.graceMs ?? 15000);
    while (Date.now() < graceEnd) {
      if (cfg.scenario !== 'fanout' || subs.every((s) => s.completedAt)) break;
      await sleep(200);
    }
    result.subsOpenAtEnd = subs.filter((s) => s.status === 200).length;
    if (cfg.scenario === 'fanout') {
      const lat = subs.filter((s) => s.completedAt).map((s) => s.completedAt - tSubmit);
      result.subsSawCompletion = lat.length;
      result.completionMsP50 = pct(lat, 0.5);
      result.completionMsMax = lat.length ? Math.max(...lat) : null;
      // Every subscriber started at sequence 0, so its stream must equal the
      // durable REST list of its session (same ids, same names, same order).
      const durable = new Map();
      for (const id of turnIds) durable.set(id, await durableEvents(tenant, id));
      result.durableEventsPerSession = hist([...durable.values()].map((d) => d.length));
      result.durableTypes = hist([...durable.values()].flat().map(([, t]) => t));
      let identical = 0, prefix = 0, diverged = 0;
      const samples = [];
      for (const s of subs) {
        const d = durable.get(s.sessionId);
        const a = JSON.stringify(s.events), b = JSON.stringify(d);
        if (a === b) identical++;
        else if (b.startsWith(a.slice(0, -1))) prefix++;
        else { diverged++; if (samples.length < 3) samples.push({ idx: s.idx, got: s.events.slice(0, 12), durable: d.slice(0, 12) }); }
      }
      result.streamVsDurable = { identical, strictPrefix: prefix, diverged, samples };
    }
  }
  for (const s of subs) s.ac.abort();
}

let error = null;
try {
  springPort = await freePort();
  harnessPort = await freePort();
  brokerPort = await freePort();
  fake = await startFakeModel();
  sql(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await startSpring();
  await startHarness();
  // Warm-up: one Turn end to end so class loading and pools are not measured.
  const wt = `warm-${randomBytes(3).toString('hex')}`;
  const w = await create(wt, randomUUID());
  if (w.status !== 202) throw new Error(`warm create ${w.status} ${JSON.stringify(w.json)}`);
  await submit(wt, w.json.id, randomUUID(), '[OK] warm');
  result.warm = await settle(wt, 1, 60000);
  log('warm', JSON.stringify(result.warm));
  await run(`${cfg.scenario}-${randomBytes(4).toString('hex')}`);
} catch (err) {
  error = String(err?.stack ?? err);
  console.error(err);
} finally {
  for (const c of [...children].reverse()) await stop(c);
  const springLog = fs.existsSync(`${runDir}/spring.log`) ? fs.readFileSync(`${runDir}/spring.log`, 'utf8') : '';
  Object.assign(result, {
    error, modelCalls, db,
    springErrors: (springLog.match(/ ERROR /g) ?? []).length,
    pinnedTraces: (springLog.match(/^VirtualThread\[#\d+\]\/\S+ reason:MONITOR/gm) ?? []).length,
    wallMs: rel(),
  });
  fs.writeFileSync(`${runDir}/result.json`, JSON.stringify(result, null, 2));
  fake?.server.closeAllConnections?.();
  fake?.server.close();
  console.log(`RESULT ${JSON.stringify(result)}`);
  process.exit(0);
}
