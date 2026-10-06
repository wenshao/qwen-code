// VERIFICATION RIG ONLY (PR #13355), adapted from the #13336 rig. R3-3 real-stack probe: does a Monitor revision committed
// between two streamed text deltas of one assistant message split the
// stored message Part?
//
// Real pieces: Spring Managed Agent Server jar (base or head), MySQL 8.4, the
// Hosted Harness serving a Workspace-bound Session (only tool-profile
// Sessions stream message.delta commits), its HTTP Session Store client and
// the Spring HarnessCoordinator that projects the Harness stream. Simulated:
// the model (the repo's fake-openai-server streams "one", the trigger chunk,
// "two", holding after "one" until it is on the public stream) and H3 itself:
// the Harness runs dist-h3preview (gen-h3preview.mjs), where monitor_run is
// enabled and the trigger chunk makes the same authority commit the shared
// fixture's first monitor_run revision instead of text.
//
// usage: tsx split.ts <arm> <jar> <label>
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
import { startFakeOpenAIServer } from '/Users/wenshao/git/pr13355-head/integration-tests/fake-openai-server.js';

const [arm, jar, label] = process.argv.slice(2);
const RIG = '/Users/wenshao/git/pr13355-rig';
const HEAD = '/Users/wenshao/git/pr13355-head';
const MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql';
const JAVA = '/Users/wenshao/Install/jdk21/bin/java';
const cliBundle = path.join(HEAD, 'dist', 'cli.js');
// The Harness runs the H3-preview copy of the same bundle (gen-h3preview.mjs).
const harnessBundle = path.join(HEAD, 'dist-h3preview', 'cli.js');
const TRIGGER = '[[H3_PREVIEW_MONITOR]]';
const runDir = path.join(RIG, 'runs', `${label}`);
mkdirSync(runDir, { recursive: true });
const tmp = mkdtempSync(path.join('/private/tmp/claude-501', 'p13355-split-'));
const db = `qwen_split_${label.replace(/[^a-z0-9]/gi, '_')}`;
const tenant = 'split-e2e';
const actorHeader = 'x-qwen-e2e-trusted-actor';
const actor = 'e2e-actor';
let workspaceId = '';
const MARKER = 'R3_3_SPLIT_PROBE';

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
    if (serialized.includes(MARKER)) {
      return { contentChunks: ['one', TRIGGER, 'two'], holdAfterChunks: 1, holdUntil: hold };
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
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:33355/${db}?useSSL=false&allowPublicKeyRetrieval=true`,
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

  const harness = start('harness', process.execPath, [
    harnessBundle, 'serve', '--profile', 'hosted-harness', '--port', String(harnessPort),
    '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${brokerPort}`,
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
    QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
    H3_PREVIEW_TRIGGER: TRIGGER,
    H3_PREVIEW_MONITOR: JSON.stringify(monitor),
    H3_PREVIEW_DIGEST: sha256(JSON.stringify(monitor)),
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
      input: [{ type: 'text', text: `${MARKER}. Reply with the two words you are given.` }],
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
  await waitUntil('delta one', async () => (await events()).some((e) => e.type === 'item.output_text.delta' && JSON.stringify(e.data ?? {}).includes('one')), 120_000);
  log('delta "one" is on the public event stream; model stream is held');

  const commit = { status: 'harness' };
  log('releasing the held model stream: trigger chunk, then "two"');
  release();
  await waitUntil('terminal or delta two', async () => {
    const all = await events();
    return all.some((e) => e.terminal) || all.filter((e) => e.type === 'item.output_text.delta').length >= 2;
  }, 120_000).catch((e) => log(`wait: ${e.message}`));
  await sleep(8_000);

  const all = await events();
  writeFileSync(path.join(runDir, 'events.json'), JSON.stringify(all, null, 1));
  log('EVENTS ' + all.map((e) => `${e.sequence}:${e.type}${e.type.includes('delta') ? `(${JSON.stringify((e.data ?? {})['text'])})` : ''}${e.terminal ? '[T]' : ''}`).join(' '));
  const parts = sql(`SELECT item_id, part_id, part_type, part_text FROM ${db}.managed_agent_item_part WHERE session_id='${sessionId}' ORDER BY item_id, part_id`);
  writeFileSync(path.join(runDir, 'parts.tsv'), parts);
  log('PARTS\n' + parts.trim());
  let outbox = '(table absent)';
  try {
    outbox = sql(`SELECT task_id, event_sequence, event_type, state, runtime_state FROM ${db}.qwen_managed_session_task_journal WHERE session_id='${sessionId}' ORDER BY task_id, event_sequence`).trim() || '(empty)';
  } catch { /* no journal table */ }
  writeFileSync(path.join(runDir, 'task-journal.tsv'), outbox + '\n');
  log('TASK_JOURNAL ' + outbox);
  const items = await fetch(`${springUrl}/v1/agents/sessions/${sessionId}/items?limit=100`, { headers });
  const itemsBody = await items.text();
  writeFileSync(path.join(runDir, 'items.json'), itemsBody);
  log(`ITEMS ${items.status} ${itemsBody.slice(0, 1500)}`);
  const tasks = await fetch(`${springUrl}/v1/agents/sessions/${sessionId}/tasks`, { headers });
  const tasksBody = await tasks.text();
  writeFileSync(path.join(runDir, 'tasks.json'), tasksBody);
  log(`TASKS ${tasks.status} ${tasksBody.slice(0, 300)}`);
  try {
    const taskId = (JSON.parse(tasksBody).data ?? [])[0]?.id;
    if (taskId) {
      const te = await fetch(`${springUrl}/v1/agents/sessions/${sessionId}/tasks/${taskId}/events`, { headers });
      const teBody = await te.text();
      writeFileSync(path.join(runDir, 'task-events.json'), teBody);
      log(`TASK_EVENTS ${te.status} ${teBody.slice(0, 600)}`);
    }
  } catch (e) { log(`task events: ${e}`); }
  const outputParts = parts.trim().split('\n').filter((l) => l.split('\t')[2] === 'output_text');
  log(`RESULT\t${arm}\t${label}\tmonitorCommit=${commit.status}\toutput_text_parts=${outputParts.length}\ttexts=${JSON.stringify(outputParts.map((l) => l.split('\t')[3]))}\ttaskUpdatedEvents=${all.filter((e) => e.type === 'task.updated').length}\ttaskJournal=${outbox.split('\n').filter((l) => l && !l.startsWith('(')).length}`);
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
