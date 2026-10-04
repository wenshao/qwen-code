// PR #13349 real-stack rig: a workspace-bound Managed Session runs Turn 1 on
// the current build (so its journal carries message.delta), both owners are
// SIGKILLed, then a replacement Spring (the jar under test) is paired with a
// replacement Hosted Harness behind a recording proxy.
//
// env:
//   LABEL            run label (output dir name)
//   JAR_FIRST        Spring jar for the first owner
//   JAR_SECOND       Spring jar for the replacement owner (arm under test)
//   CURRENT_CLI      dist/cli.js of the current build
//   LEGACY_CLI       cli.js of the released 0.24.7 package
//   SCENARIO         exhaust | rollforward | storeoutage
//   ROLLFORWARD_AFTER  refusals to observe before rolling forward (default 2)
//   OUT              output root
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { startFakeOpenAIServer } from '/Users/wenshao/git/pr13349-head/integration-tests/fake-openai-server.js';

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`missing ${name}`);
  return value;
};
const label = env('LABEL');
const jarFirst = env('JAR_FIRST');
const jarSecond = env('JAR_SECOND');
const currentCli = env('CURRENT_CLI');
const legacyCli = env('LEGACY_CLI');
const scenario = env('SCENARIO');
const rollforwardAfter = Number(env('ROLLFORWARD_AFTER', '2'));
const outRoot = env('OUT');
if (!['exhaust', 'rollforward', 'storeoutage', 'inflight', 'control'].includes(scenario))
  throw new Error(`bad SCENARIO ${scenario}`);
for (const f of [jarFirst, jarSecond, currentCli, legacyCli])
  if (!existsSync(f)) throw new Error(`missing file ${f}`);

const out = path.join(outRoot, label);
mkdirSync(out, { recursive: true });
const trace = (line: string) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  appendFileSync(path.join(out, 'trace.log'), stamped + '\n');
  console.log(stamped);
};
const which = (name: string) =>
  realpathSync(spawnSync('which', [name], { encoding: 'utf8' }).stdout.trim());
const java = which('java');
const mysqld = which('mysqld');
const mysql = which('mysql');
const mysqladmin = which('mysqladmin');

const temporary = realpathSync(
  mkdtempSync(path.join(env('TMPDIR'), `p13349-${label}-`)),
);
const workspace = path.join(temporary, 'workspace');
const workspaceMount = path.join(temporary, 'workspace-mount');
const runtimeState = path.join(temporary, 'runtime-state');
const mysqlData = path.join(temporary, 'mysql-data');
const trustedFolders = path.join(temporary, 'trusted-folders.json');
const homes = ['harness-a', 'harness-b', 'harness-c', 'spring-a', 'spring-b', 'spring-c'];
for (const d of [workspace, workspaceMount, runtimeState, mysqlData, ...homes.map((h) => path.join(temporary, h, '.qwen'))])
  mkdirSync(d, { recursive: true });
for (const h of homes)
  writeFileSync(path.join(temporary, h, '.qwen', 'settings.json'), JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
const boundWorkspaceId = 'e2e-workspace';
const boundStorageId = 'e2e-storage';
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';
const trustedActor = 'e2e-actor';
const tenant = 'mixed-version-e2e';

const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(https?|all)_proxy$/i.test(key) &&
      !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(key) &&
      !/(api_?key|token|secret|password|credentials?)$/i.test(key),
  ),
);

type Child = { child: ChildProcess; name: string; logFile: string };
const children: Child[] = [];
function start(executable: string, args: string[], childEnv: NodeJS.ProcessEnv, name: string): Child {
  const logFile = path.join(out, `${name}.log`);
  const fd = openSync(logFile, 'a');
  const child = spawn(executable, args, { cwd: workspace, env: childEnv, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const c = { child, name, logFile };
  children.push(c);
  trace(`started ${name} pid=${child.pid}`);
  return c;
}
const alive = (c: Child) => {
  try { process.kill(-c.child.pid!, 0); return true; } catch { return false; }
};
async function kill(c: Child, signal: NodeJS.Signals) {
  try { process.kill(-c.child.pid!, signal); } catch {}
  const deadline = Date.now() + 15_000;
  while (alive(c) && Date.now() < deadline) await sleep(50);
  if (alive(c)) { try { process.kill(-c.child.pid!, 'SIGKILL'); } catch {} }
  while (alive(c)) await sleep(50);
  trace(`stopped ${c.name} with ${signal}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(name: string, predicate: () => Promise<boolean> | boolean, timeoutMs: number, c?: Child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (c && (c.child.exitCode !== null || c.child.signalCode !== null))
      throw new Error(`${name}: ${c.name} exited early`);
    try { if (await predicate()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`${name} timed out after ${timeoutMs} ms`);
}
async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const p = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return p;
}
let mysqlPort = 0;
function sql(q: string): string {
  const r = spawnSync(mysql, ['--protocol=tcp', '--host=127.0.0.1', `--port=${mysqlPort}`, '--user=root', '--batch', '--skip-column-names', '--execute', q], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`mysql: ${r.stderr}`);
  return r.stdout.trim();
}
const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
const tenantHeaders = { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: trustedActor };

// Recording proxy between Spring and a Harness. Streams every response and
// keeps the body of each /load answer (and any non-2xx answer).
type TapRecord = { at: string; method: string; path: string; status: number; bootId?: string; body?: string };
function startTap(targetPort: number, name: string): Promise<{ url: string; records: TapRecord[]; close: () => Promise<void> }> {
  const records: TapRecord[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const up = httpRequest({ host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${targetPort}` } }, (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        const keep = /\/load$/.test(req.url ?? '') || (upRes.statusCode ?? 0) >= 400;
        const captured: Buffer[] = [];
        upRes.on('data', (c: Buffer) => { if (keep) captured.push(c); res.write(c); });
        upRes.on('end', () => {
          res.end();
          const rec: TapRecord = { at: new Date().toISOString(), method: req.method ?? '', path: req.url ?? '', status: upRes.statusCode ?? 0, bootId: upRes.headers['x-qwen-harness-boot-id'] as string | undefined, ...(keep ? { body: Buffer.concat(captured).toString('utf8').slice(0, 4000) } : {}) };
          records.push(rec);
          appendFileSync(path.join(out, `${name}.jsonl`), JSON.stringify(rec) + '\n');
        });
        upRes.on('aborted', () => res.destroy());
        upRes.on('error', () => res.destroy());
      });
      up.on('error', (e) => { appendFileSync(path.join(out, `${name}.jsonl`), JSON.stringify({ at: new Date().toISOString(), method: req.method, path: req.url, error: String(e) }) + '\n'); res.destroy(); });
      res.on('close', () => up.destroy());
      up.end(Buffer.concat(chunks));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    resolve({ url: `http://127.0.0.1:${port}`, records, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) });
  }));
}

const FIRST = 'MIXED_VERSION_FIRST_TURN';
const FIRST_REPLY = 'FIRST_TURN_ON_CURRENT_BUILD';
const SECOND = 'MIXED_VERSION_SECOND_TURN';
const SECOND_RESTORED = 'SECOND_TURN_RESTORED_CONTEXT';
const SECOND_MISSING = 'SECOND_TURN_CONTEXT_MISSING';
let released = false;
let releaseHold = () => {};
const hold = new Promise<void>((resolve) => { releaseHold = () => { released = true; resolve(); }; });
const INFLIGHT_PART = 'INFLIGHT_PART_ONE ';
const fake = await startFakeOpenAIServer(({ body }) => {
  const s = JSON.stringify(Array.isArray(body['messages']) ? body['messages'] : []);
  if (scenario === 'inflight' && s.includes(FIRST) && !s.includes(SECOND) && !released)
    return { contentChunks: [INFLIGHT_PART, 'INFLIGHT_PART_TWO'], holdAfterChunks: 1, holdUntil: hold };
  if (s.includes(SECOND)) return { contentChunks: (s.includes(FIRST) && s.includes(FIRST_REPLY) ? SECOND_RESTORED : SECOND_MISSING).match(/.{1,8}/g)! };
  if (s.includes(FIRST)) return { contentChunks: FIRST_REPLY.match(/.{1,8}/g)! };
  return { content: 'UNEXPECTED' };
});

const harnessToken = randomBytes(24).toString('hex');
const brokerToken = randomBytes(24).toString('hex');
const credentialKey = randomBytes(32).toString('base64');
const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
const result: Record<string, unknown> = { label, scenario, jarFirst: path.basename(jarFirst), jarSecond: path.basename(jarSecond), temporary };
let failure: unknown;

function springEnv(home: string, springPort: number, harnessUrl: string, brokerPort: number, storeUrl: string): NodeJS.ProcessEnv {
  return {
    ...cleanEnvironment,
    HOME: home, QWEN_HOME: path.join(home, '.qwen'), TMPDIR: temporary,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(springPort),
    SPRING_DATASOURCE_PASSWORD: '',
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${mysqlPort}/qwen_managed_agent?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: harnessUrl,
    QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
    QWEN_MANAGED_AGENT_HARNESS_TOKEN: harnessToken,
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'false',
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: trustedActorHeader,
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
    QWEN_MANAGED_AGENT_DISPATCH_LEASE_DURATION: '2s',
    QWEN_MANAGED_AGENT_DISPATCH_LEASE_RENEW_INTERVAL: '500ms',
    QWEN_MANAGED_AGENT_DISPATCH_SCAN_DELAY: '200ms',
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: storeUrl,
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '1s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(brokerPort),
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: brokerToken,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: credentialKey,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'e2e-local-v1',
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: runtimeState,
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: currentCli,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_CLI_ENTRY: currentCli,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
  };
}
const springArgs = (jar: string) => [
  '-jar', jar,
  ...(scenario === 'inflight' ? ['--qwen.managed-agent.dispatch.retry-max-delay=4s'] : []),
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${tenant}`,
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=${boundStorageId}`,
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`,
];
function startHarness(cli: string, home: string, port: number, brokerPort: number, name: string): Child {
  return start(process.execPath, [cli, 'serve', '--profile', 'hosted-harness', '--port', String(port), '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', workspace, '--managed-runtime-broker-url', `http://127.0.0.1:${brokerPort}`, `--managed-runtime-broker-token=${brokerToken}`], {
    ...cleanEnvironment,
    HOME: home, QWEN_HOME: path.join(home, '.qwen'), LANG: 'C', LC_ALL: 'C',
    QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_SERVER_TOKEN: harnessToken,
    OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
  }, name);
}
async function healthy(url: string, c: Child, auth = false) {
  await waitUntil(`${c.name} health`, async () => (await fetch(url, auth ? { headers: { authorization: `Bearer ${harnessToken}` } } : {})).ok, 90_000, c);
  trace(`${c.name} healthy`);
}
async function events(springUrl: string, sessionId: string, after = 0) {
  const r = await fetch(`${springUrl}/v1/agents/sessions/${sessionId}/events?after=${after}&limit=200`, { headers: tenantHeaders });
  if (!r.ok) throw new Error(`events ${r.status} ${await r.text()}`);
  return ((await r.json()) as { data: { sequence: number; type: string; terminal: boolean; data?: Record<string, unknown> }[] }).data;
}
const turnRow = (sessionId: string) => sql(`SELECT turn_id, status, error_code, IFNULL(error_message,''), retry_count, submission_attempted FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${q(tenant)} AND session_id=${q(sessionId)} ORDER BY created_at`);
const springRetryLines = (c: Child) => readFileSync(c.logFile, 'utf8').split('\n').filter((l) => /Managed Turn coordination/.test(l)).map((l) => l.replace(/^.*?(WARN|ERROR)/, '$1'));

try {
  mysqlPort = await freePort();
  const springPortA = await freePort(), harnessPortA = await freePort(), brokerPortA = await freePort();
  const init = spawnSync(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${mysqlData}`], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`mysqld init: ${init.stderr}`);
  const db = start(mysqld, ['--no-defaults', `--datadir=${mysqlData}`, `--socket=${path.join(temporary, 'mysql.sock')}`, `--port=${mysqlPort}`, '--bind-address=127.0.0.1', '--mysqlx=0', `--pid-file=${path.join(temporary, 'mysql.pid')}`, `--log-error=${path.join(out, 'mysql-error.log')}`], { ...process.env }, 'mysql');
  await waitUntil('mysql', () => spawnSync(mysqladmin, ['--protocol=tcp', '--host=127.0.0.1', `--port=${mysqlPort}`, '--user=root', 'ping'], { stdio: 'ignore' }).status === 0, 60_000, db);
  sql('CREATE DATABASE qwen_managed_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');

  // ---- Phase 1: current build owns the Session; Turn 1 streams deltas.
  const springUrlA = `http://127.0.0.1:${springPortA}`;
  const springA = start(java, springArgs(jarFirst), springEnv(path.join(temporary, 'spring-a'), springPortA, `http://127.0.0.1:${harnessPortA}`, brokerPortA, springUrlA), 'spring-a');
  await healthy(`${springUrlA}/actuator/health`, springA);
  sql(`INSERT INTO qwen_managed_agent.managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES (${q(tenant)}, ${q(boundWorkspaceId)}, 1, ${q(boundStorageId)}, 'E2E', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`);
  sql(`INSERT INTO qwen_managed_agent.managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES (${q(tenant)}, ${q(boundWorkspaceId)}, ${q(trustedActor)}, TRUE, TRUE)`);
  const harnessA = startHarness(currentCli, path.join(temporary, 'harness-a'), harnessPortA, brokerPortA, 'harness-a-current');
  await healthy(`http://127.0.0.1:${harnessPortA}/health`, harnessA, true);
  const created = await fetch(`${springUrlA}/v1/agents/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `create-${label}`, ...tenantHeaders },
    body: JSON.stringify({ agent_id: 'qwen-code', input: [{ type: 'text', text: `${FIRST}. Reply exactly ${FIRST_REPLY}.` }], ...(scenario === 'control' ? {} : { workspace: { workspace_id: boundWorkspaceId } }), metadata: { title: `PR13349 ${label}` } }),
  });
  if (created.status !== 202) throw new Error(`create ${created.status} ${await created.text()}`);
  const session = (await created.json()) as { id: string };
  result['sessionId'] = session.id;
  let firstTerminal: { type: string; sequence: number } | undefined;
  const sf = `tenant_id=${q(tenant)} AND session_id=${q(session.id)}`;
  if (scenario === 'inflight') {
    await waitUntil('turn 1 journaled delta', () => /6d6573736167652e64656c7461/i.test(sql(`SELECT HEX(record_bytes) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sf}`)), 120_000, springA);
    const seen = await events(springUrlA, session.id);
    result['turn1EventsBeforeCrash'] = seen.map((e) => e.type);
    result['turn1TerminalBeforeCrash'] = seen.some((e) => e.terminal);
    firstTerminal = { type: 'none', sequence: Math.max(0, ...seen.map((e) => e.sequence)) };
  } else {
    await waitUntil('turn 1 terminal', async () => {
      firstTerminal = (await events(springUrlA, session.id)).find((e) => e.terminal);
      return firstTerminal !== undefined;
    }, 120_000, springA);
    result['turn1Terminal'] = firstTerminal?.type;
    if (firstTerminal?.type !== 'turn.completed') throw new Error(`turn 1 ended ${firstTerminal?.type}`);
  }
  const txRows = sql(`SELECT record_encoding, HEX(record_bytes) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${sf} ORDER BY journal_revision`).split('\n').filter(Boolean);
  const kinds: Record<string, number> = {};
  for (const row of txRows) {
    const [encoding, hex] = row.split('\t');
    let bytes = Buffer.from(hex, 'hex');
    if (/gzip/i.test(encoding)) bytes = gunzipSync(bytes);
    for (const m of bytes.toString('utf8').matchAll(/"kind":"([a-z.]+)"/g)) kinds[m[1]] = (kinds[m[1]] ?? 0) + 1;
  }
  result['journalEncodings'] = [...new Set(txRows.map((r) => r.split('\t')[0]))];
  result['journalKinds'] = kinds;
  trace(`journal kinds after turn 1: ${JSON.stringify(kinds)}`);
  if (scenario === 'control') {
    if (kinds['message.delta']) throw new Error('control journal unexpectedly has message.delta');
  } else if (!kinds['message.delta']) throw new Error('turn 1 journal has no message.delta; the mixed-version precondition does not hold');
  result['turn1BootId'] = sql(`SELECT harness_boot_id FROM qwen_managed_agent.managed_agent_session WHERE ${sf}`);

  // ---- Kill both owners (crash), wait for the writer lease to expire.
  await Promise.all([kill(harnessA, 'SIGKILL'), kill(springA, 'SIGKILL')]);
  releaseHold();
  if (scenario === 'inflight') {
    result['turnRowAfterCrash'] = turnRow(session.id);
    await waitUntil('dispatch lease expiry after crash', () => sql(`SELECT IF(dispatch_lease_until IS NULL OR dispatch_lease_until < UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000, 1, 0) FROM qwen_managed_agent.managed_agent_turn WHERE ${sf}`) === '1', 15_000);
  }
  await waitUntil('writer lease expiry', () => sql(`SELECT IF(writer_lease_until IS NULL OR writer_lease_until < CURRENT_TIMESTAMP(6), 1, 0) FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${sf}`) === '1', 15_000);

  // ---- Phase 2: replacement Spring (arm under test) + replacement Harness.
  const springPortB = await freePort(), harnessPortB = await freePort(), brokerPortB = await freePort();
  const springUrlB = `http://127.0.0.1:${springPortB}`;
  const direct = scenario === 'storeoutage' || process.env['INFLIGHT_DIRECT'] === '1';
  const replacementCli = direct ? currentCli : legacyCli;
  const harnessBName = direct ? 'harness-b-current' : 'harness-b-legacy';
  const tapB = await startTap(harnessPortB, 'tap-b');
  const storeUrlB = scenario === 'storeoutage' ? `http://127.0.0.1:${await freePort()}` : springUrlB;
  result['replacementHarness'] = scenario === 'storeoutage' ? 'current build (dist/cli.js), Session Store URL unreachable' : direct ? 'current build (dist/cli.js)' : 'released 0.24.7';
  const harnessB = startHarness(replacementCli, path.join(temporary, 'harness-b'), harnessPortB, brokerPortB, harnessBName);
  const springB = start(java, springArgs(jarSecond), springEnv(path.join(temporary, 'spring-b'), springPortB, tapB.url, brokerPortB, storeUrlB), 'spring-b');
  await healthy(`${springUrlB}/actuator/health`, springB);
  await healthy(`http://127.0.0.1:${harnessPortB}/health`, harnessB, true);
  const t0 = Date.now();
  const loads = () => tapB.records.filter((r) => r.path.endsWith('/load'));
  if (scenario === 'inflight') {
    await waitUntil('takeover refusals past the pre-admission budget', () => loads().length >= 8, 120_000, springB);
    result['inflightLoads'] = loads().map((r) => ({ at: r.at, status: r.status, body: r.body, bootIdHeader: r.bootId !== undefined }));
    result['inflightTurnRow'] = turnRow(session.id);
    result['inflightTerminalEvents'] = (await events(springUrlB, session.id, firstTerminal!.sequence)).filter((e) => e.terminal);
    result['springBRetryLines'] = springRetryLines(springB);
    await Promise.all([kill(harnessB, 'SIGKILL'), kill(springB, 'SIGKILL')]);
    await waitUntil('dispatch lease expiry', () => sql(`SELECT IF(dispatch_lease_until IS NULL OR dispatch_lease_until < UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000, 1, 0) FROM qwen_managed_agent.managed_agent_turn WHERE ${sf} AND status IN ('ACCEPTED','RUNNING','CANCELLING')`) !== '0', 15_000);
    const springPortC = await freePort(), harnessPortC = await freePort(), brokerPortC = await freePort();
    const springUrlC = `http://127.0.0.1:${springPortC}`;
    const tapC = await startTap(harnessPortC, 'tap-c');
    const harnessC = startHarness(currentCli, path.join(temporary, 'harness-c'), harnessPortC, brokerPortC, 'harness-c-current');
    const springC = start(java, springArgs(jarSecond), springEnv(path.join(temporary, 'spring-c'), springPortC, tapC.url, brokerPortC, springUrlC), 'spring-c');
    await healthy(`${springUrlC}/actuator/health`, springC);
    await healthy(`http://127.0.0.1:${harnessPortC}/health`, harnessC, true);
    let terminal: { type: string; data?: Record<string, unknown> } | undefined;
    let all: Awaited<ReturnType<typeof events>> = [];
    await waitUntil('turn 1 terminal after roll-forward', async () => {
      all = await events(springUrlC, session.id, 0);
      terminal = all.find((e) => e.terminal);
      return terminal !== undefined;
    }, 180_000, springC);
    result['turn1TerminalAfterRollForward'] = terminal;
    result['turn1TextAfterRollForward'] = all.filter((e) => e.type === 'item.output_text.delta').map((e) => String(e.data?.['text'] ?? '')).join('');
    result['rollForwardLoads'] = tapC.records.filter((r) => r.path.endsWith('/load')).map((r) => ({ status: r.status, body: r.body }));
    result['turnRowFinal'] = turnRow(session.id);
    result['springCRetryLines'] = springRetryLines(springC);
    await tapC.close();
    throw 'INFLIGHT_DONE';
  }
  const second = await fetch(`${springUrlB}/v1/agents/sessions/${session.id}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `second-${label}`, ...tenantHeaders },
    body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: `${SECOND}. Use the prior conversation and reply exactly ${SECOND_RESTORED}.` }] }),
  });
  result['turn2Admission'] = second.status;
  if (second.status !== 202) throw new Error(`turn 2 ${second.status} ${await second.text()}`);
  const after = firstTerminal!.sequence;

  if (scenario === 'rollforward') {
    await waitUntil('refusals before roll-forward', () => loads().length >= rollforwardAfter, 60_000, springB);
    result['refusalsBeforeRollForward'] = loads().map((r) => ({ status: r.status, body: r.body, bootIdHeader: r.bootId !== undefined }));
    result['turnRowBeforeRollForward'] = turnRow(session.id);
    result['springBRetryLines'] = springRetryLines(springB);
    await Promise.all([kill(harnessB, 'SIGKILL'), kill(springB, 'SIGKILL')]);
    await waitUntil('dispatch lease expiry', () => sql(`SELECT IF(dispatch_lease_until IS NULL OR dispatch_lease_until < UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000, 1, 0) FROM qwen_managed_agent.managed_agent_turn WHERE ${sf} AND status IN ('ACCEPTED','RUNNING','CANCELLING')`) !== '0', 15_000);
    const springPortC = await freePort(), harnessPortC = await freePort(), brokerPortC = await freePort();
    const springUrlC = `http://127.0.0.1:${springPortC}`;
    const tapC = await startTap(harnessPortC, 'tap-c');
    const harnessC = startHarness(currentCli, path.join(temporary, 'harness-c'), harnessPortC, brokerPortC, 'harness-c-current');
    const springC = start(java, springArgs(jarSecond), springEnv(path.join(temporary, 'spring-c'), springPortC, tapC.url, brokerPortC, springUrlC), 'spring-c');
    await healthy(`${springUrlC}/actuator/health`, springC);
    await healthy(`http://127.0.0.1:${harnessPortC}/health`, harnessC, true);
    let terminal: { type: string; data?: Record<string, unknown> } | undefined;
    let all: Awaited<ReturnType<typeof events>> = [];
    await waitUntil('turn 2 terminal after roll-forward', async () => {
      all = await events(springUrlC, session.id, after);
      terminal = all.find((e) => e.terminal);
      return terminal !== undefined;
    }, 180_000, springC);
    result['turn2Terminal'] = terminal;
    result['turn2Text'] = all.filter((e) => e.type === 'item.output_text.delta').map((e) => String(e.data?.['text'] ?? '')).join('');
    result['rollForwardLoads'] = tapC.records.filter((r) => r.path.endsWith('/load')).map((r) => ({ status: r.status }));
    result['turnRowFinal'] = turnRow(session.id);
    result['springCRetryLines'] = springRetryLines(springC);
    await tapC.close();
  } else {
    let terminal: { type: string; data?: Record<string, unknown> } | undefined;
    let seen: Awaited<ReturnType<typeof events>> = [];
    await waitUntil('turn 2 terminal', async () => {
      seen = await events(springUrlB, session.id, after);
      terminal = seen.find((e) => e.terminal);
      return terminal !== undefined;
    }, 180_000, springB);
    result['turn2Terminal'] = terminal;
    result['turn2Text'] = seen.filter((e) => e.type === 'item.output_text.delta').map((e) => String(e.data?.['text'] ?? '')).join('');
    result['turn2TerminalAfterMs'] = Date.now() - t0;
    result['turnRowFinal'] = turnRow(session.id);
    result['springBRetryLines'] = springRetryLines(springB);
    result['loads'] = loads().map((r) => ({ at: r.at, status: r.status, body: r.body, bootIdHeader: r.bootId !== undefined }));
  }
  result['harnessBStderrOpenFailed'] = readFileSync(path.join(out, `${scenario === 'storeoutage' ? 'harness-b-current' : 'harness-b-legacy'}.log`), 'utf8').split('\n').filter((l) => /open failed|Hosted Session/.test(l)).slice(0, 5);
  await tapB.close();
} catch (e) {
  if (e === 'INFLIGHT_DONE') {
    result['harnessBStderrOpenFailed'] = readFileSync(path.join(out, process.env['INFLIGHT_DIRECT'] === '1' ? 'harness-b-current.log' : 'harness-b-legacy.log'), 'utf8').split('\n').filter((l) => /open failed|Hosted Session/.test(l)).slice(0, 5);
  } else {
  failure = e;
  result['error'] = String((e as Error)?.stack ?? e);
  }
} finally {
  for (const c of [...children].reverse()) if (alive(c)) await kill(c, c.name === 'mysql' ? 'SIGTERM' : 'SIGKILL');
  await fake.close();
  result['ok'] = failure === undefined;
  writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  trace(`RESULT ${label} ok=${failure === undefined}`);
}
if (failure) process.exit(1);
