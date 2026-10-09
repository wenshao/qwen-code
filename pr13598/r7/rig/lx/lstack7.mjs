// Linux durable local-process variant (PR 13598 round 7: PUB=1 at init turns on Tool publication against the fake OSS, container on a LAN arm64 host).
// usage: node lstack6.mjs init <arm r5|r6> <db> <springPort> <harnessPort> <brokerPort> <tapPort> <tapCtl>
//        node stack.mjs spring|harness|tap <db>      (re)start one component
//        node stack.mjs env <db> KEY=VAL...   (extra Spring env, applied on next spring start)
//        node stack.mjs stop <db> [spring|harness]
// Directories are stable per database (workspace id derives from the path).
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync } from 'node:fs';
import path from 'node:path';

const RIG = '/rig';
const ARMS = { r5: '/rig/arms/r5', r6: '/rig/arms/r6', r7: '/rig/arms/r7', r7p: '/rig/arms/r7p', r7m9a: '/rig/arms/r7m9a', r7f: '/rig/arms/r7f' };
const [, , cmd, a1, a2, a3, a4, a5, a6, a7] = process.argv;
const java = 'java';
const node = process.execPath;
const sql = (db, q) =>
  execFileSync('mysql', ['-h127.0.0.1', '-P3306', '-uroot', '-N', '-e', q, ...(db ? [db] : [])], { encoding: 'utf8' });

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
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:3306/${st.db}?useSSL=false&allowPublicKeyRetrieval=true`,
    SPRING_DATASOURCE_USERNAME: 'root',
    SPRING_DATASOURCE_PASSWORD: '',
    QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: st.digest,
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${st.tapPort}`,
    QWEN_MANAGED_AGENT_AUTOMATION_ENABLED: 'true',
    QWEN_MANAGED_AGENT_AUTOMATION_SCAN_DELAY: '5s',
    QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
    QWEN_MANAGED_AGENT_HARNESS_TOKEN: st.harnessToken,
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: 'x-rig-actor',
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'true',
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
    ...(st.springEnv ?? {}),
  };
  const pubJvm = st.pub ? ['-Djdk.net.hosts.file=/rig/oss/tls/hosts', '-Djavax.net.ssl.trustStore=/rig/oss/tls/trust.jks', '-Djavax.net.ssl.trustStorePassword=rigtrust'] : [];
  const pubArgs = st.pub ? [
    '--qwen.managed-agent.tool-publication.enabled=true',
    '--qwen.managed-agent.tool-publication.oss-endpoint=https://oss-cn-hangzhou.aliyuncs.com',
    '--qwen.managed-agent.tool-publication.oss-region=cn-hangzhou',
    '--qwen.managed-agent.tool-publication.oss-bucket=rig-bucket',
    `--qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:${st.springPort}/`,
    '--qwen.managed-agent.tool-publication.execution-bytes=2147483648',
    '--qwen.managed-agent.tool-publication.session-bytes=8589934592',
    '--qwen.managed-agent.tool-publication.tenant-bytes=34359738368',
    '--qwen.managed-agent.tool-publication.active-captures=16',
    '--qwen.managed-agent.tool-publication.entry-concurrency=8',
    '--qwen.managed-agent.tool-publication.operation-timeout=120s',
    '--qwen.managed-agent.tool-publication.claim-timeout=30s',
    '--qwen.managed-agent.tool-publication.verification-bytes-per-second=16777216',
    '--qwen.managed-agent.tool-publication.max-verification-timeout=25m',
    '--qwen.managed-agent.tool-publication.journal-head-authorization=true',
  ] : [];
  if (st.pub) Object.assign(env, { OSS_ACCESS_KEY_ID: 'rig-ak', OSS_ACCESS_KEY_SECRET: 'rig-sk' });
  launch(st, 'spring', java, [
    '-Xmx700m', ...pubJvm, '-jar', st.jar, ...pubArgs,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=rig`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=rig-storage`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${st.mount}`,
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
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: st.modelUrl,
    OPENAI_MODEL: 'fake-model',
    QWEN_MODEL: 'fake-model',
    QWEN_RUNTIME_BROKER_TOKEN: st.brokerToken,
    QWEN_RUNTIME_BROKER_URL: `http://127.0.0.1:${st.brokerPort}`,
    NO_PROXY: '127.0.0.1,localhost',
  };
  launch(st, 'harness', node, [
    st.cli, 'serve', '--profile', 'hosted-harness', '--port', String(st.harnessPort),
    '--hostname', '127.0.0.1', '--require-auth', '--no-web', '--workspace', st.workspace,
    '--managed-runtime-broker-url', `http://127.0.0.1:${st.brokerTapPort ?? st.brokerPort}`,
    `--managed-runtime-broker-token=${st.brokerToken}`,
  ], env);
}
function startTap(st) {
  launch(st, 'tap', node, [path.join(RIG, st.pub && st.inject !== false ? 'tap7.mjs' : 'tap.mjs'), String(st.tapPort), String(st.tapCtl), String(st.harnessPort), path.join(st.dir, 'tap.jsonl'), ...(st.pub && st.inject !== false ? ['268435456'] : [])], clean());
}
function startBrokerTap(st) {
  launch(st, 'btap', node, [path.join(RIG, 'tap.mjs'), String(st.brokerTapPort), String(st.brokerTapPort + 1), String(st.brokerPort), path.join(st.dir, 'broker-tap.jsonl')], { ...clean(), TAP_BODIES: '1' });
}
function kill(st, name) {
  const pid = st.pids[name];
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); console.log(`killed ${name} pgid ${pid}`); } catch (e) { console.log(`${name} ${pid}: ${e.code}`); }
  delete st.pids[name];
}

if (cmd === 'init') {
  const [arm, db] = [a1, a2];
  const wt = ARMS[arm];
  const dir = path.join(RIG, 'runs', db);
  const st = {
    arm, db, wt, dir,
    cli: path.join(wt, 'dist', 'cli.js'),
    jar: path.join(wt, 'server.jar'),
    springPort: Number(a3), harnessPort: Number(a4), brokerPort: Number(a5), tapPort: Number(a6), tapCtl: Number(a7),
    workspace: path.join(dir, 'workspace'), mount: path.join(dir, 'workspace-mount'),
    runtimeHome: path.join(dir, 'runtime-home'), harnessHome: path.join(dir, 'harness-home'),
    runtimeState: path.join(dir, 'runtime-state'),
    harnessToken: randomBytes(24).toString('base64url').replace(/^-/, 'A'),
    brokerToken: randomBytes(24).toString('base64url').replace(/^-/, 'A'),
    credentialKey: randomBytes(32).toString('base64'),
    digest: `sha256:${randomBytes(32).toString('hex')}`,
    modelUrl: 'http://127.0.0.1:18598/v1',
    pub: process.env.PUB === '1',
    inject: process.env.NOINJECT !== '1',
    pids: {},
  };
  st.workspaceId = createHash('sha256').update(st.workspace).digest('hex').slice(0, 16);
  for (const d of [st.workspace, st.mount, path.join(st.runtimeHome, '.qwen'), path.join(st.harnessHome, '.qwen')])
    mkdirSync(d, { recursive: true });
  mkdirSync(st.runtimeState, { recursive: true, mode: 0o700 });
  for (const h of [st.runtimeHome, st.harnessHome])
    writeFileSync(path.join(h, '.qwen', 'settings.json'), JSON.stringify({ ui: { enableFollowupSuggestions: false } }), { mode: 0o600 });
  writeFileSync(path.join(dir, 'trusted.json'), JSON.stringify({ [st.workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
  sql(null, `CREATE DATABASE IF NOT EXISTS ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  startTap(st);
  startSpring(st);
  save(st);
} else if (cmd === 'btap') {
  const st = load(a1);
  st.brokerTapPort = Number(a2);
  kill(st, 'btap');
  startBrokerTap(st);
  save(st);
} else if (cmd === 'spring' || cmd === 'harness' || cmd === 'tap') {
  const st = load(a1);
  kill(st, cmd);
  cmd === 'spring' ? startSpring(st) : cmd === 'harness' ? startHarness(st) : startTap(st);
  save(st);
} else if (cmd === 'env') {
  const st = load(a1);
  st.springEnv = { ...(st.springEnv ?? {}) };
  for (const kv of process.argv.slice(4)) { const i = kv.indexOf('='); if (i < 0) delete st.springEnv[kv]; else st.springEnv[kv.slice(0, i)] = kv.slice(i + 1); }
  console.log(st.springEnv);
  save(st);
} else if (cmd === 'stop') {
  const st = load(a1);
  for (const n of a2 ? [a2] : Object.keys(st.pids)) kill(st, n);
  save(st);
} else {
  console.error('bad command');
  process.exit(2);
}
