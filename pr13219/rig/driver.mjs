// PR #13219 real-stack rig: private MySQL 8.4 (shared, one db per run) +
// Spring Managed Agent Server jar of one arm + packaged Hosted Harness of the
// same arm + a fake OpenAI model + three programmable fault taps:
//   harnessTap  Spring  -> Harness        (/session, /prompt, /actions/.../resolve, DELETE /session)
//   storeTap    Harness -> Session Store  (/writers:seal, /writers:renew, ...)
//   brokerTap   Harness -> Runtime Broker
// Usage: node driver.mjs <arm> <scenario> [runName]
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';

const RIG = '/Users/wenshao/pr13219-rig';
const [arm, scenario, runNameArg] = process.argv.slice(2);
const runName = runNameArg ?? `${arm}-${scenario}`;
const MYSQL_PORT = 33219;
const W = `${RIG}/src-${arm === 'cand' ? 'head' : arm}`;
const cliBundle = `${W}/dist/cli.js`;
const springJar = `${RIG}/server/${arm}-server.jar`;
const runDir = `${RIG}/runs/${runName}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const db = 'ma_' + runName.replace(/[^A-Za-z0-9]/g, '_');
const tenant = 'retry-e2e';
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';
const trustedActor = 'e2e-actor';
const boundWorkspaceId = 'e2e-workspace';
const boundStorageId = 'e2e-storage';

let T0 = Date.now();
const rel = () => Date.now() - T0;
const timeline = [];
const mark = (kind, data = {}) => {
  const entry = { t: rel(), kind, ...data };
  timeline.push(entry);
  console.log(`[${String(entry.t).padStart(7)}ms] ${kind} ${JSON.stringify(data).slice(0, 400)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sql(query) {
  const r = spawnSync('mysql', ['--protocol=tcp', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-uroot', '--batch', '--skip-column-names', '-e', query], { encoding: 'utf8' });
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
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const last = messages.at(-1);
      const text = lastUserText(messages);
      const entry = { id: modelLog.length, t: rel(), stream: body.stream === true, lastRole: last?.role, lastUser: text.slice(-80) };
      modelLog.push(entry);
      const model = body.model ?? 'fake-model';
      const id = 'chatcmpl-' + randomBytes(6).toString('hex');
      const created = Math.floor(Date.now() / 1000);
      const chunk = (delta, finish = null, usage) => ({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) });
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      let mode = 'ok';
      if (last?.role === 'tool') mode = 'after-tool';
      else {
        let best = -1;
        for (const [marker, m] of [['[WRITE]', 'write'], ['[MULTI]', 'multi'], ['[SLOW]', 'slow'], ['[OK]', 'ok']]) {
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
      const finish = (reason = 'stop') => { send(chunk({}, reason, usage)); res.end('data: [DONE]\n\n'); };
      send(chunk({ role: 'assistant' }));
      if (mode === 'write') {
        send(chunk({ tool_calls: [{ index: 0, id: 'call_' + randomBytes(6).toString('hex'), type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ file_path: 'retry-probe.txt', content: 'RETRY_PROBE\n' }) } }] }));
        finish('tool_calls');
        return;
      }
      if (mode === 'after-tool') { send(chunk({ content: 'TOOL_DONE' })); finish(); return; }
      if (mode === 'slow') { send(chunk({ content: 'SLOW_START ' })); await sleep(ctx.slowMs ?? 15000); if (!res.destroyed) { send(chunk({ content: 'SLOW_DONE' })); finish(); } return; }
      if (mode === 'multi') {
        for (let i = 1; i <= 6; i++) { send(chunk({ content: `part-${i} ` })); await sleep(250); }
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

// ---------- programmable fault tap ----------
// fault = { id, method, re, status, body, times, skip, mode: 'respond'|'reset' }
const HOP = new Set(['connection', 'upgrade', 'http2-settings', 'keep-alive', 'transfer-encoding', 'host', 'proxy-connection', 'te']);
async function startTap(name, targetPortFn, quietRe) {
  const tap = { name, observations: [], faults: [], echo: {} };
  tap.addFault = (f) => { const fault = { hits: 0, seen: 0, times: Infinity, skip: 0, mode: 'respond', status: 503, ...f }; tap.faults.push(fault); mark(`${name}.fault+`, { id: fault.id, method: fault.method, re: fault.re, status: fault.status, times: fault.times, skip: fault.skip }); return fault; };
  tap.clearFault = (id) => { tap.faults = tap.faults.filter((f) => f.id !== id); mark(`${name}.fault-`, { id }); };
  tap.server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = req.url ?? '';
      const obs = { t: rel(), method: req.method, url };
      if (!(quietRe && quietRe.test(url) && req.method === 'GET')) tap.observations.push(obs);
      for (const f of tap.faults) {
        if (f.method && f.method !== req.method) continue;
        if (f.re && !new RegExp(f.re).test(url)) continue;
        f.seen++;
        if (f.seen <= f.skip) break;
        if (f.hits >= f.times) break;
        f.hits++;
        obs.fault = f.id;
        obs.status = f.mode === 'reset' ? 'reset' : f.status;
        if (f.mode === 'reset') { req.socket.destroy(); return; }
        if (f.mode === 'forward-fail') {
          const tp = targetPortFn();
          const hh = {};
          for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) hh[k] = v;
          hh['host'] = `127.0.0.1:${tp}`;
          hh['content-length'] = String(body.length);
          const up2 = httpRequest({ host: '127.0.0.1', port: tp, method: req.method, path: url, headers: hh }, (upRes) => {
            obs.upstream = upRes.statusCode;
            for (const [k, v] of Object.entries(upRes.headers)) if (/^x-qwen-harness-/i.test(k)) tap.echo[k] = v;
            upRes.resume();
            upRes.on('end', () => { res.writeHead(f.status, { 'content-type': 'application/json', ...tap.echo }); res.end(f.body ?? JSON.stringify({ code: 'tap_injected_failure' })); });
          });
          up2.on('error', (e) => { obs.upstream = String(e).slice(0, 80); res.writeHead(502); res.end(); });
          up2.end(body);
          return;
        }
        res.writeHead(f.status, { 'content-type': 'application/json', ...(f.noEcho ? {} : tap.echo) });
        res.end(f.body ?? JSON.stringify({ code: 'tap_injected_failure', message: `injected by ${name}` }));
        return;
      }
      const targetPort = targetPortFn();
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
      headers['host'] = `127.0.0.1:${targetPort}`;
      headers['content-length'] = String(body.length);
      const up = httpRequest({ host: '127.0.0.1', port: targetPort, method: req.method, path: url, headers }, (upRes) => {
        obs.status = upRes.statusCode;
        for (const [k, v] of Object.entries(upRes.headers)) if (/^x-qwen-harness-/i.test(k)) tap.echo[k] = v;
        const h = {};
        for (const [k, v] of Object.entries(upRes.headers)) if (!HOP.has(k) && k !== 'content-length') h[k] = v;
        res.writeHead(upRes.statusCode ?? 502, h);
        upRes.pipe(res);
        upRes.on('aborted', () => res.destroy());
        upRes.on('close', () => { if (!upRes.complete) res.destroy(); });
        if ((upRes.statusCode ?? 0) >= 400) {
          const errChunks = [];
          upRes.on('data', (c) => errChunks.push(c));
          upRes.on('end', () => (obs.errorBody = Buffer.concat(errChunks).toString('utf8').slice(0, 300)));
        }
      });
      up.on('error', (e) => { obs.status = 'upstream-error'; obs.error = String(e).slice(0, 120); if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on('close', () => { if (!res.writableFinished) up.destroy(); });
      up.end(body);
    });
  });
  await new Promise((r) => tap.server.listen(0, '127.0.0.1', r));
  tap.port = tap.server.address().port;
  tap.count = (pred) => tap.observations.filter(pred).length;
  return tap;
}

// ---------- processes ----------
const children = [];
function start(name, cmd, args, env) {
  const out = fs.openSync(`${runDir}/${name}.log`, 'a');
  const child = spawn(cmd, args, { env, cwd: W, detached: true, stdio: ['ignore', out, out] });
  const rec = { name, child };
  children.push(rec);
  child.on('exit', (code, signal) => mark(`${name}.exit`, { code, signal }));
  return rec;
}
const alive = (rec) => rec && rec.child.exitCode === null && rec.child.signalCode === null;
async function stop(rec, signal = 'SIGTERM') {
  if (!alive(rec)) return;
  try { process.kill(-rec.child.pid, signal); } catch {}
  for (let i = 0; i < 150 && alive(rec); i++) await sleep(100);
  try { process.kill(-rec.child.pid, 'SIGKILL'); } catch {}
  for (let i = 0; i < 50 && alive(rec); i++) await sleep(100);
}
async function waitFor(name, fn, timeoutMs, rec) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (rec && !alive(rec)) throw new Error(`${name} exited early`);
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(200);
  }
  throw new Error(`${name} not ready in ${timeoutMs}ms`);
}

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?|all|no)_proxy$/i.test(k) && !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(k) && !/(api_?key|token|secret|password|credentials?)$/i.test(k)));

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

const ctx = { arm, scenario, runName, runDir, db, mark, sleep, sql, q, rel };
let fake, harnessTap, storeTap, brokerTap, spring, harness;
let springPort, harnessPort, brokerPort;

// Fast retry config shared by both arms (base ignores the keys it lacks).
const FAST_RETRY = [
  '--qwen.managed-agent.dispatch.retry-initial-delay=200ms',
  '--qwen.managed-agent.dispatch.retry-max-delay=1s',
  '--qwen.managed-agent.dispatch.max-pre-admission-retries=2',
  '--qwen.managed-agent.dispatch.max-post-admission-retries=3',
  '--qwen.managed-agent.dispatch.max-operation-retries=3',
];
ctx.FAST_RETRY = FAST_RETRY;
ctx.springArgsExtra = [];
ctx.springEnvExtra = {};
ctx.harnessEnvExtra = {};

function springEnv() {
  return {
    ...cleanEnv,
    HOME: runtimeHome, QWEN_HOME: `${runtimeHome}/.qwen`, TMPDIR: tmp,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
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
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${storeTap.port}`,
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '60s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_CLI_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
    ...ctx.springEnvExtra,
  };
}
function springArgs(extra = []) {
  return [
    '-jar', springJar,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${tenant}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=${boundStorageId}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`,
    ...ctx.springArgsExtra,
    ...extra,
  ];
}
ctx.startSpring = async (extra = []) => {
  spring = start('spring', 'java', springArgs(extra), springEnv());
  ctx.spring = spring;
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 240000, spring);
  mark('spring.ready');
};
ctx.bootSpringOnly = async (extra = []) => {
  let offset = 0;
  try { offset = fs.statSync(`${runDir}/spring.log`).size; } catch {}
  spring = start('spring', 'java', springArgs(extra), springEnv());
  let up = false;
  try { await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 240000, spring); up = true; } catch {}
  const log = fs.readFileSync(`${runDir}/spring.log`).subarray(offset).toString('utf8');
  const m = log.match(/Managed dispatch retry[^\n]*/) ?? log.match(/IllegalStateException: [^\n]*/);
  const r = { up, exit: spring.child.exitCode, message: m?.[0] ?? null };
  await stop(spring);
  return r;
};
ctx.stopSpring = async () => { await stop(spring); mark('spring.stopped'); };
ctx.startHarness = async () => {
  harness = start('harness', process.execPath, [
    cliBundle, 'serve', '--profile', 'hosted-harness', '--port', String(harnessPort), '--hostname', '127.0.0.1',
    '--require-auth', '--no-web', '--workspace', workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${brokerTap.port}`,
    `--managed-runtime-broker-token=${brokerToken}`,
  ], {
    ...cleanEnv,
    HOME: harnessHome, QWEN_HOME: `${harnessHome}/.qwen`,
    QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_SERVER_TOKEN: harnessToken,
    OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerTap.port}`,
    ...ctx.harnessEnvExtra,
  });
  ctx.harness = harness;
  await waitFor('harness', async () => (await fetch(`http://127.0.0.1:${harnessPort}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 120000, harness);
  mark('harness.ready');
};
ctx.stopHarness = async (signal = 'SIGTERM') => { await stop(harness, signal); mark('harness.stopped', { signal }); };

const H = { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: trustedActor };
ctx.api = async (method, p, body, extraHeaders = {}) => {
  const r = await fetch(`http://127.0.0.1:${springPort}${p}`, { method, headers: { ...H, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text: text.slice(0, 800) };
};
ctx.seedWorkspace = () => {
  sql(`INSERT INTO ${db}.managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(tenant)}, ${q(boundWorkspaceId)}, 1, ${q(boundStorageId)}, 'E2E', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`);
  sql(`INSERT INTO ${db}.managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (${q(tenant)}, ${q(boundWorkspaceId)}, ${q(trustedActor)}, TRUE, TRUE)`);
};
ctx.createSession = async (prompt, { workspace: bound = false, key } = {}) => {
  const r = await ctx.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'text', text: prompt }], ...(bound ? { workspace: { workspace_id: boundWorkspaceId } } : {}), metadata: { title: `PR13219 ${runName}` } }, { 'idempotency-key': key ?? `create-${runName}-${Date.now()}` });
  mark('session.create', { status: r.status, id: r.json?.id });
  if (r.status !== 202) throw new Error(`create ${r.status} ${r.text}`);
  return r.json.id;
};
ctx.followup = async (sessionId, text, key) => {
  const r = await ctx.api('POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text }] }, { 'idempotency-key': key ?? `followup-${Date.now()}` });
  mark('followup', { status: r.status, body: r.text.slice(0, 240) });
  return r;
};
ctx.turnRows = (sessionId) => sql(`SELECT turn_id, status, IFNULL(error_code,'NULL'), retry_count FROM ${db}.managed_agent_turn WHERE session_id=${q(sessionId)} ORDER BY created_at`).split('\n').filter(Boolean).map((l) => { const [turn, status, code, retries] = l.split('\t'); return { turn, status, code, retries: Number(retries) }; });
ctx.waitTurnTerminal = async (sessionId, timeoutMs, index = -1) => {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    const rows = ctx.turnRows(sessionId);
    const s = JSON.stringify(rows);
    if (s !== last) { mark('turnRows', { rows }); last = s; }
    const row = rows.at(index);
    if (row && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.status)) return row;
    await sleep(250);
  }
  return null;
};
ctx.events = async (sessionId) => {
  const out = [];
  let after = 0;
  for (;;) {
    const page = await ctx.api('GET', `/v1/agents/sessions/${sessionId}/events?after=${after}&limit=200`);
    const data = page.json?.data ?? [];
    for (const e of data) { out.push({ seq: e.sequence, type: e.type, terminal: e.terminal, turn: e.turn_id, data: e.data }); after = Math.max(after, e.sequence); }
    if (data.length < 200) break;
  }
  return out;
};
ctx.logLines = (name, re) => { try { return fs.readFileSync(`${runDir}/${name}.log`, 'utf8').split('\n').filter((l) => re.test(l)); } catch { return []; } };
ctx.dump = (label) => {
  const d = spawnSync('mysqldump', ['--protocol=tcp', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-uroot', '--skip-extended-insert', '--no-create-info', db], { encoding: 'latin1', maxBuffer: 512 * 1024 * 1024 });
  fs.writeFileSync(`${runDir}/dump-${label}.sql`, d.stdout ?? '', 'latin1');
};

const result = { run: runName, arm, scenario, startedAt: new Date().toISOString(), commit: spawnSync('git', ['-C', W, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() };
ctx.result = result;
try {
  springPort = await freePort();
  ctx.springPortValue = springPort;
  harnessPort = await freePort();
  brokerPort = await freePort();
  fake = await startFakeModel();
  harnessTap = await startTap('harnessTap', () => harnessPort, /\/health$|\/capabilities$|\/events/);
  storeTap = await startTap('storeTap', () => springPort, /restore|resources/);
  brokerTap = await startTap('brokerTap', () => brokerPort);
  Object.assign(ctx, { harnessTap, storeTap, brokerTap });
  sql(`DROP DATABASE IF EXISTS ${db}`);
  sql(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const mod = await import(`./scenarios/${scenario}.mjs`);
  T0 = Date.now();
  await mod.default(ctx);
} catch (err) {
  result.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  result.timeline = timeline;
  result.model = modelLog;
  result.harnessTap = harnessTap?.observations;
  result.storeTap = storeTap?.observations.filter((o) => !/transactions:commit/.test(o.url) || o.fault || (typeof o.status === 'number' && o.status >= 400));
  result.storeTapCommitCount = storeTap?.count((o) => /transactions:commit/.test(o.url));
  result.brokerTap = brokerTap?.observations.filter((o) => o.method !== 'GET');
  for (const c of [...children].reverse()) await stop(c);
  fs.writeFileSync(`${runDir}/result.json`, JSON.stringify(result, null, 2));
  for (const t of [harnessTap, storeTap, brokerTap]) { t?.server.closeAllConnections?.(); t?.server.close(); }
  fake?.server.closeAllConnections?.();
  fake?.server.close();
  console.log(`RESULT ${runDir}/result.json error=${result.error ? 'yes' : 'no'}`);
  process.exit(0);
}
