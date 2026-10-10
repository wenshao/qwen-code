// PR #13760 real-stack rig (adapted from the #13545 rig): one arm's Spring fat jar + the packaged Hosted Harness
// (dist/cli.js serve --profile hosted-harness) + a scripted OpenAI-compatible model,
// against a private MySQL 8.4.7 (127.0.0.1:23545). Every request goes through real
// HTTP with the trusted actor header; every decision is read back from the DB.
// Usage: node rig.mjs <matrix|serve|budget> <arm> <db>   (ONLY=K1,K2,... selects matrix states)
//   matrix: states A (normal), O (owner != creator), L (close/delete), B (creator demoted),
//           C (registry DRAINING), D (cwd initiator demoted after admission)
//   facts:  state B only (for mutant jars)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';

const [phase, arm, dbName] = process.argv.slice(2);
const RIG = '/Users/wenshao/pr13760-rig';
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const JAVA = `${process.env.HOME}/Install/jdk21/bin/java`;
const DBPORT = 23760;
// The PR changes no Harness/CLI code: base/head use base's bundle; main/merge use the
// trial merge's bundle (== main's CLI, which #13550 moved).
// The PR changes no Harness/CLI code: every arm uses the trial merge's bundle (== main's CLI).
const cliBundle = `${RIG}/src-${process.env.CLI_ARM ?? 'merge'}/dist/cli.js`;
const springJar = `${RIG}/server/${arm}-server.jar`;
const db = `r60_${dbName}`;
const runDir = `${RIG}/runs/${db}-${phase}-${arm}`;
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(runDir, { recursive: true });
const ACTOR_HEADER = 'x-rig-actor';
const T = 'rig-tenant';
const RUN = randomBytes(3).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
  console.log(line);
  fs.appendFileSync(`${runDir}/rig.log`, line + '\n');
};
const results = { phase, arm, db, jar: springJar, cli: cliBundle, run: RUN, cells: {} };
const save = () => fs.writeFileSync(`${runDir}/results.json`, JSON.stringify(results, null, 2));
const cell = (k, v) => {
  results.cells[k] = v;
  save();
  log('CELL', k, JSON.stringify(v));
};

// ---------- SQL ----------
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
const rows = (text) => (text ? text.split('\n').map((l) => l.split('\t')) : []);
const num = (query) => Number(sql(query));

// ---------- scripted model ----------
// The last user message carries the marker: RIG_TEXT answers, RIG_HOLD never answers
// (until the Harness aborts it), RIG_WRITE asks for one write_file (an approval under
// approval-mode=default) and finishes after its tool result. Only requests that offer
// tools count as Turn requests; auxiliary calls get a plain answer.
const model = { turnRequests: 0, aux: 0, held: new Set(), byMarker: {} };
async function startModel() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      const tools = (body.tools ?? []).map((t) => t.function?.name);
      const msgs = body.messages ?? [];
      let lastUser = -1;
      msgs.forEach((m, i) => { if (m.role === 'user' && JSON.stringify(m.content ?? '').includes('RIG_')) lastUser = i; });
      const text = lastUser >= 0 ? JSON.stringify(msgs[lastUser].content) : '';
      // After a cancel the Harness merges the cancelled prompt and the next one into a
      // single user message: the newest marker is the last one.
      const marker = ([...text.matchAll(/RIG_[A-Z]+_[a-z0-9]+/g)].at(-1) ?? [''])[0];
      const toolResults = lastUser >= 0 ? msgs.slice(lastUser + 1).filter((m) => m.role === 'tool').length : 0;
      fs.appendFileSync(`${runDir}/model.log`, `${new Date().toISOString().slice(11, 23)} stream=${body.stream === true} tools=${tools.length} msgs=${msgs.length} marker=${marker} toolResults=${toolResults} last=${JSON.stringify(msgs.slice(-2).map((m) => [m.role, String(JSON.stringify(m.content ?? m.tool_calls ?? '')).slice(0, 80)]))}\n`);
      const id = 'chatcmpl-' + randomBytes(6).toString('hex');
      const created = Math.floor(Date.now() / 1000);
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      if (body.stream !== true || tools.length === 0) {
        model.aux++;
        if (body.stream !== true) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id, object: 'chat.completion', created, model: body.model ?? 'fake', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage }));
          return;
        }
      } else {
        model.turnRequests++;
        model.byMarker[marker] = (model.byMarker[marker] ?? 0) + 1;
      }
      const chunk = (delta, finish = null, u) => ({ id, object: 'chat.completion.chunk', created, model: body.model ?? 'fake', choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) });
      const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
      if (tools.length && marker.startsWith('RIG_HOLD')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        send(chunk({ role: 'assistant' }));
        const h = { marker, res };
        // Like the PR's IT (heldReply.countDown after CANCELLED): the Harness does not
        // abort the stream on cancel, so the rig ends it once the Turn has settled.
        h.end = () => { clearTimeout(t); model.held.delete(h); try { send(chunk({ content: 'late' })); send(chunk({}, 'stop', usage)); res.end('data: [DONE]\n\n'); } catch {} };
        model.held.add(h);
        const t = setTimeout(() => h.end(), 120000);
        res.on('close', () => { clearTimeout(t); model.held.delete(h); });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      send(chunk({ role: 'assistant' }));
      if (tools.includes('write_file') && marker.startsWith('RIG_WRITE') && toolResults === 0) {
        const args = JSON.stringify({ file_path: `${marker}.txt`, content: 'approved' });
        send(chunk({ tool_calls: [{ index: 0, id: `call_${marker}`, type: 'function', function: { name: 'write_file', arguments: args } }] }));
        send(chunk({}, 'tool_calls', usage));
      } else {
        send(chunk({ content: `RIG_DONE ${marker}` }));
        send(chunk({}, 'stop', usage));
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

// ---------- MySQL statement relay (RELAY=1) ----------
// Spring's datasource goes through this byte relay. A held pattern parks the first
// client->server COM_QUERY whose text contains every needle until the test releases it;
// the rig's own SQL uses a direct connection, so it can change state meanwhile.
const relay = { port: null, hold: null, heldLog: [] };
async function startRelay() {
  const net = await import('node:net');
  const server = net.createServer((client) => {
    const upstream = net.connect(DBPORT, '127.0.0.1');
    let buf = Buffer.alloc(0);
    let paused = false;
    const pump = () => {
      while (!paused && buf.length >= 4) {
        const len = buf.readUIntLE(0, 3);
        if (buf.length < 4 + len) return;
        const pkt = buf.subarray(0, 4 + len);
        const h = relay.hold;
        if (h && !h.fired && len > 1 && pkt[4] === 0x03) {
          const text = pkt.subarray(5).toString('latin1');
          if (h.needles.every((n) => text.includes(n))) {
            h.fired = true;
            paused = true;
            relay.heldLog.push({ t: Date.now(), sql: text.replace(/[^\x20-\x7e]/g, '').slice(0, 220) });
            h.onHold().finally(() => { paused = false; pump(); });
            return;
          }
        }
        upstream.write(pkt);
        buf = buf.subarray(4 + len);
      }
    };
    client.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
    upstream.on('data', (d) => client.write(d));
    const end = () => { client.destroy(); upstream.destroy(); };
    client.on('error', end); upstream.on('error', end); client.on('close', end); upstream.on('close', end);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  relay.port = server.address().port;
  relay.server = server;
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
// Deployment directories are stable per database (the Session Store workspace id is
// derived from the workspace path; a per-run path would orphan earlier Sessions).
const stable = `${RIG}/wsroot/${db}`;
const tmp = `${runDir}/tmp`;
const workspace = `${stable}/workspace`;
const harnessHome = `${stable}/harness-home`;
const runtimeHome = `${stable}/runtime-home`;
const runtimeState = `${stable}/runtime-state`;
const STORAGES = { W1: 'st1', W2: 'st2', W3: 'st3', W4: 'st4' };
const mount = (st) => `${stable}/mounts/${st}`;
for (const d of [tmp, workspace, `${harnessHome}/.qwen`, `${runtimeHome}/.qwen`, runtimeState]) fs.mkdirSync(d, { recursive: true });
const NAMED_DIRS = ['A', 'B', 'B/inner', 'dir with spaces', '目录', 'docs'];
for (const st of Object.values(STORAGES)) {
  for (let i = 0; i < 80; i++) fs.mkdirSync(`${mount(st)}/d${String(i).padStart(2, '0')}`, { recursive: true });
  for (const d of NAMED_DIRS) fs.mkdirSync(`${mount(st)}/${d}`, { recursive: true });
}
for (const h of [harnessHome, runtimeHome]) fs.writeFileSync(`${h}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
const trustedFolders = `${tmp}/trusted-folders.json`;
fs.writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
const harnessToken = randomBytes(24).toString('hex');
const brokerToken = randomBytes(24).toString('hex');
const keyFile = `${stable}/credential-key`;
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(32).toString('base64'));
const credentialKey = fs.readFileSync(keyFile, 'utf8').trim();
const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
let springPort, harnessPort, brokerPort, fake, spring, harness;

function springEnv() {
  return {
    ...cleanEnv,
    HOME: runtimeHome, QWEN_HOME: `${runtimeHome}/.qwen`, TMPDIR: tmp, TZ: 'UTC',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(springPort),
    SPRING_DATASOURCE_PASSWORD: '',
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${relay.port ?? DBPORT}/${db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'default',
    QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT: '60m',
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
  const mounts = Object.values(STORAGES).flatMap((st, i) => [
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].tenant-id=${T}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].storage-id=${st}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].root=${mount(st)}`,
  ]);
  spring = start('spring', JAVA, ['-jar', springJar, ...mounts], springEnv());
  await waitFor('spring', async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 300000, spring);
  const springLog = fs.readFileSync(`${runDir}/spring.log`, 'utf8');
  const flyway = springLog.split('\n').filter((l) => /Successfully applied|Current version of schema|Migrating schema .* to version "5[0-9]/i.test(l)).map((l) => l.replace(/^.*?(INFO|WARN|ERROR)\s+\d+\s+---\s+\[[^\]]*\]\s+\[[^\]]*\]\s+\S+\s+:\s+/, ''));
  results.springBoot = { ms: Date.now() - t, flyway };
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
async function api(actor, method, p, body, key) {
  const headers = { 'x-qwen-tenant-id': T, accept: 'application/json' };
  if (actor) headers[ACTOR_HEADER] = actor;
  if (body) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const r = await fetch(`http://127.0.0.1:${springPort}${p}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, code: json?.error?.code ?? null };
}
const key = (tag) => `${tag}-${RUN}-${randomBytes(3).toString('hex')}`;
const WEB = '/api/agent/web-shell/v1';

async function createBound(ws, title, actor = 'cr') {
  const r = await api(actor, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: ws }, metadata: { title: `${title}-${RUN}` } }, key('create'));
  if (r.status !== 202) throw new Error(`create ${title}: ${r.status} ${r.text}`);
  return r.json.id;
}
async function submit(surface, actor, sid, marker) {
  const input = [{ type: 'input_text', text: `please ${marker}` }];
  const r = surface === 'pub'
    ? await api(actor, 'POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.input.message', input }, key('submit'))
    : await api(actor, 'POST', `${WEB}/turns/submit`, { idempotencyKey: key('wsubmit'), sessionId: sid, input: [{ type: 'text', text: `please ${marker}` }] });
  return { ...r, turnId: r.json?.turn_id ?? r.json?.turnId ?? null };
}
async function cancel(surface, actor, sid, turnId) {
  return surface === 'pub'
    ? api(actor, 'POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.cancel', turn_id: turnId }, key('cancel'))
    : api(actor, 'POST', `${WEB}/turns/cancel`, { idempotencyKey: key('wcancel'), sessionId: sid, turnId });
}
function revisionOf(o) {
  if (!o || typeof o !== 'object') return null;
  for (const [k, v] of Object.entries(o)) {
    if (/^context_revision$|^contextRevision$/.test(k) && typeof v === 'number') return v;
    if (v && typeof v === 'object') { const r = revisionOf(v); if (r !== null) return r; }
  }
  return null;
}
async function cwdChange(surface, actor, sid, target) {
  const rev = Number(sql(`SELECT context_revision FROM managed_agent_session WHERE session_id=${q(sid)}`));
  const r = surface === 'pub'
    ? await api(actor, 'POST', `/v1/agents/sessions/${sid}/cwd`, { cwd_relative: target, expected_context_revision: rev }, key('cwd'))
    : await api(actor, 'POST', `${WEB}/sessions/cwd/change`, { sessionId: sid, idempotencyKey: key('wcwd'), cwdRelative: target, expectedContextRevision: rev });
  return { ...r, opId: r.json?.id ?? r.json?.operationId ?? null };
}
async function lifecycle(surface, actor, sid, verb) {
  if (surface === 'pub') {
    return verb === 'delete'
      ? api(actor, 'DELETE', `/v1/agents/sessions/${sid}`, null, key('del'))
      : api(actor, 'POST', `/v1/agents/sessions/${sid}/${verb}`, null, key(verb));
  }
  return api(actor, 'POST', `${WEB}/sessions/${verb}`, { sessionId: sid, idempotencyKey: key(`w${verb}`) });
}
async function pendingAction(sid, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await api('cr', 'GET', `/v1/agents/sessions/${sid}/actions`);
    const a = (r.json?.data ?? []).find((x) => x.state === 'requested');
    if (a) return a;
    await sleep(250);
  }
  return null;
}
async function respond(surface, actor, sid, action) {
  if (surface === 'pub') {
    return api(actor, 'POST', `/v1/agents/sessions/${sid}/actions/${action.id}/responses`, { kind: 'permission', option_id: 'allow', input_revision: action.input_revision, policy_revision: action.policy_revision }, key('respond'));
  }
  return api(actor, 'POST', `${WEB}/actions/respond`, { sessionId: sid, actionId: action.id, idempotencyKey: key('wrespond'), response: { kind: 'permission', optionId: 'allow', inputRevision: action.input_revision, policyRevision: action.policy_revision } });
}
async function waitOp(sid, opId, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    const r = await api('cr', 'GET', `/v1/agents/sessions/${sid}/operations/${opId}`);
    const st = r.json?.status;
    last = st ?? `http${r.status}`;
    if (st && /completed|failed|rejected|cancel|expired/i.test(st)) return { state: st, failure: r.json?.failure_code ?? r.json?.error?.code ?? null };
    await sleep(250);
  }
  const row = rows(sql(`SELECT state, COALESCE(error_code,''), admission_stage, delivery_state FROM managed_agent_operation WHERE operation_id=${q(opId)}`))[0];
  return { state: `NOT_SETTLED(${last})`, db: row };
}
const turnRow = (turnId) => rows(sql(`SELECT status, COALESCE(error_code,'') FROM managed_agent_turn WHERE turn_id=${q(turnId)}`))[0] ?? null;
async function waitTurn(turnId, timeoutMs = 60000, until = /COMPLETED|FAILED|CANCELLED/) {
  const end = Date.now() + timeoutMs;
  let r = null;
  while (Date.now() < end) {
    r = turnRow(turnId);
    if (r && until.test(r[0])) return { turn: r[0], error: r[1] || null, ms: timeoutMs - (end - Date.now()) };
    await sleep(200);
  }
  return { turn: `NOT_SETTLED(${r?.[0]})` };
}
async function waitIdle(sid, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (num(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id=${q(sid)} AND status IN ('ACCEPTED','RUNNING','CANCELLING')`) === 0) return true;
    await sleep(250);
  }
  return false;
}
async function waitHeld(marker, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ([...model.held].some((h) => h.marker === marker)) return true;
    await sleep(100);
  }
  return false;
}
const release = (marker) => { for (const h of [...model.held]) if (h.marker === marker) h.end(); };
const counters = () => ({
  turnReq: model.turnRequests,
  pendingCmd: num(`SELECT COUNT(*) FROM managed_agent_command WHERE tenant_id=${q(T)} AND command_status='PENDING'`),
  turns: num(`SELECT COUNT(*) FROM managed_agent_turn WHERE tenant_id=${q(T)}`),
  ops: num(`SELECT COUNT(*) FROM managed_agent_operation WHERE tenant_id=${q(T)}`),
});
const delta = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]]));
const short = (r) => ({ status: r.status, code: r.code });

// ---------- topology ----------
const ACTORS = ['cr', 'op2', 'ow2', 'rd', 'nn'];
const ROLES = { cr: 'OPERATOR', op2: 'OPERATOR', ow2: 'OWNER', rd: 'READER' };
function setupTopology(tenant = T) {
  for (const [w, st] of Object.entries(STORAGES)) {
    sql(`INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(tenant)}, '${w}', 1, '${st}', 'Rig ${w}', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE') ON DUPLICATE KEY UPDATE state='ACTIVE', workspace_generation=1, storage_id='${st}'`);
    for (const [a, role] of Object.entries(ROLES)) {
      sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(tenant)}, '${w}', '${a}', '${role}') ON DUPLICATE KEY UPDATE role='${role}'`);
    }
    sql(`DELETE FROM managed_workspace_access WHERE tenant_id=${q(tenant)} AND workspace_id='${w}' AND actor_id='nn'`);
  }
}
const setRole = (actor, role, ws = null) => sql(`UPDATE managed_workspace_access SET role='${role}' WHERE tenant_id=${q(T)} AND actor_id='${actor}'${ws ? ` AND workspace_id='${ws}'` : ''}`);
const setRegistry = (ws, clause) => sql(`UPDATE managed_workspace_registry SET ${clause} WHERE tenant_id=${q(T)} AND workspace_id='${ws}'`);
const restoreRegistry = (ws) => setRegistry(ws, `state='ACTIVE', workspace_generation=1, storage_id='${STORAGES[ws]}'`);
let dirSeq = 0;
const nextDir = () => `d${String(dirSeq++ % 80).padStart(2, '0')}`;
const sessionRow = (sid) => {
  const r = rows(sql(`SELECT cwd_relative, context_revision, status FROM managed_agent_session WHERE session_id=${q(sid)}`))[0];
  return r ? { cwd: r[0], rev: Number(r[1]), status: r[2] } : null;
};

async function caps(actor, sid) {
  const g = await api(actor, 'POST', `${WEB}/sessions/get`, { sessionId: sid });
  const s = g.json?.session ?? g.json;
  const qy = await api(actor, 'POST', `${WEB}/sessions/query`, { limit: 100 });
  const item = (qy.json?.data ?? qy.json?.sessions ?? []).find((x) => (x.sessionId ?? x.id) === sid);
  const pg = await api(actor, 'GET', `/v1/agents/sessions/${sid}`);
  return {
    get: g.status === 200
      ? { cwdChange: s?.capabilities?.cwdChange ?? '(absent)', workspaceTurns: s?.capabilities?.workspaceTurns, cwd: s?.workspace?.cwdRelative, rev: s?.workspace?.contextRevision, state: s?.workspace?.state }
      : { status: g.status, code: g.code },
    query: item ? { cwdChange: item.capabilities?.cwdChange ?? '(absent)', workspaceTurns: item.capabilities?.workspaceTurns } : { listed: false, status: qy.status },
    pubCwdCap: pg.status === 200 ? (pg.json?.capabilities?.cwd_change ?? '(absent)') : `http${pg.status}`,
  };
}
async function cwdRaw(actor, sid, target, rev, k, surface = 'web') {
  const r = surface === 'pub'
    ? await api(actor, 'POST', `/v1/agents/sessions/${sid}/cwd`, { cwd_relative: target, expected_context_revision: rev }, k)
    : await api(actor, 'POST', `${WEB}/sessions/cwd/change`, { sessionId: sid, idempotencyKey: k, cwdRelative: target, expectedContextRevision: rev });
  return { ...short(r), opId: r.json?.id ?? r.json?.operationId ?? null, replayed: r.json?.replayed ?? null, opStatus: r.json?.status ?? null };
}
// One capability-vs-admission cell: read the caller's capability, then really try the change.
async function mirror(label, actor, sid, target = nextDir()) {
  const c = await caps(actor, sid);
  const before = sessionRow(sid);
  const r = await cwdRaw(actor, sid, target, before?.rev ?? 1, key('m'));
  const v = { cap: c.get.cwdChange, capQuery: c.query.cwdChange, workspaceTurns: c.get.workspaceTurns, pubCwdCap: c.pubCwdCap, getStatus: c.get.status ?? 200, admit: `${r.status} ${r.code ?? ''}`.trim() };
  if (r.status === 202 && r.opId) {
    const op = await waitOp(sid, r.opId);
    v.op = op.state + (op.failure ? `/${op.failure}` : '');
    v.moved = sessionRow(sid)?.cwd === target;
  }
  const capTrue = c.get.cwdChange === true;
  v.mirror = capTrue === (r.status === 202) ? 'agree' : capTrue ? 'CAP-TRUE-BUT-REFUSED' : 'CAP-FALSE-BUT-ADMITTED';
  cell(`${label}|${actor}`, v);
  return v;
}
async function approveAll(sid, turnId, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const t = turnRow(turnId);
    if (t && /COMPLETED|FAILED|CANCELLED/.test(t[0])) return { turn: t[0], error: t[1] || null };
    const r = await api('cr', 'GET', `/v1/agents/sessions/${sid}/actions`);
    const a = (r.json?.data ?? []).find((x) => x.state === 'requested');
    if (a) await respond('pub', 'cr', sid, a);
    await sleep(250);
  }
  return { turn: `NOT_SETTLED(${turnRow(turnId)?.[0]})` };
}
// After a Turn, how long until the retained Runtime session stops blocking a cwd change.
async function changeWhenAdmitted(actor, sid, target, timeoutMs = 90000) {
  const t0 = Date.now();
  let first = null;
  let attempts = 0;
  while (Date.now() - t0 < timeoutMs) {
    attempts++;
    const r = await cwdRaw(actor, sid, target, sessionRow(sid).rev, key('w'));
    if (!first) first = `${r.status} ${r.code ?? ''}`.trim();
    if (r.status === 202) return { first, attempts, admittedAfterMs: Date.now() - t0, op: await waitOp(sid, r.opId) };
    if (r.code !== 'session_context_busy') return { first, attempts, refused: `${r.status} ${r.code}` };
    await sleep(500);
  }
  return { first, attempts, admittedAfterMs: null };
}
const runtimeRows = (sid) => sql(`SELECT GROUP_CONCAT(session_state) FROM qwen_runtime_session WHERE tenant_id=${q(T)} AND harness_session_id=${q(sid)}`);

// ---------- K: capability vs admission on the real stack ----------
async function stateK() {
  // K2: right after a completed Turn (the Runtime session may still be retained).
  {
    const S = await createBound('W1', 'K2-after-turn');
    const w = await submit('pub', 'cr', S, `RIG_TEXT_k2${RUN}`);
    const done = await waitTurn(w.turnId);
    const capNow = await caps('cr', S);
    const rt = runtimeRows(S);
    const res = await changeWhenAdmitted('cr', S, 'A');
    cell('K2|cwd right after a completed Turn', { turn: done.turn, capAtTurnEnd: capNow.get.cwdChange, runtimeAtTurnEnd: rt, ...res, runtimeAfter: runtimeRows(S) });
  }
  // K1: idle bound Session after a warm-up Turn, every actor.
  const S1 = await createBound('W1', 'K1-idle');
  const w1 = await submit('pub', 'cr', S1, `RIG_TEXT_k1${RUN}`);
  cell('K1|warmup', { ...short(w1), ...(await waitTurn(w1.turnId)) });
  await changeWhenAdmitted('cr', S1, 'docs');
  for (const X of ['rd', 'nn', 'op2', 'ow2', 'cr']) await mirror('K1|idle', X, S1);
  // K3: busy — a running Turn, then a requested approval.
  {
    const S = await createBound('W2', 'K3-busy');
    const m = `RIG_HOLD_k3${RUN}`;
    const h = await submit('pub', 'cr', S, m);
    await waitHeld(m);
    await mirror('K3|running Turn', 'cr', S);
    await mirror('K3|running Turn', 'op2', S);
    await cancel('pub', 'cr', S, h.turnId); await waitTurn(h.turnId, 30000); release(m); await waitIdle(S);
    const a = await submit('pub', 'cr', S, `RIG_WRITE_k3${RUN}`);
    const act = await pendingAction(S);
    cell('K3|approval raised', { action: !!act });
    await mirror('K3|pending approval', 'cr', S);
    if (act) { await respond('pub', 'cr', S, act); await waitTurn(a.turnId, 60000); }
  }
  // K4–K7: creator-keyed execution facts on W3.
  {
    const S = await createBound('W3', 'K4-facts');
    const w = await submit('pub', 'cr', S, `RIG_TEXT_k4${RUN}`);
    await waitTurn(w.turnId);
    await changeWhenAdmitted('cr', S, 'docs');
    setRole('cr', 'READER', 'W3');
    for (const X of ['cr', 'op2', 'ow2']) await mirror('K4|creator demoted to READER', X, S);
    setRole('cr', 'OPERATOR', 'W3');
    for (const [label, clause] of [['K5|registry DRAINING', "state='DRAINING'"], ['K6|registry generation 2', 'workspace_generation=2'], ['K7|registry storage changed', "storage_id='st-other'"]]) {
      setRegistry('W3', clause);
      for (const X of ['op2', 'ow2']) await mirror(label, X, S);
      restoreRegistry('W3');
    }
    await mirror('K4|restored', 'op2', S);
  }
  // K8: closed Session. K11: deleted Session.
  {
    const S = await createBound('W4', 'K8-closed');
    const c = await lifecycle('web', 'cr', S, 'close');
    for (let i = 0; i < 40 && sessionRow(S)?.status === 'ACTIVE'; i++) await sleep(250);
    cell('K8|close', { ...short(c), status: sessionRow(S)?.status });
    await mirror('K8|closed', 'cr', S);
    const D = await createBound('W4', 'K11-deleted');
    const d = await lifecycle('web', 'cr', D, 'delete');
    await sleep(800);
    cell('K11|delete', { ...short(d), status: sessionRow(D)?.status });
    await mirror('K11|deleted', 'cr', D);
  }
  // K9: Turn-profile restrictions do not apply to cwd (workspaceTurns=false, cwdChange=true).
  for (const [label, clause] of [['K9|agent_id custom', "agent_id='custom'"], ['K9b|context_config_ref other', "context_config_ref='other-config/1'"]]) {
    const S = await createBound('W4', label.slice(0, 3));
    sql(`UPDATE managed_agent_session SET ${clause} WHERE session_id=${q(S)}`);
    const v = await mirror(label, 'cr', S, 'B');
    const t = await submit('web', 'cr', S, `RIG_TEXT_k9${RUN}`);
    v.laterTurnSubmit = `${t.status} ${t.code ?? ''}`.trim();
    if (t.status === 202) v.laterTurn = await waitTurn(t.turnId, 60000);
    cell(`${label}|then a Turn`, v);
  }
  // K10: an installed storage-migration fence (W1c) — admission refuses; does the capability?
  {
    const S = await createBound('W2', 'K10-fence');
    const fk = (v) => { const b = Buffer.from(v, 'utf8'); const l = Buffer.alloc(4); l.writeInt32BE(b.length); return createHash('sha256').update(Buffer.concat([l, b])).digest('hex'); };
    sql(`INSERT INTO qwen_runtime_storage_fence (tenant_key, storage_key, tenant_id, storage_id, operation_id) VALUES ('${fk(T)}', '${fk('st2')}', ${q(T)}, 'st2', '${randomUUID()}')`);
    const v = await mirror('K10|storage fence installed', 'cr', S);
    const t = await submit('web', 'cr', S, `RIG_TEXT_k10${RUN}`);
    v.turnSubmit = `${t.status} ${t.code ?? ''}`.trim();
    cell('K10|fence, Turn submit for comparison', v);
    if (t.status === 202) await waitTurn(t.turnId, 60000);
    sql(`DELETE FROM qwen_runtime_storage_fence WHERE storage_id='st2' AND tenant_id=${q(T)}`);
  }
  // K12: a Session without a Workspace binding.
  {
    const r = await api('cr', 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', metadata: { title: `K12-unbound-${RUN}` } }, key('create'));
    const S = r.json?.id;
    const c = await caps('cr', S);
    const a = await cwdRaw('cr', S, 'B', 1, key('k12'));
    cell('K12|unbound Session', { create: r.status, cap: c.get.cwdChange, workspace: c.get.cwd ?? null, admit: `${a.status} ${a.code ?? ''}`.trim() });
  }
}

// ---------- S: closed/deleted seeded via SQL (bound close needs a durable Linux runtime) ----------
async function stateS() {
  const S = await createBound('W4', 'S-closed');
  sql(`UPDATE managed_agent_session SET status='CLOSED' WHERE session_id=${q(S)}`);
  await mirror('S|closed (SQL-seeded)', 'cr', S);
  const D = await createBound('W4', 'S-deleted');
  sql(`UPDATE managed_agent_session SET status='DELETED', deleted_at=${Date.now()} WHERE session_id=${q(D)}`);
  await mirror('S|deleted (SQL-seeded)', 'cr', D);
  const A = await createBound('W4', 'S-archived');
  sql(`UPDATE managed_agent_session SET status='ARCHIVED' WHERE session_id=${q(A)}`);
  await mirror('S|archived (SQL-seeded)', 'cr', A);
}

// ---------- N: the next Turn runs in the changed directory ----------
async function stateN() {
  const S = await createBound('W1', 'N-next-turn');
  const st = 'st1';
  const steps = [];
  for (const target of ['B', '目录', 'dir with spaces', 'B/inner', '.']) {
    const ch = await changeWhenAdmitted('cr', S, target);
    const m = `RIG_WRITE_n${steps.length}${RUN}`;
    const t = await submit('web', 'cr', S, `please ${m}`);
    const fin = t.status === 202 ? await approveAll(S, t.turnId) : { turn: `submit ${t.status} ${t.code}` };
    const expected = target === '.' ? `${mount(st)}/${m}.txt` : `${mount(st)}/${target}/${m}.txt`;
    const inRoot = target !== '.' && fs.existsSync(`${mount(st)}/${m}.txt`);
    const step = { target, change: ch.op?.state ?? ch, row: sessionRow(S), turn: fin.turn, fileInTarget: fs.existsSync(expected), fileInRoot: inRoot };
    steps.push(step);
    cell(`N|${target}`, step);
  }
  const ev = await api('cr', 'GET', `/v1/agents/sessions/${S}/events?limit=1000`);
  const types = (ev.json?.data ?? []).map((e) => e.type);
  cell('N|events', { contextChanged: types.filter((x) => /context\.changed/.test(x)).length, total: types.length });
  // Replays and lexical refusals.
  const r0 = sessionRow(S).rev;
  const k = key('n-replay');
  const first = await cwdRaw('op2', S, 'A', r0, k);
  const settled = first.opId ? await waitOp(S, first.opId) : null;
  const same = await cwdRaw('op2', S, 'A', r0, k);
  const other = await cwdRaw('op2', S, 'B', r0, k);
  setRole('op2', 'READER', 'W1');
  const afterDemote = await cwdRaw('op2', S, 'A', r0, k);
  const newKey = await cwdRaw('op2', S, 'B', sessionRow(S).rev, key('n-new'));
  setRole('op2', 'OPERATOR', 'W1');
  cell('N|replay', { first: { ...first, settled }, sameKeySameBody: same, sameKeyOtherBody: other, sameKeyAfterDemotion: afterDemote, newKeyAfterDemotion: newKey });
  for (const [label, target] of [['same directory', sessionRow(S).cwd], ['same directory trailing slash', `${sessionRow(S).cwd}/`], ['parent escape', '../x'], ['absolute', '/etc'], ['empty', ''], ['missing directory', 'missing/x'], ['regular file', 'afile.txt']]) {
    if (label === 'regular file') fs.writeFileSync(`${mount(st)}/afile.txt`, 'x');
    const before = sessionRow(S);
    const r = await cwdRaw('cr', S, target, before.rev, key('n-lex'));
    const v = { target, admit: `${r.status} ${r.code ?? ''}`.trim() };
    if (r.status === 202 && r.opId) { const op = await waitOp(S, r.opId); v.op = op.state + (op.failure ? `/${op.failure}` : ''); }
    v.row = sessionRow(S);
    cell(`N|${label}`, v);
  }
  const t = await submit('web', 'cr', S, `please RIG_TEXT_nafter${RUN}`);
  cell('N|Turn after the refusals', t.status === 202 ? await waitTurn(t.turnId) : short(t));
}

// ---------- budget: statements per WebShell list call on real MySQL ----------
async function budget() {
  sql("UPDATE performance_schema.setup_consumers SET ENABLED='YES' WHERE NAME IN ('events_statements_history_long','events_statements_history')", '');
  const variants = [
    { label: 'submit-shaped', clause: null },
    { label: 'cwd-only (agent_id custom)', clause: "agent_id='custom'" },
  ];
  for (const v of variants) for (const n of [1, 20]) {
    const tenant = `bud-${v.clause ? 'c' : 's'}${n}-${RUN}`;
    setupTopology(tenant);
    for (let i = 0; i < n; i++) {
      const r = await fetch(`http://127.0.0.1:${springPort}/v1/agents/sessions`, { method: 'POST', headers: { 'x-qwen-tenant-id': tenant, [ACTOR_HEADER]: 'cr', 'content-type': 'application/json', 'idempotency-key': key('bud') }, body: JSON.stringify({ agent_id: 'qwen-code', workspace: { workspace_id: 'W1' }, metadata: { title: `bud-${i}` } }) });
      if (r.status !== 202) throw new Error(`budget create ${r.status} ${await r.text()}`);
    }
    if (v.clause) sql(`UPDATE managed_agent_session SET ${v.clause} WHERE tenant_id=${q(tenant)}`);
    await sleep(3000);
    for (const actor of ['cr', 'rd']) {
      const samples = [];
      for (let rep = 0; rep < 4; rep++) {
        sql('TRUNCATE TABLE performance_schema.events_statements_history_long', '');
        const r = await fetch(`http://127.0.0.1:${springPort}${WEB}/sessions/query`, { method: 'POST', headers: { 'x-qwen-tenant-id': tenant, [ACTOR_HEADER]: actor, 'content-type': 'application/json' }, body: JSON.stringify({ limit: 20 }) });
        const body = await r.json();
        await sleep(400);
        const list = rows(sql(`SELECT THREAD_ID, REPLACE(REPLACE(LEFT(SQL_TEXT, 160), '\\n', ' '), '\\t', ' ') FROM performance_schema.events_statements_history_long WHERE SQL_TEXT LIKE ${q(`%${tenant}%`)} ORDER BY TIMER_START`, ''));
        const threads = [...new Set(list.map((x) => x[0]))];
        const all = threads.length ? Number(sql(`SELECT COUNT(*) FROM performance_schema.events_statements_history_long WHERE THREAD_ID IN (${threads.join(',')}) AND SQL_TEXT IS NOT NULL AND SQL_TEXT NOT LIKE 'SET %' AND SQL_TEXT NOT LIKE 'SHOW %' AND SQL_TEXT NOT LIKE '/* ping */%' AND SQL_TEXT NOT IN ('commit','rollback','COMMIT','ROLLBACK')`, '')) : 0;
        samples.push({ http: r.status, rows: (body.data ?? body.sessions ?? []).length, cwdTrue: (body.data ?? []).filter((x) => x.capabilities?.cwdChange === true).length, turnsTrue: (body.data ?? []).filter((x) => x.capabilities?.workspaceTurns === true).length, tenantStatements: list.length, threadStatements: all, factsReads: list.filter((x) => /^SELECT s\.session_id FROM managed_agent_session s JOIN managed_workspace_registry/i.test(x[1])).length, texts: list.map((x) => x[1].slice(0, 90)) });
      }
      const counts = samples.map((s) => s.tenantStatements);
      cell(`BUDGET|${v.label}|n=${n}|${actor}`, { rows: samples[0].rows, cwdTrue: samples[0].cwdTrue, turnsTrue: samples[0].turnsTrue, tenantStatements: counts, threadStatements: samples.map((s) => s.threadStatements), factsReads: samples.map((s) => s.factsReads), texts: samples.map((s) => s.texts) });
    }
  }
}

// ---------- serve: a long-lived stack for the Web Shell UI probe ----------
// A control port lets the UI probe park a cwd settlement (RELAY=1): /hold?sid= parks the
// settlement's "SELECT lease_until ... FOR UPDATE" for that Session until /release.
async function serve() {
  const sessions = {};
  for (const [name, ws] of [['change', 'W1'], ['lostack', 'W2'], ['stale', 'W3'], ['fail', 'W4'], ['recover', 'W2'], ['busy', 'W4'], ['zh', 'W3']]) {
    const sid = await createBound(ws, `UI-${name}`);
    const w = await submit('pub', 'cr', sid, `RIG_TEXT_ui${name}${RUN}`);
    await waitTurn(w.turnId);
    sessions[name] = { sid, ws, st: STORAGES[ws] };
  }
  let releaseHold = null;
  const control = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/hold') {
      relay.hold = { needles: ['lease_until', 'managed_agent_operation', u.searchParams.get('sid'), 'FOR UPDATE'], fired: false, onHold: () => new Promise((r) => { releaseHold = r; }) };
      res.end('{"ok":true}');
    } else if (u.pathname === '/release') {
      const had = !!releaseHold;
      releaseHold?.(); releaseHold = null; relay.hold = null;
      res.end(JSON.stringify({ released: had }));
    } else if (u.pathname === '/status') {
      res.end(JSON.stringify({ fired: relay.hold?.fired ?? null, parked: !!releaseHold, heldLog: relay.heldLog.slice(-3) }));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => control.listen(0, '127.0.0.1', r));
  const info = { springPort, controlPort: control.address().port, sessions, db, run: RUN, mountRoot: `${stable}/mounts` };
  fs.writeFileSync(`${RIG}/state/serve-${arm}.json`, JSON.stringify(info, null, 2));
  log('SERVING', JSON.stringify(info));
  await new Promise((resolve) => { process.on('SIGTERM', resolve); });
  control.close();
}

async function bootStack() {
  springPort = await freePort(); harnessPort = await freePort(); brokerPort = await freePort();
  fake = await startModel();
  if (process.env.RELAY) await startRelay();
  await startSpring();
  await startHarness();
}
const shutdown = async () => {
  for (const h of model.held) try { h.res.destroy(); } catch {}
  for (const c of [...children].reverse()) await stop(c);
  fake?.server.close();
  relay.server?.close();
};
process.on('SIGINT', async () => { await shutdown(); process.exit(130); });
if (phase === 'serve') process.removeAllListeners('SIGTERM');
try {
  sql(`CREATE DATABASE IF NOT EXISTS ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`, '');
  await bootStack();
  setupTopology();
  results.schema = { flyway: rows(sql('SELECT version, description FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 2')) };
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (s) => !only || only.includes(s);
  if (phase === 'matrix') {
    if (want('K')) await stateK();
    if (want('N')) await stateN();
    if (want('S')) await stateS();
  } else if (phase === 'budget') {
    await budget();
  } else if (phase === 'serve') {
    await serve();
  } else throw new Error(`unknown phase ${phase}`);
  results.model = { turnRequests: model.turnRequests, aux: model.aux, byMarker: model.byMarker };
  results.ok = true;
  log('DONE', phase, Math.round((Date.now() - T0) / 1000), 's');
} catch (e) {
  results.error = String(e.stack ?? e);
  log('FAILED', String(e.stack ?? e));
  process.exitCode = 1;
} finally {
  save();
  await shutdown();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref?.();
  process.exit(process.exitCode ?? 0);
}
