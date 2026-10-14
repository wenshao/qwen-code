// PR #13918 real-stack rig, round 3: ported to the 32-table schema (#14069): Spring fat jar + packaged
// Hosted Harness (dist/cli.js serve --profile hosted-harness) + Runtime Broker mounts +
// Session Store, against a private MySQL 8.4.7 (127.0.0.1:23973), with a scripted
// OpenAI-compatible model that answers with the model id it was called with.
// Optional ordinary daemon (DAEMON=1) for the ordinary Web Shell host.
// Usage: node rig.mjs serve <arm> <db>
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';

const [phase, arm, dbName] = process.argv.slice(2);
const RIG = '/Users/wenshao/pr13918-rig';
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const JAVA = `${process.env.HOME}/Install/jdk21/bin/java`;
const DBPORT = Number(process.env.DBPORT ?? 23918);
const cliBundle = `${RIG}/src-${process.env.TS_ARM ?? arm}/dist/cli.js`;
const springJar = `${RIG}/server/${process.env.JAR_ARM ?? arm}-server.jar`;
const db = `r18_${dbName}`;
const runDir = `${RIG}/runs/${db}-${phase}-${arm}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const ACTOR_HEADER = 'X-Qwen-Actor-Id';
const T = process.env.TENANT ?? 't13918';
const RUN = randomBytes(3).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
  console.log(line);
  fs.appendFileSync(`${runDir}/rig.log`, line + '\n');
};

function sqlRaw(query, database) {
  const args = ['--protocol=tcp', '-h127.0.0.1', `-P${DBPORT}`, '-uroot', '--batch', '--skip-column-names', '--raw'];
  if (database) args.push(database);
  const r = spawnSync(MYSQL, [...args, '-e', query], { encoding: 'utf8', maxBuffer: 256 << 20 });
  return { ok: r.status === 0, out: r.stdout.replace(/\n$/, ''), err: r.stderr.trim() };
}
function sql(query, database = db) {
  const r = sqlRaw(query, database);
  if (!r.ok) throw new Error(`sql failed: ${r.err}\n${query.slice(0, 300)}`);
  return r.out;
}
const q = (v) => `'${String(v).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;

// ---------- scripted model ----------
// Marker in the newest user text: RIG_HOLD_x never answers until /release (or 120 s);
// RIG_SLOW_x answers after 4 s; RIG_LONG_x answers with ~40 lines. Everything else
// answers immediately. Each answer names the model id the Harness routed to.
const model = { calls: [], held: new Set() };
async function startModel() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      const tools = (body.tools ?? []).map((t) => t.function?.name);
      const msgs = body.messages ?? [];
      const users = msgs.filter((m) => m.role === 'user');
      const lastUserText = users.length ? (typeof users.at(-1).content === 'string' ? users.at(-1).content : JSON.stringify(users.at(-1).content)) : '';
      const marker = ([...lastUserText.matchAll(/RIG_[A-Z]+_[A-Za-z0-9]+/g)].at(-1) ?? [''])[0];
      const sys = msgs.find((m) => m.role === 'system');
      const sysText = sys ? (typeof sys.content === 'string' ? sys.content : JSON.stringify(sys.content)) : '';
      const preset = (sysText.match(/RIG_PRESET_[A-Z]+/) ?? [''])[0];
      const id = 'chatcmpl-' + randomBytes(6).toString('hex');
      const created = Math.floor(Date.now() / 1000);
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      const turnCall = body.stream === true && tools.length > 0;
      const rec = { t: new Date().toISOString(), model: body.model, stream: body.stream === true, tools: tools.length, marker, preset, turnCall, lastUserText: lastUserText.slice(0, 400) };
      model.calls.push(rec);
      fs.appendFileSync(`${runDir}/model.jsonl`, JSON.stringify(rec) + '\n');
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, object: 'chat.completion', created, model: body.model ?? 'fake', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage }));
        return;
      }
      const chunk = (delta, finish = null, u) => ({ id, object: 'chat.completion.chunk', created, model: body.model ?? 'fake', choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) });
      const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      send(chunk({ role: 'assistant' }));
      if (!turnCall) {
        send(chunk({ content: 'OK' }));
        send(chunk({}, 'stop', usage));
        res.end('data: [DONE]\n\n');
        return;
      }
      const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
      const toolResults = lastUserIdx >= 0 ? msgs.slice(lastUserIdx + 1).filter((m) => m.role === 'tool').length : 0;
      rec.toolResults = toolResults;
      const toolCall = () => {
        const t = (body.tools ?? []).find((x) => x.function?.name === 'read_file');
        const props = Object.keys(t?.function?.parameters?.properties ?? {});
        const pathKey = props.find((p) => /path/.test(p)) ?? 'file_path';
        const args = JSON.stringify({ [pathKey]: `${process.env.RIG_WS_PREFIX ?? ''}docs/readme.txt` });
        send(chunk({ tool_calls: [{ index: 0, id: `call_${marker}_${toolResults}`, type: 'function', function: { name: 'read_file', arguments: args } }] }));
        send(chunk({}, 'tool_calls', usage));
        res.end('data: [DONE]\n\n');
      };
      // RIG_HOLD_x: held until /release (or 120 s), then a text answer.
      // RIG_HOLDT_x: held until /release, then a read_file call; the follow-up answers at once.
      if (marker.startsWith('RIG_HOLD') && toolResults === 0) {
        const h = { marker, res, since: Date.now() };
        h.end = () => { clearTimeout(timer); model.held.delete(h); rec.releasedAt = new Date().toISOString(); try { if (marker.startsWith('RIG_HOLDT')) toolCall(); else { send(chunk({ content: `late ${marker}` })); send(chunk({}, 'stop', usage)); res.end('data: [DONE]\n\n'); } } catch {} };
        model.held.add(h);
        const timer = setTimeout(() => h.end(), 120000);
        res.on('close', () => { clearTimeout(timer); model.held.delete(h); });
        return;
      }
      if (marker.startsWith('RIG_TOOL') && toolResults === 0) {
        const t = (body.tools ?? []).find((x) => x.function?.name === 'read_file');
        if (!model.dumped) { model.dumped = true; fs.writeFileSync(`${runDir}/tools.json`, JSON.stringify(body.tools, null, 1)); }
        const props = Object.keys(t?.function?.parameters?.properties ?? {});
        const pathKey = props.find((p) => /path/.test(p)) ?? 'file_path';
        const args = JSON.stringify({ [pathKey]: `${process.env.RIG_WS_PREFIX ?? ''}docs/readme.txt` });
        send(chunk({ tool_calls: [{ index: 0, id: `call_${marker}`, type: 'function', function: { name: t ? 'read_file' : (tools[0] ?? 'read_file'), arguments: args } }] }));
        send(chunk({}, 'tool_calls', usage));
        res.end('data: [DONE]\n\n');
        return;
      }
      if (marker.startsWith('RIG_SLOW')) await sleep(4000);
      const answer = marker.startsWith('RIG_LONG')
        ? Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long answer for ${marker} from ${body.model}.`).join('\n\n')
        : `RIG_DONE ${marker}${toolResults ? ` after ${toolResults} tool result(s)` : ''}`;
      send(chunk({ content: answer }));
      send(chunk({}, 'stop', usage));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

// ---------- processes ----------
const children = [];
function start(name, cmd, args, env, cwd = RIG) {
  const out = fs.openSync(`${runDir}/${name}.log`, 'a');
  const child = spawn(cmd, args, { env, cwd, detached: true, stdio: ['ignore', out, out] });
  const rec = { name, child };
  children.push(rec);
  fs.writeFileSync(`${runDir}/${name}.pid`, String(child.pid));
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
      !/^(qwen|dashscope|dashscop|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(k) &&
      !/(api_?key|token|secret|password|credentials?|_ak)$/i.test(k),
  ),
);
const stable = `${RIG}/wsroot/${db}`;
const tmp = `${runDir}/tmp`;
const workspace = `${stable}/workspace`;
const harnessHome = `${stable}/harness-home`;
const runtimeHome = `${stable}/runtime-home`;
const runtimeState = `${stable}/runtime-state`;
const daemonHome = `${stable}/daemon-home`;
const daemonWs = `${stable}/daemon-workspace`;
const STORAGES = { W1: 'st1', W2: 'st2', W3: 'st3' };
const NAMES = { W1: 'Project Alpha', W2: 'Project Beta', W3: 'Project Gamma (read-only)' };
const mount = (st) => `${stable}/mounts/${st}`;
for (const d of [tmp, workspace, `${harnessHome}/.qwen`, `${runtimeHome}/.qwen`, runtimeState, `${daemonHome}/.qwen`, daemonWs, `${stable}/daemon-runtime`]) fs.mkdirSync(d, { recursive: true });
for (const st of Object.values(STORAGES)) for (const d of ['docs', 'src', 'docs/api']) fs.mkdirSync(`${mount(st)}/${d}`, { recursive: true });
for (const st of Object.values(STORAGES)) fs.writeFileSync(`${mount(st)}/docs/readme.txt`, `rig readme for ${st}\n`);
const MODELS = ['rig-model-a', 'rig-model-b', 'fake-model'];
const harnessSettings = (baseUrl) => ({
  env: { RIG_FAKE_KEY: 'fake-key' },
  model: { name: 'fake-model' },
  modelProviders: { openai: MODELS.map((id) => ({ id, name: id, envKey: 'RIG_FAKE_KEY', baseUrl })) },
  security: { auth: { selectedType: 'openai' } },
  ui: { enableFollowupSuggestions: false },
});
fs.writeFileSync(`${runtimeHome}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
const trustedFolders = `${tmp}/trusted-folders.json`;
fs.writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER', [daemonWs]: 'TRUST_FOLDER' }), { mode: 0o600 });
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
const harnessToken = randomBytes(24).toString('hex');
const brokerToken = randomBytes(24).toString('hex');
const daemonToken = randomBytes(16).toString('hex');
const keyFile = `${stable}/credential-key`;
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(32).toString('base64'));
const credentialKey = fs.readFileSync(keyFile, 'utf8').trim();
const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
let springPort, harnessPort, brokerPort, daemonPort, fake, spring, harness, daemon;

function springEnv() {
  return {
    ...cleanEnv,
    HOME: runtimeHome, QWEN_HOME: `${runtimeHome}/.qwen`, TMPDIR: tmp, TZ: 'UTC',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(springPort),
    SPRING_DATASOURCE_PASSWORD: process.env.DBPASS ?? '',
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${DBPORT}/${db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
    QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT: '60m',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_MANAGED_AGENT_DEFINITION_MODELS: 'rig-model-a,rig-model-b',
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
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: process.env.LEASE ?? '60s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_CLI_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
  };
}
async function startSpring() {
  const t = Date.now();
  const mounts = Object.values(STORAGES).flatMap((st, i) => [
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].tenant-id=${T}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].storage-id=${st}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].root=${mount(st)}`,
  ]);
  const extra = process.env.POOL ? [`--spring.datasource.druid.max-active=${process.env.POOL}`] : [];
  spring = start('spring', JAVA, [...(process.env.JAVA_OPTS ? process.env.JAVA_OPTS.split(' ') : []), '-jar', springJar, ...mounts, ...extra], springEnv());
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 300000, spring);
  log('spring.ready', Date.now() - t, 'ms');
}
async function startHarness() {
  fs.writeFileSync(`${harnessHome}/.qwen/settings.json`, JSON.stringify(harnessSettings(fake.baseUrl)), { mode: 0o600 });
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
    RIG_FAKE_KEY: 'fake-key',
    OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
  });
  await waitFor('harness', async () => (await fetch(`http://127.0.0.1:${harnessPort}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 180000, harness);
  log('harness.ready');
}
async function startDaemon() {
  fs.writeFileSync(`${daemonHome}/.qwen/settings.json`, JSON.stringify({ ...harnessSettings(fake.baseUrl), tools: { approvalMode: 'yolo' } }), { mode: 0o600 });
  daemon = start('daemon', process.execPath, [cliBundle, 'serve', '--port', String(daemonPort), '--hostname', '127.0.0.1', '--workspace', daemonWs, '--no-web', '--max-sessions', '0'], {
    ...cleanEnv,
    HOME: daemonHome, QWEN_HOME: `${daemonHome}/.qwen`, QWEN_RUNTIME_DIR: `${stable}/daemon-runtime`, TMPDIR: tmp,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders, QWEN_SERVER_TOKEN: daemonToken, QWEN_CODE_NO_RELAUNCH: 'true',
    RIG_FAKE_KEY: 'fake-key', OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model',
  }, daemonWs);
  await waitFor('daemon', async () => (await fetch(`http://127.0.0.1:${daemonPort}/health`, { headers: { authorization: `Bearer ${daemonToken}` } })).ok, 120000, daemon);
  log('daemon.ready');
}

async function api(actor, method, p, body, key) {
  const headers = { 'x-qwen-tenant-id': T, accept: 'application/json' };
  if (actor) headers[ACTOR_HEADER] = actor;
  if (body) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const r = await fetch(`http://127.0.0.1:${springPort}${p}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

// Length-prefixed SHA-256 (ManagedSchemaKeys.key / JdbcRepositorySupport.valueKey / storageAliasKey).
const lpKey = (...parts) => { const h = createHash('sha256'); for (const p of parts) { const b = Buffer.from(p, 'utf8'); const l = Buffer.alloc(4); l.writeInt32BE(b.length); h.update(l).update(b); } return h.digest('hex'); };
// #14069 requires a registered LOCAL storage alias + owner row before a Hosted tool can claim the
// Workspace. The operator entry (WorkspaceStorageRegistrationMain register) reads a Linux-only mount
// identity (/etc/machine-id, inode, birth time), so on this macOS rig the same two rows are seeded in
// the shape a completed registration leaves. Verified-workspace recovery stays at its default (off),
// so no code path re-reads the mount identity. Both arms get identical rows.
function seedStorage() {
  for (const st of Object.values(STORAGES)) {
    const physical = lpKey('local-storage/1', 'pr13918-rig-host', st);
    const op = '00000000-0000-4000-8000-' + physical.slice(0, 12);
    sql(`INSERT INTO ma_storage (alias_key, tenant_key, storage_key, tenant_id, storage_id, physical_key, registration_state, storage_kind, registration_revision, registration_json) VALUES ('${lpKey('qwen-csi-alias/1', T, st)}', '${lpKey(T)}', '${lpKey(st)}', ${q(T)}, '${st}', '${physical}', 'REGISTERED', 'LOCAL', 1, '{"schemaVersion":1,"operationId":"${op}"}') ON DUPLICATE KEY UPDATE registration_state = 'REGISTERED'`);
    sql(`INSERT INTO ma_storage_owner (storage_key, physical_key, storage_kind, tenant_id, storage_id, mount_state, mount_revision, mount_completed_operation_id, mount_registration_id, mount_root) VALUES ('${physical}', '${physical}', 'LOCAL', ${q(T)}, '${st}', 'READY', 1, '${op}', '${op}', ${q(mount(st))}) ON DUPLICATE KEY UPDATE mount_state = 'READY'`);
  }
}
const ROLES = { alice: { W1: 'OPERATOR', W2: 'OPERATOR', W3: 'READER' }, bob: { W1: 'OPERATOR' } };
function setupTopology() {
  for (const [w, st] of Object.entries(STORAGES)) {
    sql(`INSERT INTO ma_workspace (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(T)}, '${w}', 1, '${st}', ${q(NAMES[w])}, 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE') ON DUPLICATE KEY UPDATE state='ACTIVE', workspace_generation=1, storage_id='${st}', display_name=${q(NAMES[w])}`);
  }
  for (const [a, grants] of Object.entries(ROLES))
    for (const [w, role] of Object.entries(grants))
      sql(`INSERT INTO ma_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, '${w}', '${a}', '${role}') ON DUPLICATE KEY UPDATE role='${role}'`);
}
// Model-specific AgentDefinitions (published by the host, as the README requires).
async function publishDefinitions() {
  const file = `${stable}/definitions.json`;
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const defs = {};
  for (const [name, modelId] of [['A', 'rig-model-a'], ['B', 'rig-model-b'], ['X', 'rig-model-unlisted']]) {
    const r = await api('alice', 'POST', '/v1/agents', {
      model: { id: modelId },
      instructions: `RIG_PRESET_${name}: you are preset ${name}.`,
      tools: [{ type: 'hosted_profile', profile: 'hosted-workspace-files/1' }],
      permission_policy: {},
    }, `def-${name}-${RUN}`);
    if (r.status !== 202) throw new Error(`definition ${name}: ${r.status} ${r.text}`);
    defs[name] = { agentId: r.json.id, model: modelId };
  }
  fs.writeFileSync(file, JSON.stringify(defs, null, 2));
  return defs;
}

async function serve() {
  const defs = {};
  const control = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/model') { res.end(JSON.stringify(model.calls)); return; }
    if (u.pathname === '/release') { const n = model.held.size; for (const h of [...model.held]) h.end(); res.end(JSON.stringify({ released: n })); return; }
    if (u.pathname === '/held') { res.end(JSON.stringify([...model.held].map((h) => h.marker))); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => control.listen(0, '127.0.0.1', r));
  const info = { arm, db, tenant: T, run: RUN, springPort, harnessPort, harnessToken, brokerPort, daemonPort, daemonToken, controlPort: control.address().port, definitions: defs, mountRoot: `${stable}/mounts`, runDir, jar: springJar, bundle: cliBundle, pool: process.env.POOL ?? "20(default)", lease: process.env.LEASE ?? "60s" };
  fs.writeFileSync(`${RIG}/state/serve-${dbName}.json`, JSON.stringify(info, null, 2));
  log('SERVING', JSON.stringify(info));
  await new Promise((resolve) => { process.on('SIGTERM', resolve); });
  control.close();
}

const shutdown = async () => {
  for (const h of model.held) try { h.res.destroy(); } catch {}
  for (const c of [...children].reverse()) await stop(c);
  fake?.server.close();
};
process.on('SIGINT', async () => { await shutdown(); process.exit(130); });
process.removeAllListeners('SIGTERM');
try {
  sql(`CREATE DATABASE IF NOT EXISTS ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`, '');
  springPort = await freePort(); harnessPort = await freePort(); brokerPort = await freePort(); daemonPort = await freePort();
  fake = await startModel();
  await startSpring();
  await startHarness();
  if (process.env.DAEMON) await startDaemon();
  setupTopology();
  seedStorage();
  if (phase === 'serve') await serve();
  else throw new Error(`unknown phase ${phase}`);
} catch (e) {
  log('FAILED', String(e.stack ?? e));
  process.exitCode = 1;
} finally {
  await shutdown();
  process.exit(process.exitCode ?? 0);
}
