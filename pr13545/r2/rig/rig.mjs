// PR #13545 real-stack rig: one arm's Spring fat jar + the packaged Hosted Harness
// (dist/cli.js serve --profile hosted-harness) + a scripted OpenAI-compatible model,
// against a private MySQL 8.4.7 (127.0.0.1:23545). Every request goes through real
// HTTP with the trusted actor header; every decision is read back from the DB.
// Usage: node rig.mjs <matrix|facts> <arm> <db>
//   matrix: states A (normal), O (owner != creator), L (close/delete), B (creator demoted),
//           C (registry DRAINING), D (cwd initiator demoted after admission)
//   facts:  state B only (for mutant jars)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';

const [phase, arm, dbName] = process.argv.slice(2);
const RIG = '/Users/wenshao/pr13545-rig';
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const JAVA = `${process.env.HOME}/Install/jdk21/bin/java`;
const DBPORT = 23545;
// The PR changes no Harness/CLI code: base/head use base's bundle; main/merge use the
// trial merge's bundle (== main's CLI, which #13550 moved).
const cliBundle = `${RIG}/src-${process.env.CLI_ARM ?? (['main', 'merge'].includes(arm) ? 'merge' : 'base')}/dist/cli.js`;
const springJar = `${RIG}/server/${arm}-server.jar`;
const db = `r45_${dbName}`;
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
for (const st of Object.values(STORAGES)) for (let i = 0; i < 80; i++) fs.mkdirSync(`${mount(st)}/d${String(i).padStart(2, '0')}`, { recursive: true });
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
function setupTopology() {
  for (const [w, st] of Object.entries(STORAGES)) {
    sql(`INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(T)}, '${w}', 1, '${st}', 'Rig ${w}', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE') ON DUPLICATE KEY UPDATE state='ACTIVE'`);
    for (const [a, role] of Object.entries(ROLES)) {
      sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES (${q(T)}, '${w}', '${a}', '${role}') ON DUPLICATE KEY UPDATE role='${role}'`);
    }
    sql(`DELETE FROM managed_workspace_access WHERE tenant_id=${q(T)} AND workspace_id='${w}' AND actor_id='nn'`);
  }
}
const setRole = (actor, role, ws = null) => sql(`UPDATE managed_workspace_access SET role='${role}' WHERE tenant_id=${q(T)} AND actor_id='${actor}'${ws ? ` AND workspace_id='${ws}'` : ''}`);
let dirSeq = 0;
const nextDir = () => `d${String(dirSeq++ % 80).padStart(2, '0')}`;

async function capabilities(actor, sid) {
  const g = await api(actor, 'POST', `${WEB}/sessions/get`, { sessionId: sid });
  const caps = g.json?.capabilities ?? g.json?.session?.capabilities ?? null;
  const qy = await api(actor, 'POST', `${WEB}/sessions/query`, { limit: 100 });
  const item = (qy.json?.data ?? qy.json?.sessions ?? []).find((s) => (s.sessionId ?? s.id) === sid);
  const pg = await api(actor, 'GET', `/v1/agents/sessions/${sid}`);
  return {
    get: g.status === 200 ? { workspaceTurns: caps?.workspaceTurns, actions: caps?.actions, sessionClose: caps?.sessionClose, sessionArchive: caps?.sessionArchive, sessionDelete: caps?.sessionDelete } : { status: g.status, code: g.code },
    query: item ? { workspaceTurns: item.capabilities?.workspaceTurns } : { listed: false, status: qy.status },
    pub: pg.status === 200 ? { session_close: pg.json?.capabilities?.session_close, session_archive: pg.json?.capabilities?.session_archive, session_delete: pg.json?.capabilities?.session_delete } : { status: pg.status, code: pg.code },
  };
}

// ---------- state A: every OPERATOR family and the capability, per actor and surface ----------
async function stateA() {
  const SA = await createBound('W1', 'A-submit');
  const SR = await createBound('W2', 'A-respond');
  results.sessions = { SA, SR };
  const warm = await submit('pub', 'cr', SA, `RIG_TEXT_warm${RUN}`);
  cell('A|warmup|pub|cr', { ...short(warm), ...(await waitTurn(warm.turnId)) });
  for (const X of ACTORS) cell(`A|cap|${X}`, await capabilities(X, SA));
  for (const S of ['pub', 'web']) for (const X of ACTORS) {
    await waitIdle(SA);
    const c0 = counters();
    const r = await submit(S, X, SA, `RIG_TEXT_${S}${X}${RUN}`);
    const v = { ...short(r) };
    if (r.status === 202) Object.assign(v, await waitTurn(r.turnId));
    v.delta = delta(c0, counters());
    cell(`A|submit|${S}|${X}`, v);
  }
  for (const S of ['pub', 'web']) for (const X of ACTORS) {
    await waitIdle(SA);
    const m = `RIG_HOLD_${S}${X}${RUN}`;
    const h = await submit('pub', 'cr', SA, m);
    const held = h.status === 202 && (await waitHeld(m));
    const r = await cancel(S, X, SA, h.turnId);
    const v = { held, ...short(r) };
    if (r.status === 202) Object.assign(v, await waitTurn(h.turnId, 30000));
    else {
      const c = await cancel('pub', 'cr', SA, h.turnId);
      v.cleanup = { ...short(c), ...(await waitTurn(h.turnId, 30000)) };
    }
    release(m);
    cell(`A|cancel|${S}|${X}`, v);
  }
  for (const X of ACTORS) {
    await waitIdle(SA);
    const r = await api(X, 'PATCH', `/v1/agents/sessions/${SA}`, { title: `renamed by ${X} ${RUN}` }, key('rename'));
    cell(`A|rename|pub|${X}`, { ...short(r), title: r.json?.metadata?.title ?? null });
  }
  for (const S of ['pub', 'web']) for (const X of ACTORS) {
    await waitIdle(SA);
    const target = nextDir();
    const r = await cwdChange(S, X, SA, target);
    const v = { ...short(r) };
    if (r.status === 202 && r.opId) Object.assign(v, await waitOp(SA, r.opId));
    v.cwdNow = sql(`SELECT cwd_relative FROM managed_agent_session WHERE session_id=${q(SA)}`);
    v.moved = v.cwdNow === target;
    cell(`A|cwd|${S}|${X}`, v);
  }
  // Approval respond: cr raises the approval, X answers it.
  for (const S of ['pub', 'web']) for (const X of [...ACTORS, 'anon']) {
    await waitIdle(SR);
    const m = `RIG_WRITE_${S}${X}${RUN}`;
    const t = await submit('pub', 'cr', SR, m);
    const action = t.status === 202 ? await pendingAction(SR) : null;
    if (!action) { cell(`A|respond|${S}|${X}`, { error: 'no pending action', submit: short(t), turn: t.turnId ? turnRow(t.turnId) : null }); continue; }
    const r = await respond(S, X === 'anon' ? null : X, SR, action);
    const v = { ...short(r) };
    const opId = r.json?.id ?? r.json?.operationId;
    if (r.status === 202 && opId) Object.assign(v, { op: await waitOp(SR, opId) });
    else {
      const c = await respond('pub', 'cr', SR, action);
      v.cleanup = short(c);
    }
    Object.assign(v, await waitTurn(t.turnId, 60000));
    v.fileWritten = fs.existsSync(`${mount('st2')}/${m}.txt`);
    cell(`A|respond|${S}|${X}`, v);
  }
}

// ---------- state O: owner_actor_key differs from the creator (set out of band) ----------
async function stateO() {
  for (const S of ['pub', 'web']) for (const X of ['cr', 'ow2', 'op2']) {
    const sid = await createBound('W1', `O-${S}-${X}`);
    sql(`UPDATE managed_agent_session SET owner_actor_key=CAST('ow2' AS BINARY) WHERE session_id=${q(sid)}`);
    const caps = await capabilities(X, sid);
    const a = await lifecycle(S, X, sid, 'archive');
    await sleep(300);
    const st = sql(`SELECT status FROM managed_agent_session WHERE session_id=${q(sid)}`);
    cell(`O|archive|${S}|${X}`, { ...short(a), sessionStatus: st, capArchive: caps.get.sessionArchive });
  }
}
// ---------- state L: close and delete (owner == creator) ----------
async function stateL() {
  for (const verb of ['close', 'delete']) for (const S of ['pub', 'web']) for (const X of ACTORS) {
    const sid = await createBound('W1', `L-${verb}-${S}-${X}`);
    const r = await lifecycle(S, X, sid, verb);
    await sleep(200);
    const row = rows(sql(`SELECT status, IF(deleted_at IS NULL,'','deleted') FROM managed_agent_session WHERE session_id=${q(sid)}`))[0];
    cell(`L|${verb}|${S}|${X}`, { ...short(r), row: row ? row.join('/') : 'gone' });
  }
}

// ---------- state B: only the creator is demoted to READER ----------
async function stateB() {
  const SB = await createBound('W1', 'B-submit');
  const SH = await createBound('W3', 'B-hold-pub');
  const SH2 = await createBound('W4', 'B-hold-web');
  const SR = await createBound('W2', 'B-respond');
  results.sessionsB = { SB, SH, SH2, SR };
  const warm = await submit('pub', 'cr', SB, `RIG_TEXT_bwarm${RUN}`);
  cell('B|warmup|pub|cr', { ...short(warm), ...(await waitTurn(warm.turnId)) });
  // Work admitted while the creator still held OPERATOR.
  const holdP = await submit('pub', 'cr', SH, `RIG_HOLD_bp${RUN}`);
  const holdW = await submit('pub', 'cr', SH2, `RIG_HOLD_bw${RUN}`);
  const approval = await submit('pub', 'cr', SR, `RIG_WRITE_b${RUN}`);
  const heldOk = (await waitHeld(`RIG_HOLD_bp${RUN}`)) && (await waitHeld(`RIG_HOLD_bw${RUN}`));
  const action = await pendingAction(SR);
  cell('B|setup', { holdP: short(holdP), holdW: short(holdW), heldOk, approval: short(approval), action: !!action });
  setRole('cr', 'READER');
  const cB = counters();
  for (const X of ['cr', 'op2', 'ow2', 'rd']) cell(`B|cap|${X}`, await capabilities(X, SB));
  for (const S of ['pub', 'web']) for (const X of ['cr', 'op2', 'ow2', 'rd']) {
    const c0 = counters();
    const r = await submit(S, X, SB, `RIG_TEXT_b${S}${X}${RUN}`);
    const v = { ...short(r) };
    if (r.status === 202) Object.assign(v, await waitTurn(r.turnId, 60000));
    v.delta = delta(c0, counters());
    cell(`B|submit|${S}|${X}`, v);
  }
  for (const X of ['cr', 'op2', 'ow2']) {
    const r = await api(X, 'PATCH', `/v1/agents/sessions/${SB}`, { title: `B renamed by ${X}` }, key('rename'));
    cell(`B|rename|pub|${X}`, short(r));
  }
  for (const S of ['pub', 'web']) for (const X of ['cr', 'op2']) {
    await waitIdle(SB);
    const r = await cwdChange(S, X, SB, nextDir());
    const v = { ...short(r) };
    if (r.status === 202 && r.opId) Object.assign(v, await waitOp(SB, r.opId));
    cell(`B|cwd|${S}|${X}`, v);
  }
  // Respond to the approval raised before the demotion: refusals first, then the
  // callers each arm admits.
  if (action) {
    for (const S of ['pub', 'web']) for (const X of ['rd', 'op2', 'ow2', 'cr']) {
      const c0 = counters();
      const r = await respond(S, X, SR, action);
      const v = { ...short(r), delta: delta(c0, counters()) };
      const opId = r.json?.id ?? r.json?.operationId;
      if (r.status === 202 && opId) v.op = await waitOp(SR, opId, 20000);
      cell(`B|respond|${S}|${X}`, v);
    }
  }
  // Cancel the Turns admitted before the demotion: the cancel exemption.
  for (const [S, sid, h] of [['pub', SH, holdP], ['web', SH2, holdW]]) {
    const r = await cancel(S, 'op2', sid, h.turnId);
    cell(`B|cancel|${S}|op2`, { ...short(r), ...(r.status === 202 ? await waitTurn(h.turnId, 30000) : { turn: turnRow(h.turnId) }) });
  }
  release(`RIG_HOLD_bp${RUN}`); release(`RIG_HOLD_bw${RUN}`);
  cell('B|totals', delta(cB, counters()));
  setRole('cr', 'OPERATOR');
  // Settle what is left so later states start idle.
  for (const [sid, h] of [[SH, holdP], [SH2, holdW]]) if (!/CANCELLED|COMPLETED|FAILED/.test(turnRow(h.turnId)?.[0] ?? '')) await cancel('pub', 'cr', sid, h.turnId);
  if (action) {
    const still = await api('cr', 'GET', `/v1/agents/sessions/${SR}/actions`);
    const a = (still.json?.data ?? []).find((x) => x.id === action.id);
    cell('B|action-after-restore', { action: a ? (a.status ?? a.state) : 'gone', turn: turnRow(approval.turnId) });
    if (a && (a.status ?? a.state) === 'requested') {
      const c = await respond('pub', 'cr', SR, action);
      const opId = c.json?.id;
      cell('B|respond-after-restore|pub|cr', { ...short(c), op: opId ? await waitOp(SR, opId, 20000) : null, ...(await waitTurn(approval.turnId, 60000)) });
    } else cell('B|approval-turn-final', await waitTurn(approval.turnId, 60000));
  }
}

// ---------- state C: registry DRAINING ----------
async function stateC() {
  const SC = await createBound('W1', 'C-drain');
  sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE tenant_id=${q(T)} AND workspace_id='W1'`);
  for (const X of ['cr', 'op2']) {
    const r = await submit('pub', X, SC, `RIG_TEXT_c${X}${RUN}`);
    cell(`C|submit|pub|${X}`, { ...short(r), cap: (await capabilities(X, SC)).get.workspaceTurns });
  }
  sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE tenant_id=${q(T)} AND workspace_id='W1'`);
}

// ---------- state D: cwd settlement after the initiator (or creator) loses OPERATOR ----------
// With RELAY=1 the settlement's own "SELECT lease_until ... FOR UPDATE" for this Session is
// parked; the demotion lands while it waits, then the settlement runs on the demoted facts.
async function stateD() {
  const plan = [['control', 'op2', null], ['initiator-demoted', 'op2', 'op2'], ['creator-demoted', 'op2', 'cr'], ['creator-self', 'cr', 'cr'], ['bystander-demoted', 'op2', 'ow2']];
  for (const [label, initiator, demote] of plan) {
    for (let i = 0; i < Number(process.env.DREPS ?? 3); i++) {
      const sid = await createBound('W1', `D-${label}-${i}`);
      const target = nextDir();
      let demotedAt = null;
      if (relay.port) {
        relay.hold = { needles: ['lease_until', 'managed_agent_operation', sid, 'FOR UPDATE'], fired: false,
          onHold: async () => { if (demote) { setRole(demote, 'READER', 'W1'); demotedAt = Date.now(); } await sleep(150); } };
      }
      const r = await cwdChange('pub', initiator, sid, target);
      const v = { ...short(r) };
      if (!relay.port && r.status === 202 && demote) { setRole(demote, 'READER', 'W1'); demotedAt = Date.now(); }
      if (r.status === 202 && r.opId) {
        Object.assign(v, await waitOp(sid, r.opId));
        const row = rows(sql(`SELECT updated_at, ${results.schema.actorKeyColumn ? "COALESCE(HEX(actor_key),'NULL')" : "'(no column)'"} FROM managed_agent_operation WHERE operation_id=${q(r.opId)}`))[0];
        v.opUpdatedAt = row?.[0]; v.actorKeyHex = row?.[1];
      }
      v.held = relay.hold?.fired ?? null; v.heldSql = relay.hold?.fired ? relay.heldLog.at(-1).sql : null; v.demotedAt = demotedAt;
      relay.hold = null;
      v.cwdNow = sql(`SELECT cwd_relative FROM managed_agent_session WHERE session_id=${q(sid)}`);
      v.moved = v.cwdNow === target;
      if (demote) setRole(demote, ROLES[demote], 'W1');
      cell(`D|${label}|${i}`, v);
    }
  }
}


// ---------- state V: an out-of-enum stored role (only reachable past V53's CHECK) ----------
async function stateV() {
  const chk = rows(sql(`SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema=${q(db)} AND table_name='managed_workspace_access' AND constraint_type='CHECK'`)).map((r) => r[0]);
  for (const c of chk) sql(`ALTER TABLE managed_workspace_access DROP CHECK ${c}`);
  results.droppedChecks = chk;
  const sid = await createBound('W1', 'V-bogus');
  const w = await submit('pub', 'cr', sid, `RIG_TEXT_vw${RUN}`);
  await waitTurn(w.turnId);
  sql(`UPDATE managed_workspace_access SET role='BOGUS' WHERE tenant_id=${q(T)} AND workspace_id='W1' AND actor_id='rd'`);
  cell('V|get|pub|rd', short(await api('rd', 'GET', `/v1/agents/sessions/${sid}`)));
  cell('V|submit|pub|rd', short(await submit('pub', 'rd', sid, `RIG_TEXT_vr${RUN}`)));
  cell('V|rename|pub|rd', short(await api('rd', 'PATCH', `/v1/agents/sessions/${sid}`, { title: 'v' }, key('rename'))));
  cell('V|cwd|pub|rd', short(await cwdChange('pub', 'rd', sid, nextDir())));
  cell('V|cap|rd', await capabilities('rd', sid));
  sql(`UPDATE managed_workspace_access SET role='READER' WHERE tenant_id=${q(T)} AND workspace_id='W1' AND actor_id='rd'`);
  // The cwd initiator's role turns out-of-enum while its settlement is parked.
  const sid2 = await createBound('W1', 'V-bogus-cwd');
  if (relay.port) relay.hold = { needles: ['lease_until', 'managed_agent_operation', sid2, 'FOR UPDATE'], fired: false, onHold: async () => { sql(`UPDATE managed_workspace_access SET role='BOGUS' WHERE tenant_id=${q(T)} AND workspace_id='W1' AND actor_id='op2'`); await sleep(150); } };
  const r = await cwdChange('pub', 'op2', sid2, nextDir());
  const v = { ...short(r), held: null };
  if (r.status === 202 && r.opId) {
    Object.assign(v, await waitOp(sid2, r.opId, 20000));
    v.attempts = sql(`SELECT attempt_count FROM managed_agent_operation WHERE operation_id=${q(r.opId)}`);
  }
  v.held = relay.hold?.fired ?? null;
  relay.hold = null;
  sql(`UPDATE managed_workspace_access SET role='OPERATOR' WHERE tenant_id=${q(T)} AND workspace_id='W1' AND actor_id='op2'`);
  const errs = fs.readFileSync(`${runDir}/spring.log`, 'utf8').split('\n').filter((l) => /No enum constant|IllegalArgumentException/.test(l)).length;
  v.springEnumErrors = errs;
  cell('V|cwd-settle|pub|op2', v);
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
  results.schema = { flyway: rows(sql('SELECT version, description FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 2')), actorKeyColumn: num(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=${q(db)} AND table_name='managed_agent_operation' AND column_name='actor_key'`) };
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (s) => !only || only.includes(s);
  if (phase === 'matrix') {
    if (want('K')) await stateK();
    if (want('V')) await stateV();
    if (want('A')) await stateA();
    if (want('O')) await stateO();
    if (want('L')) await stateL();
    if (want('B')) await stateB();
    if (want('C')) await stateC();
    if (want('D')) await stateD();
  } else if (phase === 'serve') {
    // A long-lived stack for the Web Shell UI probe: one bound Session with a pending
    // approval (raised by the creator) and one idle bound Session with a finished Turn.
    const SU = await createBound('W2', 'UI-approval');
    const SC = await createBound('W1', 'UI-composer');
    const w = await submit('pub', 'cr', SC, `RIG_TEXT_ui${RUN}`);
    await waitTurn(w.turnId);
    const a = await submit('pub', 'cr', SU, `RIG_WRITE_ui${RUN}`);
    const action = await pendingAction(SU);
    const info = { springPort, SU, SC, approvalTurn: a.turnId, action: action?.id, marker: `RIG_WRITE_ui${RUN}`, db };
    fs.writeFileSync(`${RIG}/state/serve-${arm}.json`, JSON.stringify(info, null, 2));
    log('SERVING', JSON.stringify(info));
    await new Promise((resolve) => { process.on('SIGTERM', resolve); });
  } else if (phase === 'facts') {
    await stateB();
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
