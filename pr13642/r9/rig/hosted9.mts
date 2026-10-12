// Round 9: a real Hosted Managed Session runs a real background Shell through Spring + embedded Broker + Hosted
// Harness + local-process Runtime worker (fake model only). We then read the rows the product itself wrote and
// evaluate the PR's guard query against them, and drive the retention sweep on the real jar.
//
// usage: npx tsx hosted9.ts <mysql|maria> <dbname> <session|workspace> <outdir>
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import {
  fakeToolCall,
  startFakeOpenAIServer,
} from '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad/wt-r8b/integration-tests/fake-openai-server.ts';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad';
const ROOT = `${S}/wt-r8b`;
const JAR = process.env['JAR'] ?? `${S}/jars/merge-r9-6e64630b.jar`;
const CLI = `${ROOT}/dist/cli.js`;
const MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql';
const JAVA = '/Users/wenshao/Install/jdk21/bin/java';
const [engine, dbName, mode, outDir] = process.argv.slice(2);
if (!engine || !dbName || !mode || !outDir) throw new Error('usage: hosted9.ts <mysql|maria> <db> <session|workspace> <outdir>');
const dbPort = engine === 'mysql' ? 33642 : 43642;
const workspaceTurn = mode === 'workspace';
const tag = `${engine}-${mode}`;
const marker = `R9_BACKGROUND_SHELL_${engine.toUpperCase()}_${mode.toUpperCase()}`;
const SHELL_SECONDS = Number(process.env['SHELL_SECONDS'] ?? '40');
const IDENTITY_ONLY = process.env['IDENTITY_ONLY'] === '1';

// Stable deployment dirs per DB (the Session Store workspace id derives from the workspace path).
const base = `${S}/rig/hosted9/ws/${dbName}`;
const workspace = `${base}/workspace`;
const harnessHome = `${base}/harness-home`;
const runtimeHome = `${base}/runtime-home`;
const runtimeState = `${base}/runtime-state`;
const workspaceMount = `${base}/workspace-mount`;
const trustedFolders = `${base}/trusted-folders.json`;
rmSync(base, { recursive: true, force: true });
for (const d of [workspace, `${harnessHome}/.qwen`, `${runtimeHome}/.qwen`, workspaceMount]) mkdirSync(d, { recursive: true });
mkdirSync(runtimeState, { recursive: true, mode: 0o700 });
writeFileSync(`${harnessHome}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER', [workspaceMount]: 'TRUST_FOLDER' }), { mode: 0o600 });
mkdirSync(outDir, { recursive: true });
const report = `${outDir}/hosted-${tag}.txt`;
writeFileSync(report, '');
const log = (line = '') => { appendFileSync(report, line + '\n'); console.log(line); };

const tenant = `r9-${mode}`;
const boundWorkspaceId = 'r9-workspace';
const boundStorageId = 'r9-storage';
const trustedActorHeader = 'x-qwen-e2e-trusted-actor';
const trustedActor = 'r9-actor';
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
const harnessToken = randomBytes(24).toString('hex');
const brokerToken = randomBytes(24).toString('hex');
const credentialKey = randomBytes(32).toString('base64');
const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
const headers = { 'x-qwen-tenant-id': tenant, [trustedActorHeader]: trustedActor };

function sql(statement: string): string {
  const r = spawnSync(MYSQL, ['-uroot', '-ppr13642', '-h127.0.0.1', `-P${dbPort}`, '-N', '-B', dbName, '-e', statement], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mysql failed: ${r.stderr}\n${statement}`);
  return r.stdout.trimEnd();
}
function sqlRoot(statement: string): void {
  const r = spawnSync(MYSQL, ['-uroot', '-ppr13642', '-h127.0.0.1', `-P${dbPort}`, '-e', statement], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mysql failed: ${r.stderr}`);
}
async function freePort(): Promise<number> {
  return await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(name: string, fn: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { if (await fn()) return; } catch { /* retry */ }
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${name}`);
    await sleep(500);
  }
}
type Proc = { child: ChildProcess; name: string; logFile: string };
const procs: Proc[] = [];
function startProc(name: string, exe: string, args: string[], env: NodeJS.ProcessEnv, cwd = ROOT): Proc {
  const logFile = `${outDir}/${tag}-${name}.log`;
  const fd = openSync(logFile, 'a');
  const child = spawn(exe, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  writeFileSync(`${logFile}.pid`, String(child.pid));
  const p = { child, name, logFile };
  procs.push(p);
  return p;
}
async function stopProc(p: Proc, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (p.child.exitCode !== null || p.child.signalCode !== null) return;
  try { process.kill(-p.child.pid!, signal); } catch { /* gone */ }
  await until(`${p.name} exit`, () => p.child.exitCode !== null || p.child.signalCode !== null, 60_000);
}
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(https?|all)_proxy$/i.test(k) && !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(k)));

// The PR's guard query, verbatim (ManagedRuntimeRetentionGuard.backgroundRunUnsettled), with the binding's own values.
function guardHit(bindingId: string, generation: string, scopeTenant: string, scopeWorkspace: string): string {
  const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
  return sql(`SELECT COUNT(*) FROM (SELECT 1 FROM qwen_tool_execution e`
    + ` JOIN qwen_managed_session_extension_record r ON r.tenant_id = ${q(scopeTenant)}`
    + ` AND r.session_id = e.harness_session_id AND r.domain = 'child_run'`
    + ` WHERE e.binding_id = ${q(bindingId)} AND e.runtime_generation = ${generation}`
    + ` AND CAST(e.binding_id AS BINARY(2048)) = CAST(${q(bindingId)} AS BINARY(2048))`
    + ` AND CAST(RIGHT(e.execution_call_id, 8) AS BINARY(8)) = CAST(':process' AS BINARY(8))`
    + ` AND CAST(r.tenant_id AS BINARY(2048)) = CAST(${q(scopeTenant)} AS BINARY(2048))`
    + ` AND CAST(r.workspace_id AS BINARY(2048)) = CAST(${q(scopeWorkspace)} AS BINARY(2048))`
    + ` AND CAST(r.session_id AS BINARY(2048)) = CAST(e.harness_session_id AS BINARY(2048))`
    + ` AND CAST(r.domain AS BINARY(2048)) = CAST('child_run' AS BINARY(2048))`
    + ` AND CAST(r.task_kind AS BINARY(2048)) = CAST('background_shell' AS BINARY(2048))`
    + ` AND r.settled_at IS NULL LIMIT 1) g`);
}
function snapshot(title: string): { bindings: string[][] } {
  log(`--- ${title}`);
  const bindings = sql(`SELECT binding_id, runtime_generation, binding_state, tenant_id, workspace_id, isolation_class,`
    + ` IFNULL(isolation_key,'-'), drain_requested, IF(drain_receipt_json IS NULL,'no','yes'), last_active_at`
    + ` FROM qwen_runtime_binding ORDER BY last_active_at`).split('\n').filter(Boolean).map((l) => l.split('\t'));
  for (const b of bindings) log(`  binding ${b[0]} gen=${b[1]} state=${b[2]} scope.tenant=${b[3]} scope.workspace=${b[4]} isolation=${b[5]} isolationKey=${b[6]} drain_requested=${b[7]} drain_receipt=${b[8]} last_active_at=${b[9]}`);
  for (const l of sql(`SELECT runtime_session_id, binding_id, runtime_generation, session_state, harness_session_id FROM qwen_runtime_session ORDER BY last_active_at`).split('\n').filter(Boolean))
    { const c = l.split('\t'); log(`  runtime_session ${c[0]} binding=${c[1]} gen=${c[2]} state=${c[3]} harness_session_id=${c[4]}`); }
  for (const l of sql(`SELECT execution_call_id, binding_id, runtime_generation, execution_state, harness_session_id FROM qwen_tool_execution ORDER BY execution_call_id`).split('\n').filter(Boolean))
    { const c = l.split('\t'); log(`  execution ${c[0]} binding=${c[1]} gen=${c[2]} state=${c[3]} harness_session_id=${c[4]}`); }
  for (const l of sql(`SELECT tenant_id, workspace_id, session_id, domain, record_id, task_kind, task_state, IFNULL(runtime_state,'-'), IFNULL(settled_at,'NULL') FROM qwen_managed_session_extension_record WHERE domain='child_run' ORDER BY created_at`).split('\n').filter(Boolean))
    { const c = l.split('\t'); log(`  extension_record tenant=${c[0]} workspace_id=${c[1]} session_id=${c[2]} domain=${c[3]} record=${c[4]} task_kind=${c[5]} task_state=${c[6]} runtime_state=${c[7]} settled_at=${c[8]}`); }
  for (const l of sql(`SELECT tenant_id, workspace_id, session_id, state FROM qwen_managed_session_journal_head ORDER BY session_id`).split('\n').filter(Boolean))
    { const c = l.split('\t'); log(`  journal_head tenant=${c[0]} workspace_id=${c[1]} session_id=${c[2]} state=${c[3]}  <- ManagedSessionStore.requireHeadScope forces every extension record of this Session onto these values`); }
  for (const b of bindings) log(`  guard(${b[0]} gen=${b[1]}) backgroundRunUnsettled rows=${guardHit(b[0], b[1], b[3], b[4])}`);
  return { bindings };
}

let spring: Proc | undefined;
let harness: Proc | undefined;
let fakeClose: (() => Promise<void>) | undefined;
try {
  sqlRoot(`DROP DATABASE IF EXISTS ${dbName}`);
  sqlRoot(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const fake = await startFakeOpenAIServer(({ body }) => {
    const serialized = JSON.stringify(body['messages'] ?? []);
    if (serialized.includes(marker) && !serialized.includes('"role":"tool"')) {
      return { toolCalls: [IDENTITY_ONLY
        ? fakeToolCall('write_file', { file_path: 'r9-identity.txt', content: 'r9 identity\n' }, `call_r9_${engine}_${mode}`)
        : fakeToolCall('run_shell_command', {
          command: `sleep ${SHELL_SECONDS}; echo R9_SHELL_FINISHED`, is_background: true, description: 'r9 background shell',
        }, `call_r9_${engine}_${mode}`)] };
    }
    if (serialized.includes(marker)) return { content: 'R9_BACKGROUND_SHELL_LAUNCHED' };
    return { content: 'R9_OTHER' };
  });
  fakeClose = fake.close;
  const springPort = await freePort();
  const harnessPort = await freePort();
  const brokerPort = await freePort();
  writeFileSync(`${outDir}/${tag}-ports.json`, JSON.stringify({ springPort, harnessPort, brokerPort, brokerToken, dbName, dbPort, tenant }));
  const springEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    ...cleanEnv, HOME: runtimeHome, QWEN_HOME: `${runtimeHome}/.qwen`, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    JAVA_HOME: '/Users/wenshao/Install/jdk21',
    SERVER_PORT: String(springPort),
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${dbPort}/${dbName}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root', SPRING_DATASOURCE_PASSWORD: 'pr13642',
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
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'r9-local-v1',
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: runtimeState,
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: CLI,
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${springPort}`,
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '5s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
    ...extra,
  });
  const springArgs = ['-jar', JAR,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${tenant}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=${boundStorageId}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`];
  const startSpring = async (name: string, extra: Record<string, string> = {}) => {
    const p = startProc(name, JAVA, springArgs, springEnv(extra));
    await until(`${name} health`, async () => (await fetch(`http://127.0.0.1:${springPort}/actuator/health`)).ok, 180_000);
    return p;
  };
  const startHarness = async (name: string) => {
    const p = startProc(name, process.execPath, [CLI, 'serve', '--profile', 'hosted-harness', '--port', String(harnessPort),
      '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', workspace,
      '--managed-runtime-broker-url', `http://127.0.0.1:${brokerPort}`, `--managed-runtime-broker-token=${brokerToken}`], {
      ...cleanEnv, HOME: harnessHome, QWEN_HOME: `${harnessHome}/.qwen`, QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
      QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest, QWEN_SERVER_TOKEN: harnessToken,
      OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: fake.baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
      QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
    });
    await until(`${name} health`, async () => (await fetch(`http://127.0.0.1:${harnessPort}/health?deep=1`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 120_000);
    return p;
  };

  log(`## [${tag}] real Hosted stack: jar=${path.basename(JAR)} cli=dist/cli.js db=${engine}:${dbName} turn=${workspaceTurn ? `Workspace (${boundWorkspaceId})` : 'Session (no workspace)'}`);
  spring = await startSpring('spring1');
  sql(`INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${tenant}', '${boundWorkspaceId}', 1, '${boundStorageId}', 'R9', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`);
  sql(`INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('${tenant}', '${boundWorkspaceId}', '${trustedActor}', 'OPERATOR')`);
  harness = await startHarness('harness1');
  const created = await fetch(`http://127.0.0.1:${springPort}/v1/agents/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `r9-${Date.now()}`, ...headers },
    body: JSON.stringify({ agent_id: 'qwen-code', input: [{ type: 'text', text: `${marker}. Start the background shell.` }],
      ...(workspaceTurn ? { workspace: { workspace_id: boundWorkspaceId } } : {}), metadata: { title: `R9 ${tag}` } }),
  });
  const createdBody = await created.text();
  if (created.status !== 202) throw new Error(`session create ${created.status}: ${createdBody}`);
  const sessionId = (JSON.parse(createdBody) as { id: string }).id;
  log(`1. POST /v1/agents/sessions -> 202, managed Session ${sessionId}`);
  let terminal = '';
  await until('turn terminal', async () => {
    const page = await (await fetch(`http://127.0.0.1:${springPort}/v1/agents/sessions/${sessionId}/events?after=0&limit=200`, { headers })).json() as { data: Array<{ type: string; terminal?: boolean }> };
    const t = page.data.find((e) => e.terminal);
    if (t) terminal = t.type;
    return t !== undefined;
  }, 180_000);
  log(`   first Turn terminal event: ${terminal}; model requests=${fake.requests.length}`);
  if (!IDENTITY_ONLY) await until('background shell child_run record', () => sql(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE domain='child_run' AND task_kind='background_shell'`) !== '0', 60_000);
  await until(IDENTITY_ONLY ? 'execution row' : ':process execution row', () => IDENTITY_ONLY ? sql(`SELECT COUNT(*) FROM qwen_tool_execution`) !== '0' : sql(`SELECT COUNT(*) FROM qwen_tool_execution WHERE execution_call_id LIKE '%:process'`) !== '0', 60_000);
  snapshot(IDENTITY_ONLY ? '2. after the Workspace Turn (rows exactly as the product wrote them)' : '2. while the Shell runs (rows exactly as the product wrote them)');
  if (IDENTITY_ONLY) {
    const ok = sql(`SELECT COUNT(*) FROM qwen_runtime_binding b JOIN qwen_tool_execution e ON e.binding_id=b.binding_id AND e.runtime_generation=b.runtime_generation`
      + ` JOIN qwen_managed_session_journal_head h ON BINARY h.tenant_id=BINARY b.tenant_id AND BINARY h.workspace_id=BINARY b.workspace_id AND BINARY h.session_id=BINARY e.harness_session_id`
      + ` WHERE BINARY e.harness_session_id = BINARY '${sessionId}'`);
    const all = sql(`SELECT COUNT(*) FROM qwen_tool_execution`);
    log(`IDENTITY: executions=${all}; executions whose (binding tenant, binding workspace, harness_session_id) equal the Session's journal head (tenant, workspace, session), byte-exact = ${ok}`);
    log(`## [${tag}] identity done`);
    throw new Error('IDENTITY_DONE');
  }

  // Crash the Harness mid-Shell: nothing is left to settle the child_run record.
  await stopProc(harness, 'SIGKILL');
  log(`3. SIGKILL Hosted Harness (process group) while the Shell is still running`);
  await until(':process row terminal', () => sql(`SELECT COUNT(*) FROM qwen_tool_execution WHERE execution_call_id LIKE '%:process' AND execution_state IN ('SETTLED','ABANDONED')`) !== '0', (SHELL_SECONDS + 60) * 1000).catch(() => log('   (:process row did not reach a terminal state within the wait)'));
  snapshot(`4. after the Shell's ${SHELL_SECONDS} s elapsed with no Harness alive`);
  await stopProc(spring, 'SIGTERM');
  log('5. Spring stopped (SIGTERM)');
  snapshot('6. after Spring stop');
  writeFileSync(`${outDir}/${tag}-session.json`, JSON.stringify({ sessionId, springPort, harnessPort, brokerPort, brokerToken, tenant, dbName, dbPort, workspaceId }));
  log(`## [${tag}] phase-1 done`);
} catch (error) {
  if (!(error instanceof Error && error.message === 'IDENTITY_DONE')) {
    log(`ERROR: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  }
} finally {
  for (const p of procs.reverse()) await stopProc(p, 'SIGTERM').catch(() => {});
  await fakeClose?.();
}
