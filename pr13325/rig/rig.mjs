// PR #13325 real-stack rig: private MySQL 8.4.7 (127.0.0.1:13325) or
// MariaDB 10.11.18 (127.0.0.1:43325) + the Spring fat jar of one arm
// (base = merge-base 43a6e1e5, head = 58f8b173) + the packaged Hosted Harness
// (dist/cli.js serve --profile hosted-harness, built from head) + a fake
// OpenAI model + an HTTP proxy between Spring and the Harness that can hold
// the POST /session/:id/prompt response (the admission point).
// Usage: node rig.mjs <scenario> <arm> <engine> [extra json]
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http, { createServer } from 'node:http';

export const RIG = '/Users/wenshao/pr13325-rig';
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const JAVA = `${process.env.HOME}/Install/jdk21/bin/java`;
const cliBundle = `${RIG}/src-head/dist/cli.js`;
const PORTS = { mysql: 13325, mariadb: 43325 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`);
export const rows = (text) => (text ? text.split('\n').map((l) => l.split('\t')) : []);
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';

export function makeRig(cfg) {
  const T0 = Date.now();
  const port = PORTS[cfg.engine];
  const db = cfg.db;
  const runDir = `${RIG}/runs/${cfg.name}`;
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  const log = (...a) => {
    const line = `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
    console.log(line);
    fs.appendFileSync(`${runDir}/rig.log`, line + '\n');
  };
  const results = {};
  const record = (k, v) => {
    results[k] = v;
    fs.writeFileSync(`${runDir}/results.json`, JSON.stringify(results, null, 2));
    log('RESULT', k, v);
  };
  function sql(query, dbName = db) {
    const args = ['--protocol=tcp', '-h127.0.0.1', `-P${port}`, '-uroot', '--batch', '--skip-column-names', '--raw'];
    if (dbName) args.push(dbName);
    const r = spawnSync(MYSQL, [...args, '-e', query], { encoding: 'utf8', maxBuffer: 512 << 20 });
    if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}\n${query.slice(0, 300)}`);
    return r.stdout.replace(/\n$/, '');
  }
  // A held MySQL session driven over the CLI's stdin (unbuffered, one marker
  // line per step), used to take and release row locks at exact moments.
  function holder(name) {
    const child = spawn(MYSQL, ['--protocol=tcp', '-h127.0.0.1', `-P${port}`, '-uroot', '--batch', '--skip-column-names', '-n', db], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const waiters = [];
    child.stdout.on('data', (d) => {
      buf += d.toString();
      for (const w of [...waiters]) if (buf.includes(w.mark)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(); }
    });
    child.stderr.on('data', (d) => log(`holder.${name}.stderr`, d.toString().trim()));
    const run = async (stmts, timeoutMs = 30000) => {
      const mark = `MARK_${randomBytes(4).toString('hex')}`;
      const p = new Promise((resolve, reject) => {
        waiters.push({ mark, resolve });
        setTimeout(() => reject(new Error(`holder ${name} timed out on ${stmts}`)), timeoutMs).unref();
      });
      child.stdin.write(`${stmts}\nSELECT '${mark}';\n`);
      await p;
    };
    return { run, close: () => { try { child.stdin.end(); } catch {} }, output: () => buf };
  }
  const lockWaits = () =>
    Number(sql(`SELECT COUNT(*) FROM information_schema.innodb_trx t JOIN information_schema.processlist p ON p.id = t.trx_mysql_thread_id WHERE t.trx_state='LOCK WAIT' AND p.db = ${q(db)}`));
  async function waitLockWaits(n, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs;
    let seen = -1;
    while (Date.now() < end) {
      seen = lockWaits();
      if (seen >= n) return seen;
      await sleep(200);
    }
    throw new Error(`lock waits never reached ${n} (last ${seen})`);
  }
  const deadlockCount = () => {
    if (cfg.engine === 'mysql') return Number(sql(`SELECT count FROM information_schema.innodb_metrics WHERE name='lock_deadlocks'`, null));
    return Number(rows(sql(`SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks'`, null))[0][1]);
  };

  // ---------- fake model ----------
  let modelCalls = 0;
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
        const tools = Array.isArray(body.tools) ? body.tools.length : 0;
        const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
        const lastText = typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) ? last.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n') : '';
        const m = [...lastText.matchAll(/\[\[RIG:(\{[^\]]*\})\]\]/g)].pop();
        let plan = { n: 3, gap: 0, hold: 0 };
        if (m && body.stream === true) { try { plan = { ...plan, ...JSON.parse(m[1]) }; } catch {} }
        const toolResults = (body.messages ?? []).filter((x) => x.role === 'tool').length;
        modelLog.write(JSON.stringify({ t: Date.now() - T0, stream: body.stream === true, tools, plan, marker: !!m, toolResults, ...(tools ? { toolNames: body.tools.map((x) => x.function?.name), readFileProps: body.tools.find((x) => x.function?.name === 'read_file')?.function?.parameters?.required } : {}), ...(toolResults ? { lastTool: JSON.stringify((body.messages ?? []).filter((x) => x.role === 'tool').at(-1)).slice(0, 400) } : {}) }) + '\n');
        if (body.stream !== true) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage }));
          return;
        }
        const chunk = (delta, finish = null, u) => ({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
        if (plan.failTool && tools > 0 && toolResults < 1) {
          // One read_file call on a path that does not exist: a real failed tool.
          setTimeout(() => {
            if (res.destroyed) return;
            send(chunk({ role: 'assistant' }));
            const args = JSON.stringify({ [plan.argName ?? 'file_path']: `${plan.failTool}` });
            send(chunk({ tool_calls: [{ index: 0, id: 'call_' + randomBytes(6).toString('hex'), type: 'function', function: { name: plan.toolName ?? 'read_file', arguments: args } }] }));
            send(chunk({}, 'tool_calls', usage));
            res.end('data: [DONE]\n\n');
          }, plan.modelMs ?? 0);
          return;
        }
        send(chunk({ role: 'assistant' }));
        let i = 0;
        const finish = () => { if (res.destroyed) return; send(chunk({}, 'stop', usage)); res.end('data: [DONE]\n\n'); };
        const step = () => {
          if (res.destroyed) return;
          if (i < plan.n) {
            send(chunk({ content: `${plan.word ?? 'tok'}-${i++} ` }));
            if (plan.gap > 0) setTimeout(step, plan.gap); else setImmediate(step);
            return;
          }
          if (plan.hold > 0) setTimeout(finish, plan.hold); else finish();
        };
        step();
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    server.unref();
    return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
  }

  // ---------- Spring -> Harness proxy (holds /prompt responses when armed) ----------
  const proxyLog = [];
  let holdPrompt = null; // { resolveArrived, release: Promise }
  function armPromptHold() {
    let release, arrived;
    const released = new Promise((r) => (release = r));
    const arrivedP = new Promise((r) => (arrived = r));
    holdPrompt = { released, arrived };
    return { arrived: arrivedP, release };
  }
  async function startProxy(upstreamPort) {
    const server = createServer((req, res) => {
      const t = Date.now() - T0;
      const isPrompt = req.method === 'POST' && /^\/session\/[^/]+\/prompt$/.test(req.url.split('?')[0]);
      proxyLog.push({ t, method: req.method, url: req.url.split('?')[0] });
      const up = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` } }, (ur) => {
        if (isPrompt && holdPrompt) {
          const h = holdPrompt;
          holdPrompt = null;
          const chunks = [];
          ur.on('data', (c) => chunks.push(c));
          ur.on('end', async () => {
            log('proxy.prompt.held', ur.statusCode);
            h.arrived();
            await h.released;
            log('proxy.prompt.released');
            res.writeHead(ur.statusCode, ur.headers);
            res.end(Buffer.concat(chunks));
          });
          return;
        }
        res.writeHead(ur.statusCode, ur.headers);
        ur.pipe(res);
        ur.on('aborted', () => res.destroy());
        ur.on('error', () => res.destroy());
      });
      up.on('error', (e) => { log('proxy.upstream.error', e.message); res.destroy(); });
      req.on('aborted', () => up.destroy());
      res.on('close', () => { if (!res.writableEnded) up.destroy(); });
      req.pipe(up);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    server.unref();
    return server.address().port;
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
  async function stop(rec, signal = 'SIGTERM') {
    if (!rec || rec.child.exitCode !== null || rec.child.signalCode !== null) return;
    try { process.kill(-rec.child.pid, signal); } catch {}
    for (let i = 0; i < 150 && rec.child.exitCode === null && rec.child.signalCode === null; i++) await sleep(100);
    try { process.kill(-rec.child.pid, 'SIGKILL'); } catch {}
    for (let i = 0; i < 50 && rec.child.exitCode === null && rec.child.signalCode === null; i++) await sleep(100);
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
  const tmp = `${runDir}/tmp`;
  const stable = `${RIG}/wsroot/${cfg.engine}-${db}`;
  const workspace = `${stable}/workspace`;
  const workspaceMount = `${stable}/workspace-mount`;
  const harnessHome = `${stable}/harness-home`;
  const runtimeHome = `${stable}/runtime-home`;
  const runtimeState = `${stable}/runtime-state`;
  const freshMount = !fs.existsSync(workspaceMount);
  for (const d of [tmp, workspace, `${workspaceMount}/child`, `${harnessHome}/.qwen`, `${runtimeHome}/.qwen`, runtimeState]) fs.mkdirSync(d, { recursive: true });
  if (freshMount) fs.utimesSync(workspaceMount, new Date(1), new Date(1));
  for (const h of [harnessHome, runtimeHome]) fs.writeFileSync(`${h}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
  const trustedFolders = `${tmp}/trusted-folders.json`;
  fs.writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
  const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
  const harnessToken = randomBytes(24).toString('hex');
  const brokerToken = randomBytes(24).toString('hex');
  const credentialKey = randomBytes(32).toString('base64');
  const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
  const st = { springPort: 0, harnessPort: 0, proxyPort: 0, brokerPort: 0, fake: null, spring: null, harness: null, springArm: cfg.arm };

  function springEnv(extra = {}) {
    return {
      ...cleanEnv,
      HOME: runtimeHome, QWEN_HOME: `${runtimeHome}/.qwen`, TMPDIR: tmp, TZ: 'UTC',
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
      SERVER_PORT: String(st.springPort),
      SPRING_DATASOURCE_PASSWORD: '',
      SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${port}/${db}?useSSL=false&allowPublicKeyRetrieval=true`,
      SPRING_DATASOURCE_USERNAME: 'root',
      QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
      QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: capabilityDigest,
      QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${st.proxyPort}`,
      QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
      QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
      QWEN_MANAGED_AGENT_HARNESS_TOKEN: harnessToken,
      QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
      QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: trustedActorHeader,
      QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
      QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'false',
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(st.brokerPort),
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: brokerToken,
      QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: credentialKey,
      QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'rig-local-v1',
      QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: runtimeState,
      QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: cliBundle,
      QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${st.springPort}`,
      QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
      QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '60s',
      QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
      QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
      QWEN_MANAGED_AGENT_CLI_ENTRY: cliBundle,
      QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
      ...(cfg.springEnv ?? {}),
      ...extra,
    };
  }
  async function startSpring({ arm = cfg.arm, javaOpts = cfg.javaOpts ?? [], env = {}, label = 'spring' } = {}) {
    const t = Date.now();
    st.springArm = arm;
    st.spring = start(label, JAVA, [...javaOpts, '-jar', `${RIG}/server/${arm}-server.jar`,
      `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=ws-tenant`,
      `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=rig-storage`,
      `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`,
    ], springEnv(env));
    await waitFor(label, async () => (await fetch(`http://127.0.0.1:${st.springPort}/actuator/health`)).ok, 240000, st.spring);
    log(`${label}.ready`, arm, Date.now() - t, 'ms');
    return Date.now() - t;
  }
  async function startHarness() {
    st.harness = start('harness', process.execPath, [
      cliBundle, 'serve', '--profile', 'hosted-harness', '--port', String(st.harnessPort), '--hostname', '127.0.0.1',
      '--require-auth', '--no-web', '--workspace', workspace,
      '--managed-runtime-broker-url', `http://127.0.0.1:${st.brokerPort}`,
      `--managed-runtime-broker-token=${brokerToken}`,
    ], {
      ...cleanEnv,
      HOME: harnessHome, QWEN_HOME: `${harnessHome}/.qwen`,
      QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
      QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
      QWEN_SERVER_TOKEN: harnessToken,
      OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: st.fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
      QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${st.brokerPort}`,
    });
    await waitFor('harness', async () => (await fetch(`http://127.0.0.1:${st.harnessPort}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 120000, st.harness);
    log('harness.ready');
  }
  async function boot({ harness = true } = {}) {
    sql(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`, null);
    st.springPort = await freePort();
    st.harnessPort = await freePort();
    st.brokerPort = await freePort();
    st.fake = await startFakeModel();
    st.proxyPort = await startProxy(st.harnessPort);
    await startSpring();
    if (harness) await startHarness();
  }
  async function shutdown() {
    for (const c of [...children].reverse()) await stop(c);
    fs.writeFileSync(`${runDir}/proxy-log.json`, JSON.stringify(proxyLog, null, 1));
    modelLog.end();
  }

  // ---------- API ----------
  async function api(tenant, method, p, body, extraHeaders = {}, { raw = false, actor = 'rig-actor' } = {}) {
    const t0 = Date.now();
    const headers = { 'x-qwen-tenant-id': tenant, ...(actor ? { [trustedActorHeader]: actor } : {}), ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...extraHeaders };
    const r = await fetch(`http://127.0.0.1:${st.springPort}${p}`, {
      method,
      headers,
      ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch {}
    const hdr = Object.fromEntries([...r.headers.entries()].filter(([k]) => /^(allow|x-qwen-idempotent-replay|content-type)$/i.test(k)));
    return { status: r.status, json, text, code: json?.error?.code ?? json?.code ?? null, headers: hdr, ms: Date.now() - t0 };
  }
  const createSession = (tenant, title, extra = {}, key = randomUUID()) =>
    api(tenant, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', ...(title !== undefined ? { metadata: { title } } : {}), ...extra }, { 'idempotency-key': key });
  const submit = (tenant, sessionId, text, key = randomUUID()) =>
    api(tenant, 'POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text }] }, { 'idempotency-key': key });
  const cancel = (tenant, sessionId, turnId, key = randomUUID()) =>
    api(tenant, 'POST', `/v1/agents/sessions/${sessionId}/events`, { type: 'agent.session.cancel', turn_id: turnId }, { 'idempotency-key': key });
  const directive = (plan) => `[[RIG:${JSON.stringify(plan)}]] please answer`;
  async function waitTurns(tenant, sid, timeoutMs = 120000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const active = sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)} AND status IN ('ACCEPTED','RUNNING','CANCELLING')`);
      if (active === '0') return rows(sql(`SELECT turn_id, status, COALESCE(error_code,'') FROM managed_agent_turn WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)} ORDER BY created_at`));
      await sleep(200);
    }
    return { timeout: true, turns: rows(sql(`SELECT turn_id, status, COALESCE(error_code,''), retry_count FROM managed_agent_turn WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)} ORDER BY created_at`)) };
  }
  function registerWorkspace(WS_TENANT = 'ws-tenant', WS_ID = 'rig-workspace', actor = 'rig-actor') {
    if (sql(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id=${q(WS_TENANT)} AND workspace_id=${q(WS_ID)}`) === '0')
      sql(`INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(WS_TENANT)}, ${q(WS_ID)}, 1, 'rig-storage', 'Rig', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`);
    if (sql(`SELECT COUNT(*) FROM managed_workspace_access WHERE tenant_id=${q(WS_TENANT)} AND workspace_id=${q(WS_ID)} AND actor_id=${q(actor)}`) === '0')
      sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (${q(WS_TENANT)}, ${q(WS_ID)}, ${q(actor)}, TRUE, TRUE)`);
  }
  const grepLog = (name, re) => fs.existsSync(`${runDir}/${name}.log`) ? fs.readFileSync(`${runDir}/${name}.log`, 'utf8').split('\n').filter((l) => re.test(l)) : [];

  return { registerWorkspace, cfg, db, runDir, log, record, results, sql, holder, lockWaits, waitLockWaits, deadlockCount, boot, shutdown, startSpring, startHarness, stop, st, api, createSession, submit, cancel, directive, waitTurns, armPromptHold, grepLog, proxyLog, modelCallsCount: () => modelCalls, workspaceId };
}
