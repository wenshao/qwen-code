// usage: node stack.mjs init <arm> <db> <springPort>   (harness=P+1, broker=P+2, hproxy=P+3)
//        node stack.mjs spring|harness|hproxy <db>      (re)start one component
//        node stack.mjs stop <db> [spring|harness|hproxy]
// Spring env overrides: RIG_SPRING_ENV='{"KEY":"value",...}' (saved in state.json).
// Directories are stable per database (workspace id derives from the path).
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, openSync } from 'node:fs';
import path from 'node:path';

const RIG = '/Users/wenshao/git/pr13530-rig';
const [, , cmd, a1, a2, a3] = process.argv;
const java = '/Users/wenshao/Install/jdk21/bin/java';
const node = process.execPath;
const sql = (db, q) =>
  execFileSync(`${RIG}/mysql.sh`, ['sql', '-N', '-e', q, ...(db ? [db] : [])], { encoding: 'utf8' });

function clean() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !/^(https?|all|no)_proxy$/i.test(k) &&
        !/^(qwen|dashscope|dashscop|openai|anthropic|google|gemini|azure|aws|vertex|rig)_/i.test(k) &&
        !/(api_?key|token|secret|password|credentials?|_ak)$/i.test(k),
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
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:33530/${st.db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    SPRING_DATASOURCE_PASSWORD: '',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: st.digest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${st.hproxyPort}`,
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
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${st.springPort}`,
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '60s',
    QWEN_MANAGED_AGENT_WORKSPACE_ID: st.workspaceId,
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: node,
    QWEN_MANAGED_AGENT_CLI_ENTRY: st.cli,
    QWEN_MANAGED_AGENT_WORKSPACE_CWD: st.workspace,
    ...st.springEnv,
  };
  for (const [k, v] of Object.entries(env)) if (v === null) delete env[k];
  launch(st, 'spring', java, [
    '-jar', st.jar,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=rig`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=rig-storage`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${st.mount}`,
  ], env);
}
function startHarness(st) {
  const model = readFileSync(path.join(RIG, 'runs', 'model.url'), 'utf8').trim();
  // Deployment model routes: a default, two selectable models with their own
  // keys, one whose key variable is unset, and one id configured twice.
  writeFileSync(path.join(st.harnessHome, '.qwen', 'settings.json'), JSON.stringify({
    security: { auth: { selectedType: 'openai' } },
    model: { name: 'model-default' },
    telemetry: { enabled: false },
    ui: { enableFollowupSuggestions: false },
    modelProviders: {
      openai: [
        { id: 'model-default', envKey: 'RIG_KEY_DEFAULT', baseUrl: model },
        { id: 'model-a', envKey: 'RIG_KEY_A', baseUrl: model },
        { id: 'model-b', envKey: 'RIG_KEY_B', baseUrl: model },
        { id: 'model-nocred', envKey: 'RIG_KEY_NOCRED', baseUrl: model },
        { id: 'model-dup', envKey: 'RIG_KEY_A', baseUrl: model },
        { id: 'model-dup', envKey: 'RIG_KEY_B', baseUrl: model.replace('127.0.0.1', 'localhost') },
      ],
    },
  }, null, 2), { mode: 0o600 });
  const env = {
    ...clean(),
    HOME: st.harnessHome,
    QWEN_HOME: path.join(st.harnessHome, '.qwen'),
    QWEN_CODE_TRUSTED_FOLDERS_PATH: path.join(st.dir, 'trusted.json'),
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: st.digest,
    QWEN_SERVER_TOKEN: st.harnessToken,
    RIG_KEY_DEFAULT: 'key-default',
    RIG_KEY_A: 'key-A',
    RIG_KEY_B: 'key-B',
    ...(st.harnessOpenAiEnv === false ? {} : { OPENAI_API_KEY: 'key-openai-env', OPENAI_BASE_URL: model }),
    QWEN_RUNTIME_BROKER_TOKEN: st.brokerToken,
    QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${st.brokerPort}`,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  };
  launch(st, 'harness', node, [
    st.cli, 'serve', '--profile', 'hosted-harness', '--port', String(st.harnessPort),
    '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', st.workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${st.brokerPort}`,
    `--managed-runtime-broker-token=${st.brokerToken}`,
  ], env);
}
function startHproxy(st) {
  launch(st, 'hproxy', node, [path.join(RIG, 'hproxy.mjs'), String(st.hproxyPort), String(st.harnessPort), path.join(st.dir, 'hproxy.jsonl')], clean());
}
function kill(st, name) {
  const pid = st.pids[name];
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); console.log(`killed ${name} pgid ${pid}`); } catch (e) { console.log(`${name} ${pid}: ${e.code}`); }
  delete st.pids[name];
}

if (cmd === 'init') {
  const [arm, db] = [a1, a2];
  const wt = process.env.WT ?? `/Users/wenshao/git/pr13530-${arm}`;
  const dir = path.join(RIG, 'runs', db);
  const P = Number(a3);
  const st = {
    arm, db, wt, dir,
    cli: process.env.CLI ?? path.join(wt, 'dist', 'cli.js'),
    jar: process.env.JAR ?? path.join(wt, 'packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar'),
    springPort: P, harnessPort: P + 1, brokerPort: P + 2, hproxyPort: P + 3,
    workspace: path.join(dir, 'workspace'), mount: path.join(dir, 'workspace-mount'),
    runtimeHome: path.join(dir, 'runtime-home'), harnessHome: path.join(dir, 'harness-home'),
    runtimeState: path.join(dir, 'runtime-state'),
    harnessToken: randomBytes(24).toString('base64url').replace(/^-/, 'A'),
    brokerToken: randomBytes(24).toString('base64url').replace(/^-/, 'A'),
    credentialKey: randomBytes(32).toString('base64'),
    digest: `sha256:${randomBytes(32).toString('hex')}`,
    springEnv: JSON.parse(process.env.RIG_SPRING_ENV ?? '{}'),
    pids: {},
  };
  st.workspaceId = createHash('sha256').update(st.workspace).digest('hex').slice(0, 16);
  for (const d of [st.workspace, st.mount, path.join(st.runtimeHome, '.qwen'), path.join(st.harnessHome, '.qwen'), st.runtimeState])
    mkdirSync(d, { recursive: true });
  writeFileSync(path.join(st.runtimeHome, '.qwen', 'settings.json'), JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
  writeFileSync(path.join(dir, 'trusted.json'), JSON.stringify({ [st.workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
  sql(null, `CREATE DATABASE IF NOT EXISTS ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  startHproxy(st);
  startSpring(st);
  save(st);
} else if (cmd === 'env') {
  // node stack.mjs env <db> '{"K":"v"}'  -> merge into saved Spring env (null deletes)
  const st = load(a1);
  st.springEnv = { ...st.springEnv, ...JSON.parse(a2) };
  save(st);
  console.log(JSON.stringify(st.springEnv));
} else if (cmd === 'spring' || cmd === 'harness' || cmd === 'hproxy') {
  const st = load(a1);
  kill(st, cmd);
  ({ spring: startSpring, harness: startHarness, hproxy: startHproxy })[cmd](st);
  save(st);
} else if (cmd === 'stop') {
  const st = load(a1);
  for (const n of a2 ? [a2] : Object.keys(st.pids)) kill(st, n);
  save(st);
} else {
  console.error('bad command');
  process.exit(2);
}
