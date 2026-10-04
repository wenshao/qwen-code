// PR #13217 real-stack rig: private MySQL 8.4.7 (127.0.0.1:13217) + the
// Spring fat jar of one arm + the packaged Hosted Harness (dist/cli.js serve
// --profile hosted-harness, built from main) + a fake OpenAI model.
// Database work is read from performance_schema per schema (digest summary,
// table I/O) and from the binary log, never from the application.
// Usage: node rig.mjs <config.json>
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';

const RIG = '/Users/wenshao/pr13217-rig';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MYSQL_PORT = 13217;
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const JAVA = cfg.java ?? `${process.env.HOME}/Install/jdk21/bin/java`;
const cliBundle = `${RIG}/src-main/dist/cli.js`;
const springJar = `${RIG}/server/${cfg.arm}-server.jar`;
const runDir = `${RIG}/runs/${cfg.name}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const db = cfg.db;
const stateFile = `${RIG}/state/${db}.json`;
fs.mkdirSync(`${RIG}/state`, { recursive: true });
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';
const actor = 'rig-actor';
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

function sql(query, dbName) {
  const args = ['--protocol=tcp', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-uroot', '--batch', '--skip-column-names', '--raw'];
  if (dbName) args.push(dbName);
  const r = spawnSync(MYSQL, [...args, '-e', query], { encoding: 'utf8', maxBuffer: 512 << 20 });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}\n${query.slice(0, 300)}`);
  return r.stdout.replace(/\n$/, '');
}
const q = (v) => `'${String(v).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const rows = (text) => (text ? text.split('\n').map((l) => l.split('\t')) : []);

// ---------- performance_schema / binlog snapshots ----------
function psSnap() {
  const digests = new Map();
  for (const [digest, text, count, examined, sent, affected, tms, lms] of rows(
    sql(`SELECT DIGEST, REPLACE(REPLACE(DIGEST_TEXT, '\\n', ' '), '\\t', ' '), COUNT_STAR, SUM_ROWS_EXAMINED, SUM_ROWS_SENT, SUM_ROWS_AFFECTED, ROUND(SUM_TIMER_WAIT/1000000000), ROUND(SUM_LOCK_TIME/1000000000) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME = ${q(db)}`),
  ))
    digests.set(digest, { text, count: +count, examined: +examined, sent: +sent, affected: +affected, ms: +tms, lockMs: +lms });
  const tables = new Map();
  for (const [name, fetch, insert, update, del] of rows(
    sql(`SELECT OBJECT_NAME, COUNT_FETCH, COUNT_INSERT, COUNT_UPDATE, COUNT_DELETE FROM performance_schema.table_io_waits_summary_by_table WHERE OBJECT_SCHEMA = ${q(db)}`),
  ))
    tables.set(name, { fetch: +fetch, insert: +insert, update: +update, delete: +del });
  const binlog = rows(sql('SHOW BINARY LOGS')).reduce((s, r) => s + Number(r[1]), 0);
  const [bfile, bpos] = rows(sql('SHOW BINARY LOG STATUS'))[0];
  return { at: Date.now(), digests, tables, binlog, bfile, bpos: Number(bpos) };
}
function psDiff(a, b) {
  const digests = [];
  for (const [k, v] of b.digests) {
    const o = a.digests.get(k) ?? { count: 0, examined: 0, sent: 0, affected: 0, ms: 0, lockMs: 0 };
    if (v.count > o.count)
      digests.push({ text: v.text, count: v.count - o.count, examined: v.examined - o.examined, sent: v.sent - o.sent, affected: v.affected - o.affected, ms: v.ms - o.ms, lockMs: v.lockMs - o.lockMs });
  }
  digests.sort((x, y) => y.count - x.count);
  const tables = {};
  for (const [k, v] of b.tables) {
    const o = a.tables.get(k) ?? { fetch: 0, insert: 0, update: 0, delete: 0 };
    const d = { fetch: v.fetch - o.fetch, insert: v.insert - o.insert, update: v.update - o.update, delete: v.delete - o.delete };
    if (d.fetch || d.insert || d.update || d.delete) tables[k] = d;
  }
  return { ms: b.at - a.at, binlogBytes: b.binlog - a.binlog, digests, tables };
}
// Row-event bytes per table between two snapshots, from the binary log itself.
function binlogBytesByTable(a, b) {
  const files = rows(sql('SHOW BINARY LOGS')).map((r) => r[0]);
  const from = files.indexOf(a.bfile), to = files.indexOf(b.bfile);
  const out = {};
  for (let i = from; i <= to; i++) {
    const args = ['--base64-output=DECODE-ROWS'];
    if (i === from) args.push(`--start-position=${a.bpos}`);
    if (i === to) args.push(`--stop-position=${b.bpos}`);
    const r = spawnSync(MYSQL.replace(/mysql$/, 'mysqlbinlog'), [...args, `${RIG}/mysql/${files[i]}`], { encoding: 'utf8', maxBuffer: 1 << 30 });
    let at = null, table = null;
    for (const line of r.stdout.split('\n')) {
      const m1 = /^# at (\d+)/.exec(line);
      if (m1) { at = Number(m1[1]); continue; }
      const m2 = /end_log_pos (\d+).*?(Table_map: `([^`]+)`\.`([^`]+)`|(Write_rows|Update_rows|Delete_rows))/.exec(line);
      if (!m2 || at === null) continue;
      const size = Number(m2[1]) - at;
      if (m2[3]) { table = m2[3] === db ? m2[4] : null; continue; }
      if (table) { const o = (out[table] ??= { bytes: 0, events: 0, kinds: {} }); o.bytes += size; o.events++; o.kinds[m2[5]] = (o.kinds[m2[5]] ?? 0) + 1; }
    }
  }
  return out;
}
const sumCount = (diff, re) => diff.digests.filter((d) => re.test(d.text)).reduce((s, d) => s + d.count, 0);

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
      // Only the main agent call (streaming, tools offered) follows the
      // prompt's [[RIG:...]] directive; auxiliary calls get a short answer.
      const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
      const lastText = typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) ? last.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n') : '';
      const m = [...lastText.matchAll(/\[\[RIG:(\{[^\]]*\})\]\]/g)].pop();
      let plan = { n: 3, gap: 0, hold: 0 };
      if (m && body.stream === true) { try { plan = { ...plan, ...JSON.parse(m[1]) }; } catch {} }
      modelLog.write(JSON.stringify({ t: Date.now() - T0, stream: body.stream === true, tools, plan, marker: !!m, toolResults: (body.messages ?? []).filter((x) => x.role === 'tool').length, ...(cfg.logToolSchemas && tools ? { toolSchemas: body.tools.map((x) => ({ name: x.function?.name, required: x.function?.parameters?.required, props: Object.keys(x.function?.parameters?.properties ?? {}) })), system: String((body.messages ?? []).find((x) => x.role === 'system')?.content ?? '').slice(0, 4000), lastTool: (body.messages ?? []).filter((x) => x.role === 'tool').at(-1) } : {}) }) + '\n');
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage }));
        return;
      }
      const chunk = (delta, finish = null, u) => ({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
      const toolResults = (body.messages ?? []).filter((x) => x.role === 'tool').length;
      if (plan.tools && tools > 0 && toolResults < plan.tools) {
        // Agentic loop: one write_file call per model round, after a model delay.
        setTimeout(() => {
          if (res.destroyed) return;
          send(chunk({ role: 'assistant' }));
          const args = JSON.stringify({ file_path: `rig-out/f-${toolResults}.txt`, content: `${plan.word ?? 'w'}-${toolResults}\n`.repeat(plan.lines ?? 4) });
          send(chunk({ tool_calls: [{ index: 0, id: 'call_' + randomBytes(6).toString('hex'), type: 'function', function: { name: 'write_file', arguments: args } }] }));
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
// Deployment directories are stable per database, like a real host across restarts:
// the Session Store workspace id is derived from the workspace path.
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
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: trustedActorHeader,
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
    ...(cfg.springEnv ?? {}),
  };
}
async function startSpring() {
  const t = Date.now();
  spring = start('spring', JAVA, [...(cfg.javaOpts ?? []), '-jar', springJar,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${WS_TENANT}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=${WS_STORAGE}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`,
    ...(cfg.springArgs ?? [])], springEnv());
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 240000, spring);
  const springLog = fs.readFileSync(`${runDir}/spring.log`, 'utf8');
  const flyway = springLog.split('\n').filter((l) => /flyway|Migrating schema|Successfully applied|Successfully validated|schema history/i.test(l)).map((l) => l.replace(/^.*?(INFO|WARN|ERROR)/, '$1'));
  record('springBoot', { ms: Date.now() - t, flyway });
  log('spring.ready', Date.now() - t, 'ms');
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

// ---------- API ----------
async function api(tenant, method, p, body, extraHeaders = {}) {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${springPort}${p}`, {
    method,
    headers: { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: actor, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
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
  sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (${q(WS_TENANT)}, ${q(WS_ID)}, ${q(actor)}, TRUE, TRUE)`, db);
}
const sessionRow = (tenant, sid) => {
  const [r] = rows(sql(`SELECT s.last_sequence, COALESCE(p.covered_sequence,-1), COALESCE(n.covered_sequence,-1), ${cfg.arm === 'main' && !state.migrated ? 'NULL' : 'p.snapshot_stale_since'} FROM managed_agent_session s LEFT JOIN managed_agent_consumer_progress p ON p.tenant_id=s.tenant_id AND p.session_id=s.session_id AND p.consumer_name='message_projection' LEFT JOIN managed_agent_snapshot n ON n.tenant_id=s.tenant_id AND n.session_id=s.session_id WHERE s.tenant_id=${q(tenant)} AND s.session_id=${q(sid)}`, db));
  return { last: +r[0], progress: +r[1], snapshot: +r[2], staleSince: r[3] === 'NULL' ? null : r[3] };
};
async function waitTurns(tenant, sid, timeoutMs = 180000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const active = sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)} AND status IN ('ACCEPTED','RUNNING','CANCELLING')`, db);
    if (active === '0') return rows(sql(`SELECT turn_id, status, COALESCE(error_code,'') FROM managed_agent_turn WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)} ORDER BY created_at`, db));
    await sleep(150);
  }
  throw new Error(`turns of ${sid} not settled`);
}
async function waitMaterialized(tenant, sid, timeoutMs = 30000) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const r = sessionRow(tenant, sid);
    if (r.progress === r.last && r.snapshot === r.last) return { ...r, ms: Date.now() - t };
    await sleep(100);
  }
  return { ...sessionRow(tenant, sid), ms: null, timedOut: true };
}
async function runTurn(tenant, sid, plan) {
  const t = Date.now();
  const s = await submit(tenant, sid, directive(plan));
  if (s.status !== 202) throw new Error(`submit ${s.status} ${s.text}`);
  const turns = await waitTurns(tenant, sid);
  const last = turns[turns.length - 1];
  return { turnMs: Date.now() - t, status: last[1], error: last[2] };
}

// ---------- SSE client ----------
function openSse(tenant, path, init, label) {
  const ctrl = new AbortController();
  const rec = { label, events: [], opened: null, ended: null, endReason: null, ctrl };
  rec.done = (async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${springPort}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: actor, accept: 'text/event-stream', ...(init?.headers ?? {}) },
      });
      rec.status = r.status;
      rec.opened = Date.now();
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
          const id = /^id:(.*)$/m.exec(frame)?.[1]?.trim();
          const ev = /^event:(.*)$/m.exec(frame)?.[1]?.trim();
          if (id || ev) rec.events.push({ t: Date.now(), id: id ? Number(id) : null, ev });
        }
      }
    } catch (e) {
      rec.ended = Date.now();
      rec.endReason = ctrl.signal.aborted ? 'client-aborted' : `error:${e.message}`;
    }
  })();
  return rec;
}

// ---------- steps ----------
async function populate(step) {
  const tenant = step.tenant ?? `list-${randomBytes(3).toString('hex')}`;
  registerWorkspace();
  const sessions = [];
  // Mixed page: unbound with a Turn, unbound without, workspace-bound with a Turn.
  const plan = [];
  for (let i = 0; i < (step.unboundWithTurn ?? 10); i++) plan.push({ ws: false, turn: true });
  for (let i = 0; i < (step.unboundNoTurn ?? 4); i++) plan.push({ ws: false, turn: false });
  for (let i = 0; i < (step.boundWithTurn ?? 6); i++) plan.push({ ws: true, turn: true });
  for (let i = 0; i < (step.boundNoTurn ?? 0); i++) plan.push({ ws: true, turn: false });
  const t = step.ws ? WS_TENANT : tenant;
  for (const [i, p] of plan.entries()) {
    const ten = p.ws ? WS_TENANT : tenant;
    const c = await createSession(ten, `rig ${i} ${p.ws ? 'bound' : 'unbound'}`, p.ws);
    if (c.status !== 202) throw new Error(`create ${c.status} ${c.text}`);
    sessions.push({ tenant: ten, sessionId: c.json.id, ws: p.ws, turn: p.turn });
  }
  // Turns run 3 at a time (well below the 10-core virtual-thread pinning threshold).
  const withTurn = sessions.filter((s) => s.turn);
  for (let i = 0; i < withTurn.length; i += 3) {
    await Promise.all(withTurn.slice(i, i + 3).map(async (s) => { s.result = await runTurn(s.tenant, s.sessionId, { n: 30 }); }));
  }
  for (const s of sessions) await waitMaterialized(s.tenant, s.sessionId);
  state.list = { tenant, sessions };
  saveState();
  record(`populate`, { tenant, sessions: sessions.map((s) => ({ id: s.sessionId, tenant: s.tenant, ws: s.ws, status: s.result?.status ?? null })) });
}

async function measureList(step) {
  const reps = step.reps ?? 20;
  const out = {};
  const targets = [
    ['public-list-unbound', () => api(state.list.tenant, 'GET', '/v1/agents/sessions?limit=20')],
    ['public-list-bound', () => api(WS_TENANT, 'GET', '/v1/agents/sessions?limit=20')],
    ['webshell-list-unbound', () => api(state.list.tenant, 'POST', '/api/agent/web-shell/v1/sessions/query', { limit: 20 })],
    ['webshell-list-bound', () => api(WS_TENANT, 'POST', '/api/agent/web-shell/v1/sessions/query', { limit: 20 })],
    ['public-get', () => api(state.list.sessions[0].tenant, 'GET', `/v1/agents/sessions/${state.list.sessions[0].sessionId}`)],
    ['webshell-get', () => api(state.list.sessions[0].tenant, 'POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: state.list.sessions[0].sessionId })],
  ];
  // Idle control window: what the background schedulers alone run.
  await sleep(1500);
  const i0 = psSnap();
  await sleep(2000);
  const idle = psDiff(i0, psSnap());
  const idleDigests = new Set(idle.digests.map((d) => d.text));
  const idleRate = new Map(idle.digests.map((d) => [d.text, d.count / idle.ms]));
  for (const [name, call] of targets) {
    await call(); // warm
    const a = psSnap();
    let body = null, status = null, ms = [];
    for (let r = 0; r < reps; r++) {
      const res = await call();
      status = res.status; body = res.json; ms.push(res.ms);
    }
    const d = psDiff(a, psSnap());
    // Request statements: digests the idle window never ran.
    // Request statements: digests the idle window never ran, plus any idle digest
    // whose count exceeds its idle rate by most of a call per request.
    const req = d.digests.map((x) => idleDigests.has(x.text) ? { ...x, count: Math.round((x.count - idleRate.get(x.text) * d.ms) / reps) * reps, examined: 0, sharedWithIdle: true } : x).filter((x) => x.count >= reps * 0.75);
    const perCall = req.reduce((s, x) => s + x.count, 0) / reps;
    const examinedPerCall = req.reduce((s, x) => s + x.examined, 0) / reps;
    ms.sort((x, y) => x - y);
    out[name] = { status, rows: body?.data?.length ?? body?.items?.length ?? body?.sessions?.length ?? null, statementsPerCall: perCall, rowsExaminedPerCall: examinedPerCall, p50ms: ms[Math.floor(ms.length / 2)], digests: req.map((x) => ({ perCall: x.count / reps, examinedPerCall: x.examined / reps, text: x.text.slice(0, 400) })) };
    fs.writeFileSync(`${runDir}/body-${name}.json`, JSON.stringify(body, null, 2));
    log('LIST', name, status, 'statements/call', perCall, 'examined/call', examinedPerCall);
  }
  record(step.label ?? 'list', { idleDigests: [...idleDigests].map((t) => t.slice(0, 200)), ...out });
}

async function burst(step) {
  if (step.ws) registerWorkspace();
  const tenant = step.ws ? WS_TENANT : `burst-${randomBytes(3).toString('hex')}`;
  const c = await createSession(tenant, 'burst', !!step.ws);
  if (c.status !== 202) throw new Error(`create ${c.status} ${c.text}`);
  const sid = c.json.id;
  await sleep(500);
  const a = psSnap();
  const turn = await runTurn(tenant, sid, step.plan ?? { n: step.n ?? 3000, gap: step.gap ?? 0, word: 'burst' });
  const turnStart = Date.now() - turn.turnMs;
  const mat = await waitMaterialized(tenant, sid);
  await sleep(300);
  const b = psSnap();
  const d = psDiff(a, b);
  const itemsBytes = Number(sql(`SELECT LENGTH(items_json) FROM managed_agent_snapshot WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)}`, db));
  const snapVersion = Number(sql(`SELECT snapshot_version FROM managed_agent_snapshot WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)}`, db));
  const items = await api(tenant, 'GET', `/v1/agents/sessions/${sid}/items?limit=100`);
  const transcript = await api(tenant, 'POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: sid, limit: 500 });
  fs.writeFileSync(`${runDir}/burst-items.json`, JSON.stringify(items.json, null, 2));
  const eventTypes = Object.fromEntries(rows(sql(`SELECT event_type, COUNT(*) FROM managed_agent_event WHERE tenant_id=${q(tenant)} AND session_id=${q(sid)} GROUP BY event_type`, db)).map(([k, v]) => [k, +v]));
  const res = {
    tenant, sessionId: sid, turn, events: mat.last, eventTypes, materialized: mat,
    snapshotWrites: { update: sumCount(d, /^UPDATE `managed_agent_snapshot`/), insert: sumCount(d, /^INSERT INTO `managed_agent_snapshot`/), finalVersion: snapVersion },
    finalItemsJsonBytes: itemsBytes,
    snapshotTableIo: d.tables.managed_agent_snapshot ?? null,
    itemTableIo: d.tables.managed_agent_item ?? null,
    binlogBytes: d.binlogBytes,
    binlogByTable: binlogBytesByTable(a, b),
    itemsReturned: items.json?.data?.length ?? null,
    finalText: items.json?.data?.map((x) => JSON.stringify(x.content ?? x)).join('').length,
    transcriptEvents: transcript.json?.events?.length ?? null,
    topDigests: d.digests.slice(0, 25).map((x) => ({ count: x.count, examined: x.examined, text: x.text.slice(0, 200) })),
  };
  record(step.label ?? 'burst', res);
  log('BURST', JSON.stringify({ events: res.events, snapshotWrites: res.snapshotWrites, binlogBytes: res.binlogBytes, finalItemsJsonBytes: itemsBytes, turn }));
}

async function longTurn(step) {
  registerWorkspace();
  sql(`UPDATE managed_workspace_access SET can_read=TRUE WHERE tenant_id=${q(WS_TENANT)} AND workspace_id=${q(WS_ID)} AND actor_id=${q(actor)}`, db);
  const c = await createSession(WS_TENANT, 'long', true);
  if (c.status !== 202) throw new Error(`create ${c.status} ${c.text}`);
  const sid = c.json.id;
  const hist = [];
  await runTurn(WS_TENANT, sid, { n: 3 });
  await waitMaterialized(WS_TENANT, sid);
  const h0 = psSnap();
  const histSeq0 = sessionRow(WS_TENANT, sid).last;
  for (let h = 0; h < (step.history ?? 0); h++) { hist.push(await runTurn(WS_TENANT, sid, { n: step.historyDeltas ?? 1500, word: `hist${h}` })); await waitMaterialized(WS_TENANT, sid); }
  await sleep(500);
  const h1 = psSnap();
  const hd = psDiff(h0, h1);
  const historyPhase = { turns: hist.length, events: sessionRow(WS_TENANT, sid).last - histSeq0, snapshotUpdates: sumCount(hd, /^UPDATE `managed_agent_snapshot`/), snapshotBinlog: binlogBytesByTable(h0, h1).managed_agent_snapshot ?? null, snapshotStatementMs: hd.digests.filter((x) => /^UPDATE `managed_agent_snapshot`/.test(x.text)).reduce((s2, x) => s2 + x.ms, 0), turnMs: hist.map((x) => x.turnMs) };
  log('HISTORY', JSON.stringify(historyPhase));
  const startSeq = sessionRow(WS_TENANT, sid).last;
  const itemsBefore = Number(sql(`SELECT LENGTH(items_json) FROM managed_agent_snapshot WHERE tenant_id=${q(WS_TENANT)} AND session_id=${q(sid)}`, db));
  const subs = [];
  for (let i = 0; i < (step.subscribers ?? 0); i++) {
    subs.push(i % 2 === 0
      ? openSse(WS_TENANT, `/v1/agents/sessions/${sid}/events?stream=true&after=${startSeq}`, { method: 'GET' }, `public-${i}`)
      : openSse(WS_TENANT, '/api/agent/web-shell/v1/events/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, afterSequence: startSeq }) }, `webshell-${i}`));
  }
  await sleep(1500);
  const a = psSnap();
  const samples = [];
  let sampling = true;
  const t0 = Date.now();
  const sampler = (async () => { while (sampling) { samples.push({ t: Date.now() - t0, ...sessionRow(WS_TENANT, sid) }); await sleep(step.sampleMs ?? 250); } })();
  const turn = await runTurn(WS_TENANT, sid, step.plan);
  const mat = await waitMaterialized(WS_TENANT, sid);
  await sleep(1200);
  sampling = false; await sampler;
  const b = psSnap();
  const d = psDiff(a, b);
  const lastSeq = sessionRow(WS_TENANT, sid).last;
  const itemsAfter = Number(sql(`SELECT LENGTH(items_json) FROM managed_agent_snapshot WHERE tenant_id=${q(WS_TENANT)} AND session_id=${q(sid)}`, db));
  const eventTypes = Object.fromEntries(rows(sql(`SELECT event_type, COUNT(*) FROM managed_agent_event WHERE tenant_id=${q(WS_TENANT)} AND session_id=${q(sid)} AND sequence_id > ${startSeq} GROUP BY event_type`, db)).map(([k, v]) => [k, +v]));
  const snapDigests = d.digests.filter((x) => /^(UPDATE|INSERT INTO) `managed_agent_snapshot`/.test(x.text));
  const live = samples.filter((x) => x.t <= turn.turnMs);
  let longest = 0, since = null;
  for (const x of live) { if (x.snapshot < x.last) { if (since === null) since = x.t; longest = Math.max(longest, x.t - since); } else since = null; }
  const delivered = subs.map((x) => { const ids = x.events.filter((e) => e.id !== null && e.id > startSeq).map((e) => e.id); return { label: x.label, status: x.status, events: ids.length, complete: ids.length === lastSeq - startSeq && ids.every((v, i) => v === startSeq + 1 + i) }; });
  for (const x of subs) x.ctrl.abort();
  await Promise.all(subs.map((x) => x.done));
  fs.writeFileSync(`${runDir}/${step.label ?? 'long'}-samples.json`, JSON.stringify(samples));
  const res = {
    sessionId: sid, historyPhase, itemsJsonBytesBefore: itemsBefore, itemsJsonBytesAfter: itemsAfter, turn, newEvents: lastSeq - startSeq, eventTypes, materialized: mat,
    snapshot: { updates: sumCount(d, /^UPDATE `managed_agent_snapshot`/), statementMs: snapDigests.reduce((s2, x) => s2 + x.ms, 0), binlog: binlogBytesByTable(a, b).managed_agent_snapshot ?? null },
    materializerSessionLocks: sumCount(d, /^SELECT .* FROM `managed_agent_session` .*FOR UPDATE/),
    progressUpdates: sumCount(d, /^UPDATE `managed_agent_consumer_progress`/),
    lag: { maxEventsBehind: Math.max(0, ...live.map((x) => x.last - x.snapshot)), longestBehindMs: longest, samples: samples.length, markerSeen: live.some((x) => x.staleSince) },
    sse: { subscribers: subs.length, workspaceAccessStatements: sumCount(d, /managed_workspace_access/), perSubscriberPerEvent: subs.length ? +(sumCount(d, /managed_workspace_access/) / subs.length / Math.max(1, lastSeq - startSeq)).toFixed(3) : null, delivered },
    binlogTotalBytes: d.binlogBytes,
    topDigests: d.digests.slice(0, 30).map((x) => ({ count: x.count, ms: x.ms, text: x.text.slice(0, 220) })),
  };
  record(step.label ?? 'long', res);
  log('LONG', JSON.stringify({ newEvents: res.newEvents, snapshot: res.snapshot, lag: res.lag, access: res.sse.workspaceAccessStatements, delivered }));
}

async function explainList(step) {
  // Capture the literal SQL of one call per list surface, then EXPLAIN ANALYZE it.
  const targets = [
    ['public-list-unbound', () => api(state.list.tenant, 'GET', '/v1/agents/sessions?limit=20')],
    ['public-list-bound', () => api(WS_TENANT, 'GET', '/v1/agents/sessions?limit=20')],
    ['webshell-list-unbound', () => api(state.list.tenant, 'POST', '/api/agent/web-shell/v1/sessions/query', { limit: 20 })],
    ['webshell-list-bound', () => api(WS_TENANT, 'POST', '/api/agent/web-shell/v1/sessions/query', { limit: 20 })],
  ];
  const out = {};
  for (const [name, call] of targets) {
    await call();
    sql('TRUNCATE TABLE performance_schema.events_statements_history_long');
    const t = Date.now();
    await call();
    const ms = Date.now() - t;
    const stmts = rows(sql(`SELECT DIGEST, REPLACE(REPLACE(SQL_TEXT, '\\n', ' '), '\\t', ' '), ROUND(TIMER_WAIT/1000000, 1), ROWS_EXAMINED, ROWS_SENT FROM performance_schema.events_statements_history_long WHERE CURRENT_SCHEMA = ${q(db)} AND (SQL_TEXT LIKE '%managed_agent_%' OR SQL_TEXT LIKE '%managed_workspace_%') AND SQL_TEXT NOT LIKE '%consumer_progress%' AND SQL_TEXT NOT LIKE '%dispatch_lease_until%' AND SQL_TEXT NOT LIKE '%delivery_state%' ORDER BY EVENT_ID`));
    const byDigest = new Map();
    for (const [dg, text, us, ex, sent] of stmts) { const o = byDigest.get(dg) ?? { text, n: 0, us: 0, examined: 0, sent: 0 }; o.n++; o.us += +us; o.examined += +ex; o.sent += +sent; byDigest.set(dg, o); }
    const plans = [];
    for (const o of byDigest.values()) {
      // performance_schema truncates SQL_TEXT at 1024 bytes; recover the full statement from the general log.
      if (o.text.length >= 1000) {
        const full = sql(`SELECT CONVERT(argument USING utf8mb4) FROM mysql.general_log WHERE command_type = 'Query' AND LEFT(CONVERT(argument USING utf8mb4), 300) = ${q(o.text.slice(0, 300))} ORDER BY event_time DESC LIMIT 1`);
        if (full) o.text = full.replace(/\\n/g, ' ');
        o.recovered = !!full;
      }
      let plan = null;
      if (/^\s*SELECT/i.test(o.text)) { try { plan = sql(`EXPLAIN ANALYZE ${o.text}`, db); } catch (e) { plan = 'EXPLAIN failed: ' + e.message.slice(0, 200); } }
      plans.push({ recovered: o.recovered ?? null, n: o.n, totalUs: Math.round(o.us * 1000) / 1000, examined: o.examined, sent: o.sent, sql: o.text.slice(0, 1500), plan });
    }
    out[name] = { wallMs: ms, statements: stmts.length, examined: stmts.reduce((a, r) => a + +r[3], 0), dbUs: Math.round(stmts.reduce((a, r) => a + +r[2], 0)), plans };
    log('EXPLAIN', name, 'statements', stmts.length, 'examined', out[name].examined, 'wall', ms);
  }
  record(step.label ?? 'explain', out);
}

async function trickle(step) {
  if (step.ws) registerWorkspace();
  const tenant = step.ws ? WS_TENANT : `trickle-${randomBytes(3).toString('hex')}`;
  const c = await createSession(tenant, 'trickle', !!step.ws);
  if (c.status !== 202) throw new Error(`create ${c.status}`);
  const sid = c.json.id;
  const plan = { n: step.n ?? 40, gap: step.gap ?? 250, hold: step.hold ?? 12000, word: 'trickle' };
  const s = await submit(tenant, sid, directive(plan));
  const t0 = Date.now();
  const samples = [];
  let done = false;
  const finished = waitTurns(tenant, sid).then((r) => { done = true; return r; });
  while (!done && Date.now() - t0 < 120000) {
    const r = sessionRow(tenant, sid);
    const items = await api(tenant, 'GET', `/v1/agents/sessions/${sid}/items?limit=100`);
    const tr = await api(tenant, 'POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: sid, limit: 500 });
    const visibleTokens = (JSON.stringify(items.json?.data ?? []).match(/trickle-\d+/g) ?? []).length;
    const transcriptTokens = (JSON.stringify(tr.json ?? {}).match(/trickle-\d+/g) ?? []).length;
    samples.push({ t: Date.now() - t0, ...r, itemsCovered: items.json?.covered_sequence ?? null, visibleTokens, transcriptTokens });
    await sleep(step.sampleMs ?? 200);
  }
  await finished;
  const mat = await waitMaterialized(tenant, sid);
  samples.push({ t: Date.now() - t0, ...sessionRow(tenant, sid), final: true });
  fs.writeFileSync(`${runDir}/trickle-samples.json`, JSON.stringify(samples));
  // Lag statistics while the stream was live.
  const live = samples.filter((x) => !x.final);
  const lag = live.map((x) => x.last - x.snapshot);
  const maxLag = Math.max(...lag);
  // Longest period during which the snapshot stayed behind last_sequence.
  let longest = 0, since = null;
  for (const x of live) {
    if (x.snapshot < x.last) { if (since === null) since = x.t; longest = Math.max(longest, x.t - since); } else since = null;
  }
  const lastTokenSample = live.findLast((x) => x.transcriptTokens > 0);
  record(step.label ?? 'trickle', { tenant, sessionId: sid, plan, submit: s.status, samples: samples.length, maxLagEvents: maxLag, longestSnapshotBehindMs: longest, maxStaleMarkerSeen: live.some((x) => x.staleSince), finalVisibleTokens: live.at(-1)?.visibleTokens, finalTranscriptTokens: lastTokenSample?.transcriptTokens, materialized: mat });
  log('TRICKLE', JSON.stringify({ maxLag, longest, samples: samples.length }));
}

async function sse(step) {
  registerWorkspace();
  const c = await createSession(WS_TENANT, 'sse', true);
  if (c.status !== 202) throw new Error(`ws create ${c.status} ${c.text}`);
  const sid = c.json.id;
  const k = step.subscribers ?? 4;
  // Settle the session's first turn so the streams start on a live session.
  await runTurn(WS_TENANT, sid, { n: 3 });
  await waitMaterialized(WS_TENANT, sid);
  const startSeq = sessionRow(WS_TENANT, sid).last;
  const subs = [];
  for (let i = 0; i < k; i++) {
    subs.push(i % 2 === 0
      ? openSse(WS_TENANT, `/v1/agents/sessions/${sid}/events?stream=true&after=${startSeq}`, { method: 'GET' }, `public-${i}`)
      : openSse(WS_TENANT, '/api/agent/web-shell/v1/events/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, afterSequence: startSeq }) }, `webshell-${i}`));
  }
  await sleep(1500);
  const a = psSnap();
  const turn = await runTurn(WS_TENANT, sid, { n: step.n ?? 400, gap: step.gap ?? 10, word: 'sse' });
  await waitMaterialized(WS_TENANT, sid);
  await sleep(1000);
  const d = psDiff(a, psSnap());
  const lastSeq = sessionRow(WS_TENANT, sid).last;
  const accessReads = sumCount(d, /managed_workspace_access/);
  const accessIo = d.tables.managed_workspace_access ?? null;
  const delivered = subs.map((s) => ({ label: s.label, status: s.status, events: s.events.filter((e) => e.id !== null && e.id > startSeq).length }));
  record(step.label ?? 'sse', { sessionId: sid, subscribers: k, turn, newEvents: lastSeq - startSeq, windowMs: d.ms, workspaceAccessStatements: accessReads, workspaceAccessTableIo: accessIo, accessDigests: d.digests.filter((x) => /managed_workspace_access/.test(x.text)).map((x) => ({ count: x.count, text: x.text.slice(0, 300) })), delivered });
  log('SSE', JSON.stringify({ newEvents: lastSeq - startSeq, accessReads, delivered }));
  for (const s of subs) s.ctrl.abort();
  await Promise.all(subs.map((s) => s.done));
  state.sseSession = sid;
  saveState();
}

async function revoke(step) {
  registerWorkspace();
  sql(`UPDATE managed_workspace_access SET can_read=TRUE WHERE tenant_id=${q(WS_TENANT)} AND workspace_id=${q(WS_ID)} AND actor_id=${q(actor)}`, db);
  const c = await createSession(WS_TENANT, 'revoke', true);
  const sid = c.json.id;
  await runTurn(WS_TENANT, sid, { n: 3 });
  await waitMaterialized(WS_TENANT, sid);
  const startSeq = sessionRow(WS_TENANT, sid).last;
  const subs = [
    openSse(WS_TENANT, `/v1/agents/sessions/${sid}/events?stream=true&after=${startSeq}`, { method: 'GET' }, 'public-live'),
    openSse(WS_TENANT, '/api/agent/web-shell/v1/events/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, afterSequence: startSeq }) }, 'webshell-live'),
  ];
  await sleep(1500);
  const plan = { n: step.n ?? 120, gap: step.gap ?? 100, word: 'rv' };
  const s = await submit(WS_TENANT, sid, directive(plan));
  await sleep(step.revokeAfterMs ?? 4000);
  const revokedAt = Date.now();
  sql(`UPDATE managed_workspace_access SET can_read=FALSE WHERE tenant_id=${q(WS_TENANT)} AND workspace_id=${q(WS_ID)} AND actor_id=${q(actor)}`, db);
  const seqAtRevoke = sessionRow(WS_TENANT, sid).last;
  // Wait for closure (bounded).
  const deadline = Date.now() + (step.waitMs ?? 20000);
  while (Date.now() < deadline && subs.some((x) => x.ended === null)) await sleep(50);
  // A fresh subscription after revocation must be refused.
  const fresh = await api(WS_TENANT, 'GET', `/v1/agents/sessions/${sid}/events?after=0`);
  const out = subs.map((x) => ({
    label: x.label,
    closedAfterRevokeMs: x.ended === null ? null : x.ended - revokedAt,
    endReason: x.ended === null ? 'still-open' : x.endReason,
    eventsAfterRevoke: x.events.filter((e) => e.t >= revokedAt && e.id !== null).length,
    lastIdDelivered: Math.max(-1, ...x.events.filter((e) => e.id !== null).map((e) => e.id)),
  }));
  for (const x of subs) x.ctrl.abort();
  await Promise.all(subs.map((x) => x.done));
  await waitTurns(WS_TENANT, sid);
  sql(`UPDATE managed_workspace_access SET can_read=TRUE WHERE tenant_id=${q(WS_TENANT)} AND workspace_id=${q(WS_ID)} AND actor_id=${q(actor)}`, db);
  record(step.label ?? 'revoke', { sessionId: sid, submit: s.status, plan, seqAtRevoke, subscribers: out, freshSubscribeAfterRevoke: { status: fresh.status, code: fresh.code } });
  log('REVOKE', JSON.stringify(out), 'fresh', fresh.status);
}

async function continueOld(step) {
  // New Turns on sessions created by an earlier phase (possibly another binary).
  const out = [];
  for (const s of state.list.sessions.filter((x) => x.turn).slice(0, step.count ?? 4)) {
    const r = await runTurn(s.tenant, s.sessionId, { n: 20, word: 'cont' });
    const m = await waitMaterialized(s.tenant, s.sessionId);
    const items = await api(s.tenant, 'GET', `/v1/agents/sessions/${s.sessionId}/items?limit=100`);
    out.push({ id: s.sessionId, ws: s.ws, ...r, materialized: m.ms !== null, items: items.json?.data?.length ?? null, hasCont: /cont-19/.test(items.text) });
  }
  // And a brand-new session.
  const c = await createSession(state.list.tenant, 'post-phase new', false);
  const r = await runTurn(state.list.tenant, c.json.id, { n: 20, word: 'fresh' });
  out.push({ id: c.json.id, fresh: true, ...r });
  record(step.label ?? 'continue', out);
  log('CONTINUE', JSON.stringify(out));
}

async function journalHeads(step) {
  const cols = sql(`SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=${q(db)} AND TABLE_NAME='qwen_managed_session_journal_head'`);
  const n = sql(`SELECT COUNT(*) FROM qwen_managed_session_journal_head`, db);
  const hasAct = cols.includes('activation_head_revision');
  const summary = hasAct
    ? rows(sql(`SELECT COUNT(*), SUM(activation_id IS NOT NULL), SUM(activation_head_revision = journal_revision), SUM(activation_head_revision IS NOT NULL AND activation_head_revision <> journal_revision) FROM qwen_managed_session_journal_head`, db))[0]
    : null;
  const ids = (state.list?.sessions ?? []).filter((x) => x.turn).map((x) => x.sessionId);
  const perSession = hasAct && ids.length ? rows(sql(`SELECT h.session_id, h.journal_revision, COALESCE(h.activation_head_revision, -1), COALESCE(h.activation_phase, ''), (SELECT COUNT(*) FROM qwen_managed_session_journal_tx t WHERE t.tenant_id = h.tenant_id AND t.session_id = h.session_id AND t.record_bytes LIKE '%activation.changed%') FROM qwen_managed_session_journal_head h WHERE h.session_id IN (${ids.map(q).join(',')})`, db)).map(([sid, rev, stamp, phase, act]) => ({ sid: sid.slice(0, 8), rev: +rev, stamp: +stamp, phase, activationTx: +act, state: +stamp === -1 ? 'null' : +stamp === +rev ? 'current' : 'lagging' })) : [];
  const tally = perSession.reduce((m, x) => ((m[x.state] = (m[x.state] ?? 0) + 1), m), {});
  record(step.label ?? 'journalHeads', { columns: cols, heads: +n, withActivation: summary?.[1] ?? null, stampCurrent: summary?.[2] ?? null, stampLagging: summary?.[3] ?? null, listSessionStamps: tally, perSession });
  log('HEADS', step.label ?? 'journalHeads', JSON.stringify({ heads: +n, withActivation: summary?.[1] ?? null, stampCurrent: summary?.[2] ?? null, stampLagging: summary?.[3] ?? null, tally }));
}

const steps = { populate, measureList, burst, longTurn, explainList, trickle, sse, revoke, continueOld, journalHeads, sleep: async (s) => sleep(s.ms) };

let error = null;
try {
  springPort = await freePort();
  harnessPort = await freePort();
  brokerPort = await freePort();
  fake = await startFakeModel();
  if (cfg.createDb) sql(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await startSpring();
  if (cfg.arm !== 'main') { state.migrated = true; saveState(); }
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
  record('summary', { name: cfg.name, arm: cfg.arm, db, jar: springJar, jarSha: createHash('sha256').update(fs.readFileSync(springJar)).digest('hex').slice(0, 16), error, modelCalls, springErrors: (springLog.match(/\bERROR\b/g) ?? []).length, springExceptions: [...new Set(springLog.match(/[a-zA-Z.]+Exception/g) ?? [])].slice(0, 20) });
  fake?.server.closeAllConnections?.();
  fake?.server.close();
  console.log(`RESULT ${JSON.stringify({ name: cfg.name, error })}`);
  process.exit(0);
}
