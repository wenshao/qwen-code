// R3-1 real-stack probe for PR 13336: what does the real Runtime Broker
// record for a tool call cancelled before any dispatch claim?
//
// Real pieces: Spring Managed Agent Server jar with its embedded Runtime
// Broker, MySQL 8.4, the Hosted Harness (dist/cli.js) serving a
// Workspace-bound Session. Simulated: the model (fake-openai-server asks for
// one write_file call) and a pass-through proxy between the Harness and the
// Broker that holds POST .../executions/<id>:start, so the call stays
// PREPARED (never claimed) until the turn is cancelled through the WebShell
// cancel route. The Broker's own qwen_tool_execution row is the evidence.
//
// usage: tsx cancel.mts <arm> <jar> <label>
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { startFakeOpenAIServer, fakeToolCall } from '/Users/wenshao/git/pr13336-head/integration-tests/fake-openai-server.js';
import { createServer as createHttpServer } from 'node:http';

const [arm, jar, label] = process.argv.slice(2);
const RIG = '/Users/wenshao/git/pr13336-rig';
const HEAD = '/Users/wenshao/git/pr13336-head';
const MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql';
const JAVA = '/Users/wenshao/Install/jdk21/bin/java';
const cliBundle = path.join(HEAD, 'dist', 'cli.js');
// The Harness runs the H3-preview copy of the same bundle (gen-h3preview.mjs).
const harnessBundle = path.join(HEAD, 'dist', 'cli.js');
const TRIGGER = '[[H3_PREVIEW_MONITOR]]';
const runDir = path.join(RIG, 'runs', `${label}`);
mkdirSync(runDir, { recursive: true });
const tmp = mkdtempSync(path.join('/private/tmp/claude-501', 'p13336-split-'));
const db = `qwen_split_${label.replace(/[^a-z0-9]/gi, '_')}`;
const tenant = 'split-e2e';
const actorHeader = 'x-qwen-e2e-trusted-actor';
const actor = 'e2e-actor';
let workspaceId = '';
const MARKER = 'R3_1_CANCEL_PROBE';

const log = (line: string) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(path.join(runDir, 'probe.log'), stamped + '\n');
};
const sha256 = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => resolve(typeof a === 'object' && a ? a.port : 0));
    });
  });
}
function sql(query: string): string {
  const r = spawnSync(
    MYSQL,
    ['--no-defaults', '-uroot', `--socket=${RIG}/mysql.sock`, '-N', '-B', '-e', query],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`mysql: ${r.stderr}`);
  return r.stdout;
}
const children: ChildProcess[] = [];
function start(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const out = createWriteStream(path.join(runDir, `${name}.log`));
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.pipe(out);
  child.stderr!.pipe(out);
  children.push(child);
  return child;
}
async function waitUntil(what: string, fn: () => Promise<boolean>, ms: number) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      /* retry */
    }
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}
const headers = {
  'x-qwen-tenant-id': tenant,
  [actorHeader]: actor,
};

const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(https?|all)_proxy$/i.test(k) &&
      !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(k) &&
      !/(api_?key|token|secret|password|credentials?)$/i.test(k),
  ),
);

const fixtures = JSON.parse(readFileSync(`${HEAD}/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json`, 'utf8'));
// The shared chain's first revision: a Monitor admitted, task view pending.
const monitor = fixtures.monitorChainCases[0].revisions[0].monitorRun;
let release = () => {};
const hold = new Promise<void>((r) => {
  release = r;
});
let fake: Awaited<ReturnType<typeof startFakeOpenAIServer>> | undefined;
let exitCode = 0;
try {
  sql(`DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db}`);
  fake = await startFakeOpenAIServer(({ body }) => {
    const serialized = JSON.stringify(body['messages'] ?? []);
    if (serialized.includes(MARKER) && !serialized.includes('"role":"tool"')) {
      return { toolCalls: [fakeToolCall('write_file', { file_path: 'cancel-probe.txt', content: 'never written' }, 'call_r3_1_cancel')] };
    }
    return { content: 'ok' };
  });
  const springPort = await freePort();
  const harnessPort = await freePort();
  const brokerPort = await freePort();
  const harnessToken = randomBytes(24).toString('hex');
  const brokerToken = randomBytes(24).toString('hex');
  const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
  const workspace = path.join(tmp, 'workspace');
  const harnessHome = path.join(tmp, 'harness-home');
  const runtimeHome = path.join(tmp, 'runtime-home');
  const runtimeState = path.join(tmp, 'runtime-state');
  const mount = path.join(tmp, 'mount');
  for (const d of [workspace, path.join(harnessHome, '.qwen'), path.join(runtimeHome, '.qwen'), runtimeState, mount]) {
    mkdirSync(d, { recursive: true });
  }
  for (const h of [harnessHome, runtimeHome]) {
    writeFileSync(path.join(h, '.qwen', 'settings.json'), JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
  }
  // The embedded Runtime Broker requires the canonical workspace path hash.
  workspaceId = createHash('sha256').update(realpathSync(workspace)).digest('hex').slice(0, 16);
  const trusted = path.join(tmp, 'trusted.json');
  writeFileSync(trusted, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });

  const spring = start('spring', JAVA, [
    '-jar', jar,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${tenant}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=split-storage`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${mount}`,
  ], {
    ...cleanEnv,
    HOME: runtimeHome,
    QWEN_HOME: path.join(runtimeHome, '.qwen'),
    TMPDIR: tmp,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(springPort),
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:33336/${db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    SPRING_DATASOURCE_PASSWORD: '',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${harnessPort}`,
    QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
    QWEN_MANAGED_AGENT_HARNESS_TOKEN: harnessToken,
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: actorHeader,
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'false',
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${springPort}`,
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '1s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(brokerPort),
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: brokerToken,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: randomBytes(32).toString('base64'),
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'split-local-v1',
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: runtimeState,
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
    QWEN_MANAGED_AGENT_CLI_ENTRY: cliBundle,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
  });
  const springUrl = `http://127.0.0.1:${springPort}`;
  await waitUntil('Spring', async () => (await fetch(`${springUrl}/actuator/health`)).ok, 120_000);
  log(`spring up arm=${arm} jar=${path.basename(jar)} pid=${spring.pid} port=${springPort} db=${db}`);

  // Pass-through Harness -> Broker proxy that holds every execution start.
  const proxyLog: string[] = [];
  let heldStarts = 0;
  const proxy = createHttpServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const target = new URL(req.url ?? '/', `http://127.0.0.1:${brokerPort}`);
      if (req.method === 'POST' && target.pathname.includes('/executions/') && target.pathname.endsWith(':start')) {
        heldStarts++;
        proxyLog.push(`HELD ${req.method} ${target.pathname}`);
        req.socket.once('close', () => res.destroy());
        return;
      }
      const h = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || ['connection', 'content-length', 'host', 'transfer-encoding'].includes(k)) continue;
        h.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      const up = await fetch(target, { method: req.method, headers: h, ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body: Buffer.concat(chunks) }) });
      const body = Buffer.from(await up.arrayBuffer());
      proxyLog.push(`${req.method} ${target.pathname} ${up.status}`);
      const rh: Record<string, string> = {};
      up.headers.forEach((v, k) => { if (!['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(k)) rh[k] = v; });
      res.writeHead(up.status, rh);
      res.end(body);
    })().catch((e) => { proxyLog.push('ERR ' + String(e)); res.destroy(); });
  });
  const proxyPort = await freePort();
  await new Promise<void>((r) => proxy.listen(proxyPort, '127.0.0.1', () => r()));
  const harness = start('harness', process.execPath, [
    harnessBundle, 'serve', '--profile', 'hosted-harness', '--port', String(harnessPort),
    '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${proxyPort}`,
    `--managed-runtime-broker-token=${brokerToken}`,
  ], {
    ...cleanEnv,
    HOME: harnessHome,
    QWEN_HOME: path.join(harnessHome, '.qwen'),
    QWEN_CODE_TRUSTED_FOLDERS_PATH: trusted,
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
    QWEN_SERVER_TOKEN: harnessToken,
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: fake.baseUrl,
    OPENAI_MODEL: 'fake-model',
    QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: brokerToken,
    QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${proxyPort}`,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  });
  await waitUntil('Harness', async () => (await fetch(`http://127.0.0.1:${harnessPort}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok, 120_000);
  log(`harness up pid=${harness.pid}`);

  // A Workspace-bound Session: only tool-profile Sessions stream deltas.
  sql(`INSERT INTO ${db}.managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${tenant}', 'split-workspace', 1, 'split-storage', 'E2E', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`);
  sql(`INSERT INTO ${db}.managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${tenant}', 'split-workspace', '${actor}', TRUE, TRUE)`);
  const created = await fetch(`${springUrl}/v1/agents/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `split-${randomUUID()}`, ...headers },
    body: JSON.stringify({
      agent_id: 'qwen-code',
      input: [{ type: 'text', text: `${MARKER}. Write the file you are asked to write.` }],
      workspace: { workspace_id: 'split-workspace' },
      metadata: { title: 'R3-3 split probe' },
    }),
  });
  if (created.status !== 202) throw new Error(`create ${created.status} ${await created.text()}`);
  const session = (await created.json()) as { id: string };
  const sessionId = session.id;
  log(`session ${sessionId}`);

  type Ev = { sequence: number; type: string; terminal?: boolean; data?: Record<string, unknown>; turn_id?: string };
  const events = async (): Promise<Ev[]> => {
    const r = await fetch(`${springUrl}/v1/agents/sessions/${sessionId}/events?after=0&limit=1000`, { headers });
    return ((await r.json()) as { data: Ev[] }).data;
  };
  const row = () => sql(`SELECT execution_call_id, execution_state, IFNULL(execution_status,'NULL'), dispatch_generation, IFNULL(dispatch_owner,'NULL'), cancel_requested, IFNULL(CAST(result_json AS CHAR),'NULL'), IFNULL(settled_at,'NULL') FROM ${db}.qwen_tool_execution`).trim();
  await waitUntil('held execution start', async () => heldStarts > 0, 120_000);
  log(`Broker start held at the proxy; row before cancel: ${row()}`);
  const all0 = await events();
  const turnId = String((all0.find((e) => e.type === 'turn.accepted')?.data ?? {})['turnId']);
  const cancel = await fetch(`${springUrl}/api/agent/web-shell/v1/turns/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ requestId: `cancel-${randomUUID()}`, idempotencyKey: `cancel-${randomUUID()}`, sessionId, turnId }),
  });
  log(`WebShell cancel ${cancel.status} ${(await cancel.text()).slice(0, 200)}`);
  await waitUntil('settled execution', async () => row().split('\t')[1] === 'SETTLED', 120_000).catch((e) => log('wait: ' + e.message));
  await sleep(3_000);
  const final = row();
  writeFileSync(path.join(runDir, 'execution.tsv'), final + '\n');
  writeFileSync(path.join(runDir, 'proxy.log'), proxyLog.join('\n') + '\n');
  const all = await events();
  writeFileSync(path.join(runDir, 'events.json'), JSON.stringify(all, null, 1));
  log('EVENTS ' + all.map((e) => `${e.sequence}:${e.type}${e.terminal ? '[T]' : ''}`).join(' '));
  log('PROXY ' + proxyLog.join(' | '));
  const [callId, state, status, generation, owner, cancelRequested, result, settledAt] = final.split('\t');
  log(`RESULT\t${arm}\t${label}\tstate=${state}\texecutionStatus=${status}\tdispatchGeneration=${generation}\tdispatchOwner=${owner}\tcancelRequested=${cancelRequested}\tresult=${result}\tsettledAt=${settledAt}\tcall=${callId}\theldStarts=${heldStarts}`);
  proxy.close();
} catch (error) {
  exitCode = 1;
  log(`FAILED ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  release();
  for (const c of children) {
    try { process.kill(c.pid!, 'SIGCONT'); } catch { /* gone */ }
    c.kill('SIGTERM');
  }
  await sleep(2_000);
  for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  await fake?.close?.();
  process.exit(exitCode);
}
