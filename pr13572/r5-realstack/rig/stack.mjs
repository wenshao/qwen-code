// usage: node stack.mjs init <arm> <db> <springPort> <harnessPort> <brokerPort>
//        node stack.mjs spring|harness <db>      (re)start one component
//        node stack.mjs stop <db> [spring|harness]
// Directories are stable per database (workspace id derives from the path).
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync } from 'node:fs';
import path from 'node:path';

const RIG = '/Users/wenshao/git/pr13572-rig';
const [, , cmd, a1, a2, a3, a4, a5] = process.argv;
const java = '/Users/wenshao/Install/jdk21/bin/java';
const node = process.execPath;
const sql = (db, q) =>
  execFileSync(`${RIG}/mysql.sh`, ['sql', '-N', '-e', q, ...(db ? [db] : [])], { encoding: 'utf8' });

function clean() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !/^(https?|all|no)_proxy$/i.test(k) &&
        !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex)_/i.test(k) &&
        !/(api_?key|token|secret|password|credentials?)$/i.test(k),
    ),
  );
}
function launch(st, name, exe, args, env) {
  const out = openSync(path.join(st.dir, `${name}.log`), 'a');
  const child = spawn(exe, args, { cwd: st.wt, env, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  st.pids[name] = child.pid;
  console.log(`${name} pid=${child.pid}`);
}
const save = (st) => writeFileSync(path.join(st.dir, 'state.json'), JSON.stringify(st, null, 2));
const load = (db) => JSON.parse(readFileSync(path.join(RIG, 'runs', db, 'state.json'), 'utf8'));

function startSpring(st) {
  const env = {
    ...clean(),
    TZ: 'UTC',
    HOME: st.runtimeHome,
    QWEN_HOME: path.join(st.runtimeHome, '.qwen'),
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    SERVER_PORT: String(st.springPort),
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:33572/${st.db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    SPRING_DATASOURCE_PASSWORD: '',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: process.env.RIG_APPROVAL_MODE ?? 'yolo',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: st.digest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: st.harnessUrl ?? `http://127.0.0.1:${st.harnessPort}`,
    QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
    QWEN_MANAGED_AGENT_HARNESS_TOKEN: st.harnessToken,
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: 'x-rig-actor',
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'false',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(st.brokerPort),
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: st.brokerToken,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: st.credentialKey,
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'rig-v1',
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: st.runtimeState,
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: st.cli,
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${st.internalPort}`,
    QWEN_MANAGED_AGENT_INTERNAL_SERVER_PORT: String(st.internalPort),
    QWEN_MANAGED_AGENT_CHANNELS_ENABLED: process.env.RIG_CHANNELS_ENABLED ?? 'true',
    QWEN_MANAGED_AGENT_CHANNELS_CLAIM_LEASE: process.env.RIG_CLAIM_LEASE ?? '90s',
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: process.env.RIG_WRITER_LEASE ?? '60s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: st.workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: node,
    QWEN_MANAGED_AGENT_CLI_ENTRY: st.cli,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: st.workspace,
  };
  launch(st, 'spring', java, [
    '-jar', st.jar,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=rig`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=rig-storage`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${st.mount}`,
    ...(process.env.RIG_SCAN_DELAY ? [`--qwen.managed-agent.channels.scan-delay=${process.env.RIG_SCAN_DELAY}`] : []),
  ], env);
}
function startHarness(st) {
  const env = {
    ...clean(),
    HOME: st.harnessHome,
    QWEN_HOME: path.join(st.harnessHome, '.qwen'),
    QWEN_CODE_TRUSTED_FOLDERS_PATH: path.join(st.dir, 'trusted.json'),
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: st.digest,
    QWEN_SERVER_TOKEN: st.harnessToken,
    OPENAI_API_KEY: process.env.RIG_OPENAI_API_KEY ?? 'fake-key',
    OPENAI_BASE_URL: process.env.RIG_OPENAI_BASE_URL ?? st.modelUrl,
    OPENAI_MODEL: process.env.RIG_MODEL ?? 'fake-model',
    QWEN_MODEL: process.env.RIG_MODEL ?? 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: st.brokerToken,
    QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${st.brokerPort}`,
    NO_PROXY: '127.0.0.1,localhost',
  };
  launch(st, 'harness', node, [
    st.cli, 'serve', '--profile', 'hosted-harness', '--port', String(st.harnessPort),
    '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', st.workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${st.brokerPort}`,
    `--managed-runtime-broker-token=${st.brokerToken}`,
  ], env);
}
function kill(st, name) {
  const pid = st.pids[name];
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); console.log(`killed ${name} pgid ${pid}`); } catch (e) { console.log(`${name} ${pid}: ${e.code}`); }
  delete st.pids[name];
}

if (cmd === 'init') {
  const [arm, db] = [a1, a2];
  const wt = `/Users/wenshao/git/pr13572-${arm}`;
  const dir = path.join(RIG, 'runs', db);
  const st = {
    arm, db, wt, dir,
    cli: process.env.CLI ?? path.join(wt, 'dist', 'cli.js'),
    jar: process.env.JAR ?? path.join(wt, 'packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar'),
    springPort: Number(a3), harnessPort: Number(a4), brokerPort: Number(a5), internalPort: Number(a3) + 3,
    workspace: path.join(dir, 'workspace'), mount: path.join(dir, 'workspace-mount'),
    runtimeHome: path.join(dir, 'runtime-home'), harnessHome: path.join(dir, 'harness-home'),
    runtimeState: path.join(dir, 'runtime-state'),
    harnessToken: randomBytes(24).toString('base64url').replace(/^-/, 'A'),
    brokerToken: randomBytes(24).toString('base64url').replace(/^-/, 'A'),
    credentialKey: randomBytes(32).toString('base64'),
    digest: `sha256:${randomBytes(32).toString('hex')}`,
    harnessUrl: process.env.RIG_HARNESS_URL,
    modelUrl: readFileSync(path.join(RIG, 'runs', 'model.url'), 'utf8').trim(),
    pids: {},
  };
  st.workspaceId = createHash('sha256').update(st.workspace).digest('hex').slice(0, 16);
  for (const d of [st.workspace, st.mount, path.join(st.runtimeHome, '.qwen'), path.join(st.harnessHome, '.qwen'), st.runtimeState])
    mkdirSync(d, { recursive: true });
  for (const h of [st.runtimeHome, st.harnessHome])
    writeFileSync(path.join(h, '.qwen', 'settings.json'), JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
  writeFileSync(path.join(dir, 'trusted.json'), JSON.stringify({ [st.workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
  sql(null, `CREATE DATABASE IF NOT EXISTS ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  startSpring(st);
  save(st);
} else if (cmd === 'spring' || cmd === 'harness') {
  const st = load(a1);
  kill(st, cmd);
  cmd === 'spring' ? startSpring(st) : startHarness(st);
  save(st);
} else if (cmd === 'stop') {
  const st = load(a1);
  for (const n of a2 ? [a2] : Object.keys(st.pids)) kill(st, n);
  save(st);
} else {
  console.error('bad command');
  process.exit(2);
}
