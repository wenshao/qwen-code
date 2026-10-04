// PR #13359 real-stack rig: MySQL (shared) + Spring jar + packaged Hosted
// Harness of one arm + a controllable fake OpenAI model + streaming taps on
// Spring->Harness and Harness->Broker. One run = one fresh database, one
// Spring, one Harness. Usage: node driver.mjs <config.json>
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';

const S =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f2664731-3690-4937-833c-9c220ef51e4c/scratchpad';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MYSQL_PORT = 33359;
const W = `${S}/wt-${cfg.arm}`;
const cliBundle = `${W}/dist/cli.js`;
const springJar =
  cfg.jar ??
  `${W}/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar`;
const runDir = `${S}/runs/${cfg.name}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const db = 'ma_' + cfg.name.replace(/[^A-Za-z0-9]/g, '_');
const tenant = 'deadline-e2e';
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';
const trustedActor = 'e2e-actor';
const boundWorkspaceId = 'e2e-workspace';
const boundStorageId = 'e2e-storage';

const startedAt = Date.now();
let T0 = startedAt;
const rel = () => Date.now() - T0;
const timeline = [];
const mark = (kind, data = {}) => {
  const entry = { t: rel(), kind, ...data };
  timeline.push(entry);
  console.log(`[${String(entry.t).padStart(6)}ms] ${kind} ${JSON.stringify(data)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sql(query) {
  const r = spawnSync(
    'mysql',
    ['--protocol=tcp', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-uroot', '--batch', '--skip-column-names', '-e', query],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return r.stdout.trim();
}
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

// ---------- fake model ----------
const modelLog = [];
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => p.text ?? '').join('');
  }
  return '';
}
async function startFakeModel() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {}
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const last = messages.at(-1);
      const text = lastUserText(messages);
      const entry = {
        id: modelLog.length,
        arrivedAt: rel(),
        stream: body.stream === true,
        roles: messages.map((m) => m.role).join(','),
        lastRole: last?.role,
        lastUser: text.slice(0, 80),
        userTexts: messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 60)),
        messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? null)).slice(-240), ...(m.tool_calls ? { tool_calls: m.tool_calls.map((c) => c.function?.name) } : {}) })),
      };
      modelLog.push(entry);
      res.on('close', () => {
        entry.closedAt = rel();
        entry.completed = res.writableFinished;
      });
      const model = body.model ?? 'fake-model';
      const id = 'chatcmpl-' + randomBytes(6).toString('hex');
      const created = Math.floor(Date.now() / 1000);
      const chunk = (delta, finish = null, usage) => ({
        id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...(usage ? { usage } : {}),
      });
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      // A failed/cancelled turn's user text is merged into the next user
      // message, so the newest marker (last occurrence) decides the mode.
      let mode = 'ok';
      if (last?.role === 'tool') mode = 'after-tool';
      else {
        let best = -1;
        for (const [marker, m] of [['[HOLD]', 'hold'], ['[TRICKLE]', 'trickle'], ['[WRITE]', 'write'], ['[SLOW]', 'slow'], ['[OK]', 'ok']]) {
          const at = text.lastIndexOf(marker);
          if (at > best) { best = at; mode = m; }
        }
      }
      entry.mode = mode;
      if (!entry.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
      const finish = (reason = 'stop') => {
        send(chunk({}, reason, usage));
        res.end('data: [DONE]\n\n');
      };
      send(chunk({ role: 'assistant' }));
      if (mode === 'hold') {
        send(chunk({ content: 'PARTIAL_BEFORE_HOLD ' }));
        return; // never another byte, never close
      }
      if (mode === 'trickle') {
        let n = 0;
        const timer = setInterval(() => send(chunk({ content: `tick-${++n}-${randomBytes(3).toString('hex')} ` })), cfg.trickleMs ?? 10000);
        send(chunk({ content: 'TRICKLE_START ' }));
        res.on('close', () => clearInterval(timer));
        return;
      }
      if (mode === 'slow') {
        send(chunk({ content: 'SLOW_START ' }));
        setTimeout(() => { if (!res.destroyed) { send(chunk({ content: 'SLOW_DONE' })); finish(); } }, cfg.slowMs ?? 5000);
        return;
      }
      if (mode === 'write') {
        send(chunk({ tool_calls: [{ index: 0, id: 'call_' + randomBytes(6).toString('hex'), type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ file_path: 'deadline-probe.txt', content: 'DEADLINE_PROBE\n' }) } }] }));
        finish('tool_calls');
        return;
      }
      if (mode === 'after-tool') {
        send(chunk({ content: 'TOOL_DONE' }));
        finish();
        return;
      }
      send(chunk({ content: 'OK_REPLY' }));
      finish();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

// ---------- streaming tap ----------
const HOP = new Set(['connection', 'upgrade', 'http2-settings', 'keep-alive', 'transfer-encoding', 'host', 'proxy-connection', 'te']);
async function startTap(name, targetPort, holdMatcher) {
  const observations = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const obs = { t: rel(), method: req.method, url: req.url };
      if (body.length && body.length < 65536 && /\/prompt$|executions/.test(req.url ?? '')) obs.body = body.toString('utf8');
      observations.push(obs);
      if (holdMatcher?.(req.method, req.url ?? '')) {
        obs.held = true;
        mark(`${name}.held`, { method: req.method, url: req.url });
        req.socket.once('close', () => res.destroy());
        return;
      }
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
      headers['host'] = `127.0.0.1:${targetPort}`;
      headers['content-length'] = String(body.length);
      const up = httpRequest({ host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers }, (upRes) => {
        obs.status = upRes.statusCode;
        const h = {};
        for (const [k, v] of Object.entries(upRes.headers)) if (!HOP.has(k) && k !== 'content-length') h[k] = v;
        res.writeHead(upRes.statusCode ?? 502, h);
        upRes.pipe(res);
        upRes.on('aborted', () => res.destroy());
        upRes.on('close', () => { if (!upRes.complete) res.destroy(); });
        if ((upRes.statusCode ?? 0) >= 400) {
          const errChunks = [];
          upRes.on('data', (c) => errChunks.push(c));
          upRes.on('end', () => (obs.errorBody = Buffer.concat(errChunks).toString('utf8').slice(0, 400)));
        }
      });
      up.on('error', (e) => {
        obs.error = String(e);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.on('close', () => { if (!res.writableFinished) up.destroy(); });
      up.end(body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port, observations };
}

// ---------- processes ----------
const children = [];
function start(name, cmd, args, env, cwd) {
  const out = fs.openSync(`${runDir}/${name}.log`, 'a');
  const child = spawn(cmd, args, { env, cwd: cwd ?? W, detached: true, stdio: ['ignore', out, out] });
  const rec = { name, child };
  children.push(rec);
  child.on('exit', (code, signal) => mark(`${name}.exit`, { code, signal }));
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

const result = { name: cfg.name, arm: cfg.arm, config: cfg, startedAt: new Date(startedAt).toISOString() };
let fake, harnessTap, brokerTap, spring, harness;
const tmp = `${runDir}/tmp`;
const workspace = `${tmp}/workspace`;
const workspaceMount = `${tmp}/workspace-mount`;
const harnessHome = `${tmp}/harness-home`;
const runtimeHome = `${tmp}/runtime-home`;
const runtimeState = `${tmp}/runtime-state`;
for (const d of [workspace, workspaceMount, `${harnessHome}/.qwen`, `${runtimeHome}/.qwen`, runtimeState]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(`${harnessHome}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
fs.writeFileSync(`${runtimeHome}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
const trustedFolders = `${tmp}/trusted-folders.json`;
fs.writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);

const harnessToken = randomBytes(24).toString('hex');
const brokerToken = randomBytes(24).toString('hex');
const credentialKey = randomBytes(32).toString('base64');
const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
let springPort, harnessPort, brokerPort;

function springEnv() {
  return {
    ...cleanEnv,
    HOME: runtimeHome,
    QWEN_HOME: `${runtimeHome}/.qwen`,
    TMPDIR: tmp,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(springPort),
    SPRING_DATASOURCE_PASSWORD: '',
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${MYSQL_PORT}/${db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${harnessTap.port}`,
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
    ...(cfg.springEnv ?? {}),
  };
}
function springArgs() {
  return [
    '-jar', springJar,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${tenant}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=${boundStorageId}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`,
    ...(cfg.springArgs ?? []),
  ];
}
async function startSpring() {
  spring = start('spring', 'java', springArgs(), springEnv());
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 180000, spring);
  mark('spring.ready');
}
async function startHarness() {
  harness = start('harness', process.execPath, [
    cliBundle, 'serve', '--profile', 'hosted-harness', '--port', String(harnessPort), '--hostname', '127.0.0.1',
    '--require-auth', '--no-web', '--workspace', workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${brokerTap.port}`,
    `--managed-runtime-broker-token=${brokerToken}`,
  ], {
    ...cleanEnv,
    HOME: harnessHome,
    QWEN_HOME: `${harnessHome}/.qwen`,
    QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_SERVER_TOKEN: harnessToken,
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: fake.baseUrl,
    OPENAI_MODEL: 'fake-model',
    QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: brokerToken,
    QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerTap.port}`,
    ...(cfg.harnessEnv ?? {}),
  });
  await waitFor('harness', async () => (await fetch(`http://127.0.0.1:${harnessPort}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 120000, harness);
  mark('harness.ready');
}

const H = { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: trustedActor };
const springUrl = () => `http://127.0.0.1:${springPort}`;
async function api(method, p, body, extraHeaders = {}) {
  const r = await fetch(springUrl() + p, {
    method,
    headers: { ...H, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text: text.slice(0, 600) };
}

try {
  springPort = await freePort();
  harnessPort = await freePort();
  brokerPort = await freePort();
  fake = await startFakeModel();
  harnessTap = await startTap('harnessTap', harnessPort);
  brokerTap = await startTap('brokerTap', brokerPort, cfg.holdBrokerStart ? (m, u) => m === 'POST' && u.includes('/executions/') && u.endsWith(':start') : undefined);
  sql(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  if (cfg.bootOnly) {
    // Boot-validation probe: Spring only, record whether it comes up.
    spring = start('spring', 'java', springArgs(), springEnv());
    let up = false;
    try {
      await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 120000, spring);
      up = true;
    } catch {}
    const log = fs.readFileSync(`${runDir}/spring.log`, 'utf8');
    const m = log.match(/Hosted Harness turn deadline[^\n]*/) ?? log.match(/IllegalStateException: [^\n]*/) ?? log.match(/APPLICATION FAILED TO START[\s\S]{0,600}/);
    result.boot = { up, exit: spring.child.exitCode, message: m?.[0] ?? null };
    mark('boot', result.boot);
  } else {
    await startSpring();
    sql(`INSERT INTO ${db}.managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(tenant)}, ${q(boundWorkspaceId)}, 1, ${q(boundStorageId)}, 'E2E', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`);
    sql(`INSERT INTO ${db}.managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (${q(tenant)}, ${q(boundWorkspaceId)}, ${q(trustedActor)}, TRUE, TRUE)`);
    await startHarness();

    // ---- scenario ----
    T0 = Date.now();
    const create = await api('POST', '/v1/agents/sessions', {
      agent_id: 'qwen-code',
      input: [{ type: 'text', text: cfg.prompt }],
      ...(cfg.workspace === false ? {} : { workspace: { workspace_id: boundWorkspaceId } }),
      metadata: { title: `PR13359 ${cfg.name}` },
    }, { 'idempotency-key': `create-${cfg.name}-${Date.now()}` });
    mark('session.create', { status: create.status });
    if (create.status !== 202) throw new Error(`create ${create.status} ${create.text}`);
    const sessionId = create.json.id;
    result.sessionId = sessionId;

    const events = [];
    let cursor = 0;
    let lastRows = '';
    const rowSamples = [];
    const actionsDone = new Set();
    const seenActions = new Set();
    const followups = [];
    const windowMs = cfg.windowMs ?? 60000;
    let nextRowSample = 0;
    while (rel() < windowMs) {
      try {
        const page = await api('GET', `/v1/agents/sessions/${sessionId}/events?after=${cursor}&limit=100`);
        for (const e of page.json?.data ?? []) {
          cursor = Math.max(cursor, e.sequence);
          const rec = { t: rel(), sequence: e.sequence, type: e.type, terminal: e.terminal, turn: e.turn_id, data: e.data };
          events.push(rec);
          if (e.terminal || /turn\.|action|error|failed|cancel/.test(e.type)) mark('event', { type: e.type, terminal: e.terminal, turn: e.turn_id, data: e.data });
        }
      } catch (err) {
        mark('poll.error', { err: String(err) });
      }
      if (rel() >= nextRowSample) {
        nextRowSample = rel() + 1000;
        try {
          const rows = sql(`SELECT turn_id, status, IFNULL(error_code,'NULL') FROM ${db}.managed_agent_turn WHERE session_id=${q(sessionId)} ORDER BY created_at`);
          rowSamples.push({ t: rel(), rows });
          if (rows !== lastRows) { mark('turnRows', { rows }); lastRows = rows; }
        } catch (err) { mark('sql.error', { err: String(err) }); }
      }
      for (const [i, step] of (cfg.steps ?? []).entries()) {
        if (actionsDone.has(i) || rel() < step.at) continue;
        actionsDone.add(i);
        if (step.do === 'followup') {
          const r = await api('POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text: step.text ?? '[OK] FOLLOWUP' }] }, { 'idempotency-key': `followup-${i}-${Date.now()}` });
          followups.push({ t: rel(), status: r.status, body: r.text });
          mark('followup', { status: r.status, body: r.text.slice(0, 200) });
        } else if (step.do === 'cancel') {
          const turns = await api('GET', `/v1/agents/sessions/${sessionId}/turns`);
          const turnId = turns.json?.data?.[0]?.id;
          const sentAt = rel();
          const r = await api('POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.cancel', turn_id: turnId }, { 'idempotency-key': `cancel-${Date.now()}` });
          result.cancel = { sentAt, status: r.status, turnId };
          mark('cancel', { status: r.status, turnId });
        } else if (step.do === 'actions') {
          const r = await api('GET', `/v1/agents/sessions/${sessionId}/actions`);
          (result.actionSnapshots ??= []).push({ t: rel(), status: r.status, json: r.json });
          for (const a of r.json?.data ?? []) seenActions.add(a.id);
          mark('actions', { status: r.status, data: r.json?.data?.map((a) => ({ id: a.id, state: a.state ?? a.status })) });
        } else if (step.do === 'actionGet') {
          for (const id of seenActions) {
            const r = await api('GET', `/v1/agents/sessions/${sessionId}/actions/${id}`);
            (result.actionGets ??= []).push({ t: rel(), id, status: r.status, json: r.json, text: r.json ? undefined : r.text });
            mark('actionGet', { id, status: r.status, state: r.json?.state ?? r.json?.status, body: JSON.stringify(r.json ?? r.text).slice(0, 400) });
          }
        } else if (step.do === 'respond') {
          const list = await api('GET', `/v1/agents/sessions/${sessionId}/actions`);
          const a = list.json?.data?.[0] ?? (seenActions.size ? { id: [...seenActions].at(-1) } : undefined);
          if (!a) { mark('respond.none'); continue; }
          const detail = await api('GET', `/v1/agents/sessions/${sessionId}/actions/${a.id}`);
          const body = { kind: 'permission', input_revision: detail.json?.input_revision ?? a.input_revision ?? '1', policy_revision: detail.json?.policy_revision ?? a.policy_revision ?? 'hosted-tool-approval/1', option_id: step.option ?? 'allow' };
          const r = await api('POST', `/v1/agents/sessions/${sessionId}/actions/${a.id}/responses`, body, { 'idempotency-key': `respond-${Date.now()}` });
          (result.responds ??= []).push({ t: rel(), actionBefore: detail.json, status: r.status, body: r.text });
          mark('respond', { status: r.status, body: r.text.slice(0, 300) });
        } else if (step.do === 'restart') {
          await stop(harness);
          await stop(spring);
          mark('stack.stopped');
          await startSpring();
          await startHarness();
        }
      }
      await sleep(250);
    }

    // ---- collect ----
    result.events = events;
    result.followups = followups;
    result.rowSamples = rowSamples;
    result.turns = (await api('GET', `/v1/agents/sessions/${sessionId}/turns`)).json;
    result.actions = (await api('GET', `/v1/agents/sessions/${sessionId}/actions`)).json;
    result.durable = {
      turns: sql(`SELECT turn_id, status, IFNULL(error_code,'NULL'), created_at, IFNULL(completed_at,'NULL') FROM ${db}.managed_agent_turn WHERE session_id=${q(sessionId)} ORDER BY created_at`),
      terminalEvents: sql(`SELECT turn_id, event_type, sequence_id FROM ${db}.managed_agent_event WHERE session_id=${q(sessionId)} AND terminal=TRUE ORDER BY sequence_id`),
    };
    const dump = spawnSync('mysqldump', ['--protocol=tcp', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-uroot', '--skip-extended-insert', '--no-create-info', db], { encoding: 'latin1', maxBuffer: 512 * 1024 * 1024 });
    fs.writeFileSync(`${runDir}/dump.sql`, dump.stdout ?? '', 'latin1');
    result.durable.deadlineMentions = (dump.stdout ?? '').split('\n').filter((l) => /deadline_exceeded|hosted_turn_deadline_exceeded|turn_result/.test(l)).map((l) => {
      const table = l.match(/INSERT INTO `([^`]+)`/)?.[1];
      const hits = [...l.matchAll(/.{0,90}(deadline_exceeded|"subtype":"turn_result".{0,120})/g)].map((m) => m[0]);
      return { table, hits: hits.slice(0, 3) };
    });
  }
} catch (err) {
  result.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  result.model = modelLog;
  result.harnessTap = harnessTap?.observations.filter((o) => o.method !== 'GET' || o.status >= 400);
  result.harnessPrompts = harnessTap?.observations.filter((o) => o.url?.endsWith('/prompt')).map((o) => ({ t: o.t, status: o.status, deadlineMs: (() => { try { return JSON.parse(o.body).deadlineMs ?? null; } catch { return 'unparsed'; } })() }));
  result.brokerTap = brokerTap?.observations.filter((o) => o.method !== 'GET').map(({ body, ...o }) => o);
  result.timeline = timeline;
  for (const c of [...children].reverse()) await stop(c);
  try {
    const hl = fs.readFileSync(`${runDir}/harness.log`, 'utf8');
    result.harnessLogLines = hl.split('\n').filter((l) => /deadline|Hosted Harness turn|failed|error/i.test(l)).slice(0, 40);
  } catch {}
  fs.writeFileSync(`${runDir}/result.json`, JSON.stringify(result, null, 2));
  fake?.server.closeAllConnections?.();
  fake?.server.close();
  harnessTap?.server.closeAllConnections?.();
  harnessTap?.server.close();
  brokerTap?.server.closeAllConnections?.();
  brokerTap?.server.close();
  console.log(`RESULT ${runDir}/result.json error=${result.error ? 'yes' : 'no'}`);
  process.exit(0);
}
