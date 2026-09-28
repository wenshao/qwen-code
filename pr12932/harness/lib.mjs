// Verification rig for PR #12932 (public Turn list and detail, Stage D5).
// Real MySQL 8.4 / MariaDB 10.11.18 (Docker) + the Spring server jar with its
// Hosted Harness connector enabled + the packaged Hosted Harness (dist/cli.js)
// + a fault-injecting proxy on the Java -> Harness and Harness -> Store links.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RIG = path.dirname(new URL(import.meta.url).pathname);
export const SP = path.dirname(RIG);
export const RUN = path.join(RIG, 'run');
export const OUT = path.join(RIG, 'out');
export const TOKEN = 'rig-harness-token-12932';
export const DIGEST = `sha256:${'a'.repeat(64)}`;
export const TENANT = 't-rig';
export const CLI = path.join(SP, process.env.CLI_TREE ?? 'wt-pr', 'dist', 'cli.js');
export const JAVA = `${process.env.HOME}/Install/jdk21/bin/java`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(RUN, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

export const DBS = {
  mysql: { port: 33294, password: 'v12932', container: 'v12932-mysql84' },
  mariadb: { port: 33296, password: 'v12932', container: 'v12932-mariadb' },
};

let logFile = null;
const t0 = Date.now();
export function openLog(name) {
  logFile = path.join(OUT, `${name}.log`);
  fs.writeFileSync(logFile, '');
}
export function say(tag, text) {
  const line = `[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] [${tag}] ${typeof text === 'string' ? text : JSON.stringify(text)}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}

export function sql(engine, db, query) {
  const d = DBS[engine];
  const out = execFileSync(
    'docker',
    ['exec', '-i', d.container, engine === 'mysql' ? 'mysql' : 'mariadb', '-uroot', `-p${d.password}`, '-N', '-B', ...(db ? [db] : []), '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}

export function freshDb(engine, db) {
  sql(engine, null, `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
}

const children = [];
function track(name, child, logPath) {
  children.push({ name, child });
  fs.writeFileSync(path.join(RUN, `${name}.pid`), String(child.pid));
  return child;
}
export function stopAll() {
  for (const { child } of children) {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {}
  }
}
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));

async function waitFor(fn, seconds, what) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {}
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(200);
  }
}
export { waitFor };

export async function startModel(port) {
  const log = path.join(RUN, `model-${port}.log`);
  const child = spawn(process.execPath, [path.join(RIG, 'model.mjs'), String(port), log], { stdio: 'ignore' });
  track(`model-${port}`, child);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' })).ok, 10, 'model');
  return child;
}

export async function startProxy(name, listen, target, control) {
  const ledger = path.join(RUN, `ledger-${name}.jsonl`);
  fs.writeFileSync(ledger, '');
  const child = spawn(process.execPath, [path.join(RIG, 'proxy.mjs'), String(listen), String(target), String(control), ledger], { stdio: 'ignore' });
  track(`proxy-${name}`, child);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${control}/clear`)).ok, 10, 'proxy');
  return {
    ledger,
    async rule(method, pathRe, action) {
      const q = new URLSearchParams({ ...(method ? { method } : {}), path: pathRe, action });
      await fetch(`http://127.0.0.1:${control}/rule?${q}`);
    },
    async clear() {
      await fetch(`http://127.0.0.1:${control}/clear`);
    },
    entries() {
      return fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
  };
}

export async function startHarness(name, port, modelPort) {
  const root = path.join(RUN, `harness-${name}`);
  fs.rmSync(root, { recursive: true, force: true });
  const home = path.join(root, 'home');
  const qwen = path.join(home, '.qwen');
  const ws = path.join(root, 'workspace');
  fs.mkdirSync(qwen, { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  const modelUrl = `http://127.0.0.1:${modelPort}/v1`;
  fs.writeFileSync(
    path.join(qwen, 'settings.json'),
    JSON.stringify({
      security: { auth: { selectedType: 'openai' } },
      model: { name: 'rig-model' },
      telemetry: { enabled: false },
      modelProviders: { openai: [{ id: 'rig-model', envKey: 'OPENAI_API_KEY', baseUrl: modelUrl }] },
    }),
  );
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    QWEN_HOME: qwen,
    QWEN_RUNTIME_DIR: path.join(root, 'runtime'),
    OPENAI_API_KEY: 'fake-local-key',
    OPENAI_BASE_URL: modelUrl,
    OPENAI_MODEL: 'rig-model',
    QWEN_MODEL: 'rig-model',
    QWEN_SERVER_TOKEN: TOKEN,
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: DIGEST,
    TMPDIR: root,
    QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(root, 'system-settings.json'),
    QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(root, 'system-defaults.json'),
    QWEN_CODE_TRUSTED_FOLDERS_PATH: path.join(root, 'trusted-folders.json'),
  };
  const logPath = path.join(RUN, `harness-${name}.log`);
  const out = fs.openSync(logPath, 'w');
  const child = spawn(
    process.execPath,
    [CLI, 'serve', '--profile', 'hosted-harness', '--http-bridge', '--port', String(port), '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', ws],
    { cwd: ws, env, stdio: ['ignore', out, out] },
  );
  track(`harness-${name}`, child);
  await waitFor(() => /listening on http:\/\/127\.0\.0\.1:/.test(fs.readFileSync(logPath, 'utf8')), 60, `harness ${name}`);
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${port}/capabilities`, { headers: { authorization: `Bearer ${TOKEN}` } })).status < 500,
    30,
    `harness ${name} ready`,
  );
  return { child, logPath };
}

export async function startSpring(name, { jar, engine, db, port, harnessPort, storePort, extra = [], harness = true }) {
  const d = DBS[engine];
  const jdbc = `jdbc:mysql://127.0.0.1:${d.port}/${db}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false`;
  const args = [
    ...(process.env.JVM_OPTS ?? "").split(" ").filter(Boolean),
    `-Dloader.path=${path.join(RIG, 'adapter', 'adapter.jar')}`,
    '-Duser.timezone=UTC', '-cp',
    jar,
    'org.springframework.boot.loader.launch.PropertiesLauncher',
    '--server.address=127.0.0.1',
    `--server.port=${port}`,
    `--spring.datasource.url=${jdbc}`,
    '--spring.datasource.username=root',
    `--spring.datasource.password=${d.password}`,
    '--spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver',
    '--qwen.managed-agent.session-store.enabled=true',
    `--qwen.managed-agent.session-store.base-url=http://127.0.0.1:${storePort}`,
    '--qwen.managed-agent.session-store.workspace-id=rig-ws',
    `--qwen.managed-agent.harness.enabled=${harness}`,
    `--qwen.managed-agent.harness.base-url=http://127.0.0.1:${harnessPort}`,
    `--qwen.managed-agent.harness.token=${TOKEN}`,
    `--qwen.managed-agent.harness.capability-digest=${DIGEST}`,
    ...(extra.some((e) => e.startsWith('--qwen.managed-agent.runtime-broker.enabled=')) ? [] : ['--qwen.managed-agent.runtime-broker.enabled=false']),
    ...extra,
  ];
  const logPath = path.join(RUN, `spring-${name}.log`);
  const out = fs.openSync(logPath, 'w');
  const child = spawn(JAVA, args, { stdio: ['ignore', out, out] });
  track(`spring-${name}`, child);
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${port}/v1/agents/sessions?limit=1`, { headers: { 'X-Qwen-Tenant-Id': TENANT } })).status === 200,
    120,
    `spring ${name}`,
  );
  return { child, logPath };
}

export function killPid(child) {
  try {
    process.kill(child.pid, 'SIGKILL');
  } catch {}
}

export async function api(port, method, url, { actor, idem, body, tenant = TENANT } = {}) {
  const headers = { 'X-Qwen-Tenant-Id': tenant, accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (actor) headers['X-Rig-Actor'] = actor;
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json, headers: Object.fromEntries(r.headers) };
}

export const short = (r) => {
  const j = r.json;
  if (j && typeof j === 'object') {
    if (j.error) return `${r.status} ${j.error.code ?? JSON.stringify(j.error)}`;
    if (j.type && j.status) return `${r.status} ${j.type}/${j.status} stage=${j.admission_stage} delivery=${j.delivery_state} replayed=${j.replayed}${j.receipt_id ? ' receipt=' + j.receipt_id.slice(0, 12) + '…' : ''}`;
    if (j.status) return `${r.status} status=${j.status}`;
  }
  return `${r.status} ${JSON.stringify(j).slice(0, 160)}`;
};

export async function createSession(port, { actor, input } = {}) {
  const r = await api(port, 'POST', '/v1/agents/sessions', {
    actor,
    idem: randomUUID(),
    body: { agent_id: 'qwen-code', ...(input ? { input: [{ type: 'input_text', text: input }] } : {}) },
  });
  if (r.status >= 300) throw new Error(`create: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.id;
}

export async function events(port, id, actor) {
  const r = await api(port, 'GET', `/v1/agents/sessions/${id}/events?limit=100`, { actor });
  return r.status === 200 ? r.json.data : [];
}

export async function awaitTurn(port, id, actor, count = 1, seconds = 60) {
  await waitFor(async () => (await events(port, id, actor)).filter((e) => e.type === 'turn.completed').length >= count, seconds, 'turn.completed');
}

export async function awaitOperation(port, id, op, actor, seconds = 60) {
  let last;
  await waitFor(async () => {
    last = await api(port, 'GET', `/v1/agents/sessions/${id}/operations/${op}`, { actor });
    return last.json?.status === 'completed';
  }, seconds, `operation ${op}`);
  return last;
}

export function writer(engine, db, id) {
  const rows = sql(engine, db, `SELECT state, DATE_FORMAT(writer_lease_until,'%H:%i:%s') FROM qwen_managed_session_journal_head WHERE tenant_id='${TENANT}' AND session_id='${id}'`);
  return rows[0] ? `${rows[0][0]} lease_until=${rows[0][1]}` : '<no journal head>';
}

export function opRow(engine, db, op) {
  const rows = sql(engine, db, `SELECT state, delivery_state, admission_stage, attempt_count, claim_generation, IFNULL(lease_owner,'-') FROM managed_agent_operation WHERE operation_id='${op}'`);
  if (!rows[0]) return '<none>';
  const [state, delivery, stage, attempts, gen, owner] = rows[0];
  return `state=${state} delivery=${delivery} stage=${stage} attempts=${attempts} claim_generation=${gen} lease_owner=${owner.slice(0, 8)}`;
}

export function sessionRow(engine, db, id) {
  const rows = sql(engine, db, `SELECT status, IFNULL(harness_boot_id,'-') FROM managed_agent_session WHERE session_id='${id}'`);
  return rows[0] ? `status=${rows[0][0]} boot=${rows[0][1].slice(0, 8)}` : '<none>';
}
