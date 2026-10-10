// PR #13674 real-stack rig library: Spring fat jar of one arm + packaged Hosted
// Harness (dist/cli.js serve --profile hosted-harness) + scripted fake OpenAI
// model, against a private MySQL 8.4.7 (127.0.0.1:13674).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';

export const RIG = process.env.RIG_DIR ?? '/Users/wenshao/pr13674-rig';
const MYSQL = process.env.RIG_MYSQL ?? `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const JAVA = process.env.RIG_JAVA ?? `${process.env.HOME}/Install/jdk21/bin/java`;
const DBHOST = process.env.RIG_DBHOST ?? '127.0.0.1';
const DBPORT = Number(process.env.RIG_DBPORT ?? 13674);
const DBPW = process.env.RIG_DBPW ?? '';
export const ACTOR_HEADER = 'x-rig-actor';
export const T = 'ws-tenant';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeCtx({ phase, arm, db, cliArm }) {
  const ctx = { phase, arm, db };
  ctx.cliBundle = process.env.RIG_CLI ?? `${RIG}/src-${cliArm ?? arm}/dist/cli.js`;
  ctx.springJar = process.env.RIG_JAR ?? `${RIG}/server/${arm}-server.jar`;
  ctx.runDir = `${RIG}/runs/${db}-${phase}-${arm}`;
  fs.rmSync(ctx.runDir, { recursive: true, force: true });
  fs.mkdirSync(ctx.runDir, { recursive: true });
  ctx.stateFile = `${RIG}/state/${db}.json`;
  fs.mkdirSync(`${RIG}/state`, { recursive: true });
  ctx.state = fs.existsSync(ctx.stateFile) ? JSON.parse(fs.readFileSync(ctx.stateFile, 'utf8')) : {};
  ctx.saveState = () => fs.writeFileSync(ctx.stateFile, JSON.stringify(ctx.state, null, 2));
  ctx.results = { phase, arm, db, jar: ctx.springJar, cli: ctx.cliBundle, checks: [] };
  ctx.log = (...a) => {
    const line = `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
    console.log(line);
    fs.appendFileSync(`${ctx.runDir}/rig.log`, line + '\n');
  };
  ctx.record = (k, v) => {
    ctx.results[k] = v;
    fs.writeFileSync(`${ctx.runDir}/results.json`, JSON.stringify(ctx.results, null, 2));
  };
  // A check is a named expectation with the observed value; PASS/FAIL is computed here.
  ctx.check = (name, observed, expected) => {
    const pass = JSON.stringify(observed) === JSON.stringify(expected);
    ctx.results.checks.push({ name, pass, observed, expected });
    fs.writeFileSync(`${ctx.runDir}/results.json`, JSON.stringify(ctx.results, null, 2));
    ctx.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, { observed, ...(pass ? {} : { expected }) });
    return pass;
  };
  // Deployment directories are stable per database (workspace id derives from the path).
  const stable = `${RIG}/wsroot/${db}`;
  ctx.stable = stable;
  ctx.tmp = `${ctx.runDir}/tmp`;
  ctx.workspace = `${stable}/decoy-workspace`;
  ctx.harnessHome = `${stable}/harness-home`;
  ctx.runtimeHome = `${stable}/runtime-home`;
  ctx.runtimeState = `${stable}/runtime-state`;
  ctx.STORAGES = ['st1', 'st2', 'st3'];
  ctx.mount = (st) => `${stable}/mounts/${st}`;
  for (const d of [ctx.tmp, ctx.workspace, `${ctx.harnessHome}/.qwen`, `${ctx.runtimeHome}/.qwen`, ctx.runtimeState]) fs.mkdirSync(d, { recursive: true });
  // Durable local-process mode requires a private Broker state directory.
  fs.chmodSync(ctx.runtimeState, 0o700);
  for (const st of ctx.STORAGES) for (const c of ['child', 'c2']) fs.mkdirSync(`${ctx.mount(st)}/${c}`, { recursive: true });
  for (const h of [ctx.harnessHome, ctx.runtimeHome]) fs.writeFileSync(`${h}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
  ctx.trustedFolders = `${ctx.tmp}/trusted-folders.json`;
  fs.writeFileSync(ctx.trustedFolders, JSON.stringify({ [ctx.workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
  ctx.workspaceId = createHash('sha256').update(ctx.workspace).digest('hex').slice(0, 16);
  ctx.state.harnessToken ??= randomBytes(24).toString('hex');
  ctx.state.brokerToken ??= randomBytes(24).toString('hex');
  ctx.state.credentialKey ??= randomBytes(32).toString('base64');
  ctx.state.capabilityDigest ??= `sha256:${randomBytes(32).toString('hex')}`;
  ctx.saveState();
  ctx.children = [];
  return ctx;
}

// ---------- SQL ----------
export function sqlRaw(query, dbName) {
  const args = ['--protocol=tcp', `-h${DBHOST}`, `-P${DBPORT}`, '-uroot', '--batch', '--skip-column-names', '--raw'];
  if (DBPW) args.push(`-p${DBPW}`);
  if (dbName) args.push(dbName);
  const r = spawnSync(MYSQL, [...args, '-e', query], { encoding: 'utf8', maxBuffer: 256 << 20 });
  return { ok: r.status === 0, out: (r.stdout ?? '').replace(/\n$/, ''), err: (r.stderr ?? '').split('\n').filter((l) => !/Using a password/.test(l)).join('\n').trim() };
}
export const q = (v) => `'${String(v).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
export const rows = (text) => (text ? text.split('\n').map((l) => l.split('\t')) : []);
export function sqlFor(ctx) {
  return (query) => {
    const r = sqlRaw(query, ctx.db);
    if (!r.ok) throw new Error(`sql failed: ${r.err}\n${query.slice(0, 300)}`);
    return r.out;
  };
}

// ---------- scripted fake model ----------
// Markers in the latest user text pick the script:
//   SHELL::<id>      monitor -> background -> foreground shell (proof file) -> text
//   PEND::<id>       one foreground shell (left pending by the driver) -> text
//   HOLD::<id>       hold the reply until released (cancel probes)
//   CHILD::<fg|bg>::<id>       agent tool launching a child with CHILDTEXT::<id>
//   CHILDFAIL::<fg|bg>::<id>   agent tool launching a child whose model answers 400
//   CHILDTEXT::<id>  plain text (the child's own Turn)
//   CHILDFAILTEXT::<id> HTTP 400 (the child's Turn fails)
export async function startFakeModel(ctx) {
  const holds = new Map();
  const reqLog = `${ctx.runDir}/model-requests.jsonl`;
  const textOf = (m) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((p) => p?.text ?? '').join('') : '');
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/control/release')) {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      const h = holds.get(id);
      if (h) { h(); holds.delete(id); }
      res.end(h ? 'released' : 'none');
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      const messages = body.messages ?? [];
      let lastUser = -1;
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { lastUser = i; break; }
      const userText = lastUser >= 0 ? textOf(messages[lastUser]) : '';
      const toolResults = messages.slice(lastUser + 1).filter((m) => m.role === 'tool').map(textOf);
      const tools = (body.tools ?? []).map((t) => t.function?.name).filter(Boolean);
      const marker = /(CHILDFAILTEXT|CHILDTEXT|CHILDFAIL|CHILD|SHELL|PEND|HOLD|FILES)::([a-z]+::)?([A-Za-z0-9-]+)/.exec(userText);
      const kind = marker?.[1] ?? 'TEXT';
      const mode = marker?.[2]?.slice(0, -2) ?? null;
      const id = marker?.[3] ?? null;
      const step = toolResults.length;
      const entry = { t: new Date().toISOString(), kind, mode, id, step, stream: body.stream === true, tools, toolResults: toolResults.map((s) => s.slice(0, 400)), userText: userText.slice(0, 300) };
      fs.appendFileSync(reqLog, JSON.stringify(entry) + '\n');
      const model = body.model ?? 'fake-model';
      const cid = 'chatcmpl-' + randomBytes(6).toString('hex');
      const created = Math.floor(Date.now() / 1000);
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: cid, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage }));
        return;
      }
      if (kind === 'CHILDFAILTEXT') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'rig: child model refuses', type: 'invalid_request_error', code: 'rig_child_fail' } }));
        return;
      }
      const chunk = (delta, finish = null, u) => ({ id: cid, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) });
      const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
      const text = (t) => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        send(chunk({ role: 'assistant' }));
        send(chunk({ content: t }));
        send(chunk({}, 'stop', usage));
        res.end('data: [DONE]\n\n');
      };
      const call = (name, args) => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        send(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `rig-${id}-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }));
        send(chunk({}, 'tool_calls', usage));
        res.end('data: [DONE]\n\n');
      };
      if (kind === 'SHELL') {
        if (step === 0) return call('monitor', { command: `printf 'monitor\\n' >> monitor-proof-${id}.txt`, description: `monitor ${id}` });
        if (step === 1) return call('run_shell_command', { command: `printf 'background\\n' >> background-proof-${id}.txt`, is_background: true, description: `background ${id}` });
        if (step === 2) return call('run_shell_command', { command: `printf 'once\\n' >> shell-proof-${id}.txt; pwd`, description: `Write a Shell proof ${id}` });
        return text(`shell script done ${id}`);
      }
      if (kind === 'FILES') {
        if (step === 0) return call('write_file', { file_path: `files-proof-${id}.txt`, content: `files ${id}\n` });
        return text(`files script done ${id}`);
      }
      if (kind === 'PEND') {
        if (step === 0) return call('run_shell_command', { command: `printf 'pend\\n' >> pend-proof-${id}.txt; pwd`, description: `Pending Shell proof ${id}` });
        return text(`pending script done ${id}`);
      }
      if (kind === 'CHILD' || kind === 'CHILDFAIL') {
        if (step === 0) return call('agent', { description: `child ${id}`, prompt: `${kind === 'CHILD' ? 'CHILDTEXT' : 'CHILDFAILTEXT'}::${id} answer briefly`, run_in_background: mode === 'bg' });
        return text(`parent done ${id}`);
      }
      if (kind === 'CHILDTEXT') return text(`child result ${id}`);
      if (kind === 'HOLD') {
        let released = false;
        holds.set(id, () => { released = true; try { text(`held reply ${id}`); } catch {} });
        req.on('close', () => { if (!released) holds.delete(id); });
        res.on('close', () => { if (!released) holds.delete(id); });
        return;
      }
      return text('rig answer ' + randomBytes(3).toString('hex'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { server, port, baseUrl: `http://127.0.0.1:${port}/v1`, holds, release: async (id) => (await fetch(`http://127.0.0.1:${port}/control/release?id=${id}`)).text(), reqLog };
}
export function modelRequests(fake) {
  if (!fs.existsSync(fake.reqLog)) return [];
  return fs.readFileSync(fake.reqLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ---------- processes ----------
export function start(ctx, name, cmd, args, env, cwd = RIG) {
  const out = fs.openSync(`${ctx.runDir}/${name}.log`, 'a');
  const child = spawn(cmd, args, { env, cwd, detached: true, stdio: ['ignore', out, out] });
  const rec = { name, child };
  ctx.children.push(rec);
  child.on('exit', (code, signal) => ctx.log(`${name}.exit`, code, signal));
  return rec;
}
export async function stop(rec, pidOnly = false) {
  if (!rec || rec.child.exitCode !== null || rec.child.signalCode !== null) return;
  if (pidOnly) {
    // A Java redeploy: SIGTERM the JVM alone so durable Runtime workers outlive it.
    try { process.kill(rec.child.pid, 'SIGTERM'); } catch {}
    for (let i = 0; i < 300 && rec.child.exitCode === null && rec.child.signalCode === null; i++) await sleep(100);
    return;
  }
  try { process.kill(-rec.child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 200 && rec.child.exitCode === null && rec.child.signalCode === null; i++) await sleep(100);
  try { process.kill(-rec.child.pid, 'SIGKILL'); } catch {}
  for (let i = 0; i < 50 && rec.child.exitCode === null && rec.child.signalCode === null; i++) await sleep(100);
}
export async function waitFor(name, fn, timeoutMs, rec) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (rec && (rec.child.exitCode !== null || rec.child.signalCode !== null)) throw new Error(`${name} exited early`);
    try { if (await fn()) return; } catch {}
    await sleep(250);
  }
  throw new Error(`${name} not ready in ${timeoutMs}ms`);
}
export async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
export const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(https?|all|no)_proxy$/i.test(k) &&
      !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(k) &&
      !/(api_?key|token|secret|password|credentials?)$/i.test(k),
  ),
);

// Spring env; `over` overrides or deletes (value null) entries.
export function springEnv(ctx, over = {}) {
  const env = {
    ...cleanEnv,
    HOME: ctx.runtimeHome, QWEN_HOME: `${ctx.runtimeHome}/.qwen`, TMPDIR: ctx.tmp, TZ: 'UTC',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(ctx.springPort),
    SPRING_DATASOURCE_PASSWORD: DBPW,
    SPRING_DATASOURCE_URL: `jdbc:mysql://${DBHOST}:${DBPORT}/${ctx.db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'default',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: ctx.state.capabilityDigest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${ctx.harnessPort}`,
    QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
    QWEN_MANAGED_AGENT_HARNESS_TOKEN: ctx.state.harnessToken,
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: ACTOR_HEADER,
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: process.env.RIG_DURABLE ?? 'false',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(ctx.brokerPort),
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: ctx.state.brokerToken,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: ctx.state.credentialKey,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'rig-local-v1',
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: ctx.runtimeState,
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: ctx.cliBundle,
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${ctx.springPort}`,
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '15s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: ctx.workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_CLI_ENTRY: ctx.cliBundle,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: ctx.workspace,
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}
export function mountArgs(ctx) {
  return ctx.STORAGES.flatMap((st, i) => [
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].tenant-id=${T}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].storage-id=${st}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].root=${ctx.mount(st)}`,
  ]);
}
export async function allocPorts(ctx) {
  ctx.springPort = ctx.state.springPort ??= await freePort();
  ctx.harnessPort = ctx.state.harnessPort ??= await freePort();
  ctx.brokerPort = ctx.state.brokerPort ??= await freePort();
  ctx.saveState();
}
export async function startSpring(ctx, over = {}, name = 'spring') {
  const t = Date.now();
  const rec = start(ctx, name, JAVA, ['-jar', ctx.springJar, ...mountArgs(ctx)], springEnv(ctx, over));
  await waitFor(name, async () => (await fetch(`http://127.0.0.1:${ctx.springPort}/actuator/health`)).ok, 300000, rec);
  ctx.log(`${name}.ready`, Date.now() - t, 'ms');
  return rec;
}
export async function startHarness(ctx, fake, name = 'harness') {
  const rec = start(ctx, name, process.execPath, [
    ctx.cliBundle, 'serve', '--profile', 'hosted-harness', '--port', String(ctx.harnessPort), '--hostname', '127.0.0.1',
    '--require-auth', '--no-web', '--workspace', ctx.workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${ctx.brokerPort}`,
    `--managed-runtime-broker-token=${ctx.state.brokerToken}`,
  ], {
    ...cleanEnv,
    HOME: ctx.harnessHome, QWEN_HOME: `${ctx.harnessHome}/.qwen`, TMPDIR: ctx.tmp,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    QWEN_CODE_TRUSTED_FOLDERS_PATH: ctx.trustedFolders,
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: ctx.state.capabilityDigest,
    QWEN_SERVER_TOKEN: ctx.state.harnessToken,
    OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: ctx.state.brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${ctx.brokerPort}`,
  });
  await waitFor(name, async () => (await fetch(`http://127.0.0.1:${ctx.harnessPort}/health`, { headers: { authorization: `Bearer ${ctx.state.harnessToken}` } })).ok, 180000, rec);
  ctx.log(`${name}.ready`);
  return rec;
}

// ---------- API ----------
export function apiFor(ctx) {
  return async function api(actor, method, p, body, extraHeaders = {}, tenant = T) {
    const r = await fetch(`http://127.0.0.1:${ctx.springPort}${p}`, {
      method,
      headers: { 'x-qwen-tenant-id': tenant, ...(actor ? { [ACTOR_HEADER]: actor } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, code: json?.error?.code ?? json?.code ?? null };
  };
}
export { randomUUID, randomBytes, fs };
