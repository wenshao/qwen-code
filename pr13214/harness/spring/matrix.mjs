// S4: real Spring managed-agent-server startup matrix for the new listener
// posture and v3 window knobs, configured only through the documented env names.
// usage: node matrix.mjs <arm>
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';

const arm = process.argv[2];
const RIG = '/Users/wenshao/pr13214-rig';
const LAN = '192.168.0.93';
const cases = [
  ['default (unset)', {}],
  ['HOST=0.0.0.0', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_HOST: '0.0.0.0' }],
  ['HOST=0.0.0.0 + ALLOW_NON_LOOPBACK=true', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_HOST: '0.0.0.0', QWEN_MANAGED_AGENT_RUNTIME_BROKER_ALLOW_NON_LOOPBACK: 'true' }],
  [`HOST=${LAN} (LAN)`, { QWEN_MANAGED_AGENT_RUNTIME_BROKER_HOST: LAN }],
  ['HOST=localhost', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_HOST: 'localhost' }],
  ['HOST=::1', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_HOST: '::1' }],
  ['HOST=127.0.0.2', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_HOST: '127.0.0.2' }],
  ['HOST=no-such-host.invalid', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_HOST: 'no-such-host.invalid' }],
  ['V3_RESULT_WINDOW=500 (suffix-less)', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_V3_RESULT_WINDOW: '500' }],
  ['V3_RESULT_WINDOW=1s', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_V3_RESULT_WINDOW: '1s' }],
  ['V3_RESULT_WINDOW=45m', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_V3_RESULT_WINDOW: '45m' }],
  ['V3_RESULT_WINDOW=abc', { QWEN_MANAGED_AGENT_RUNTIME_BROKER_V3_RESULT_WINDOW: 'abc' }],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let i = 0;
for (const [name, env] of cases) {
  const port = (arm === 'head' ? 18300 : 18350) + i;
  const bport = (arm === 'head' ? 18400 : 18450) + i;
  i++;
  const state = `${RIG}/spring/state-${arm}-${i}`;
  fs.rmSync(state, { recursive: true, force: true });
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(`${RIG}/spring/ws`, { recursive: true });
  const logFile = `${RIG}/spring/log-${arm}-${i}.txt`;
  const out = fs.openSync(logFile, 'w');
  const child = spawn('/Users/wenshao/Install/jdk21/bin/java', [
    '-Duser.timezone=UTC', `-Dloader.path=${RIG}/spring/adapter.jar`, '-cp', `${RIG}/spring/server-${arm}.jar`,
    'org.springframework.boot.loader.launch.PropertiesLauncher',
  ], {
    stdio: ['ignore', out, out],
    env: {
      PATH: process.env.PATH, HOME: `${RIG}/spring/home`, TZ: 'UTC',
      SERVER_PORT: String(port),
      SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:33214/rig_spring_${arm}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false`,
      SPRING_DATASOURCE_USERNAME: 'root', SPRING_DATASOURCE_PASSWORD: '',
      QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
      QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: 'sha256:' + 'a'.repeat(64),
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(bport),
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: 'rig-token-13214',
      QWEN_MANAGED_AGENT_WORKSPACE_CWD: `${RIG}/spring/ws`,
      QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: state,
      QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'false',
      QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
      QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'rig',
      QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: '/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ=',
      QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
      QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: `/Users/wenshao/git/pr13214-${arm}/dist/cli.js`,
      QWEN_MANAGED_AGENT_CLI_ENTRY: `/Users/wenshao/git/pr13214-${arm}/dist/cli.js`,
      ...env,
    },
  });
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  const deadline = Date.now() + 150000;
  let outcome = 'timeout';
  while (Date.now() < deadline) {
    const text = fs.readFileSync(logFile, 'utf8');
    if (/Started \w+ in/.test(text)) { outcome = 'started'; break; }
    if (exited !== null) { outcome = `exited(${exited})`; break; }
    await sleep(500);
  }
  await sleep(300);
  const text = fs.readFileSync(logFile, 'utf8');
  let listen = '-';
  try {
    listen = execFileSync('lsof', ['-nP', '-a', '-p', String(child.pid), `-iTCP:${bport}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/).slice(-2, -1)[0]).join(',');
  } catch { listen = 'not listening'; }
  const broker = (text.match(/Embedded Runtime Broker listening at \S+/) ?? ['-'])[0];
  const causes = [...text.matchAll(/(?:Caused by|IllegalStateException|IllegalArgumentException|APPLICATION FAILED TO START|Reason|Description)[^\n]*/g)].map((m) => m[0].slice(0, 260));
  const lastCause = causes.filter((c) => c.startsWith('Caused by')).slice(-2);
  const reason = text.match(/Reason: [^\n]*/)?.[0];
  results.push({ name, outcome, broker, listen, reason: reason ?? null, causes: lastCause });
  console.log(JSON.stringify(results.at(-1)));
  if (exited === null) {
    child.kill('SIGTERM');
    for (let k = 0; k < 60 && exited === null; k++) await sleep(500);
    if (exited === null) child.kill('SIGKILL');
  }
}
fs.writeFileSync(`${RIG}/results/spring-matrix-${arm}.json`, JSON.stringify(results, null, 2));
