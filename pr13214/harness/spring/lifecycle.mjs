// S5: worker lifecycle on Spring shutdown (real managed-agent-server, non-durable
// local-process provisioner as macOS requires, real bundled worker).
// usage: node lifecycle.mjs <arm> <case: healthy|wedged|handshake|sigkill>
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const [arm, kase] = process.argv.slice(2);
const RIG = '/Users/wenshao/pr13214-rig';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = arm === 'head' ? 18501 : 18511;
const bport = arm === 'head' ? 18502 : 18512;
const state = `${RIG}/spring/lc-state-${arm}-${kase}`;
fs.rmSync(state, { recursive: true, force: true });
fs.mkdirSync(state, { recursive: true });
const wrapper = `${RIG}/spring/slow-node.sh`;
fs.writeFileSync(wrapper, `#!/bin/bash\n# a worker still in its ready handshake: ignores SIGTERM, starts late\ntrap '' TERM\nsleep 20\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
const logFile = `${RIG}/spring/lc-${arm}-${kase}.log`;
const out = fs.openSync(logFile, 'w');
const t0 = Date.now();
const at = () => +((Date.now() - t0) / 1000).toFixed(1);
const events = [];
const ev = (what, extra = {}) => { events.push({ t: at(), what, ...extra }); console.log(JSON.stringify(events.at(-1))); };
const server = spawn('/Users/wenshao/Install/jdk21/bin/java', ['-Duser.timezone=UTC', `-Dloader.path=${RIG}/spring/adapter.jar`,
  '-cp', `${RIG}/spring/server-${arm}.jar`, 'org.springframework.boot.loader.launch.PropertiesLauncher'], {
  stdio: ['ignore', out, out],
  env: {
    PATH: process.env.PATH, HOME: `${RIG}/spring/home`, TZ: 'UTC', SERVER_PORT: String(port),
    SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:33214/rig_lc_${arm}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false`,
    SPRING_DATASOURCE_USERNAME: 'root', SPRING_DATASOURCE_PASSWORD: '',
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: 'sha256:' + 'a'.repeat(64),
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true', QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(bport),
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: 'rig-token-13214', QWEN_MANAGED_AGENT_WORKSPACE_CWD: `${RIG}/spring/ws`,
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: state,
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'false', QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY: 'false',
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'rig', QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: '/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ=',
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE: kase === 'handshake' ? wrapper : process.execPath,
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: `/Users/wenshao/git/pr13214-${arm}/dist/cli.js`,
    QWEN_MANAGED_AGENT_CLI_ENTRY: `/Users/wenshao/git/pr13214-${arm}/dist/cli.js`,
  },
});
let serverExit = null;
server.on('exit', (code, signal) => { serverExit = { code, signal, t: at() }; });
for (let i = 0; i < 300 && !/Started \w+ in/.test(fs.readFileSync(logFile, 'utf8')); i++) await sleep(500);
ev('spring started', { pid: server.pid });
const api = `http://127.0.0.1:${port}`;
const created = await fetch(`${api}/v1/agents/sessions`, { method: 'POST', headers: { 'content-type': 'application/json',
  'X-Qwen-Tenant-Id': 't-rig', 'X-Rig-Actor': 'alice', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ agent_id: 'qwen-code' }) });
const sessionJson = await created.json();
const sid = sessionJson.id ?? sessionJson.session_id ?? sessionJson.sessionId;
ev('session created', { status: created.status, sid });
const warmP = fetch(`http://127.0.0.1:${bport}/internal/runtime-broker/v1/runtimes:warm`, { method: 'POST',
  headers: { authorization: 'Bearer rig-token-13214', 'content-type': 'application/json' },
  body: JSON.stringify({ protocolVersion: 1, requestId: randomUUID(), harnessSessionId: sid }) })
  .then(async (r) => ({ status: r.status, body: await r.text() })).catch((e) => ({ error: String(e) }));
const children = () => execFileSync('pgrep', ['-P', String(server.pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
let worker = null;
if (kase === 'handshake') {
  for (let i = 0; i < 40 && !worker; i++) { try { worker = children()[0] ?? null; } catch {} await sleep(100); }
  ev('worker spawned (still in handshake)', { pid: worker });
  await sleep(1500);
} else {
  const warm = await warmP;
  ev('warm answered', { status: warm.status });
  try { worker = children()[0] ?? null; } catch {}
  ev('worker ready', { pid: worker, cmd: worker ? execFileSync('ps', ['-o', 'command=', '-p', String(worker)], { encoding: 'utf8' }).trim().slice(0, 140) : null });
  if (kase === 'wedged') {
    process.kill(worker, 'SIGSTOP');
    ev('worker frozen with SIGSTOP (ignores SIGTERM until killed)');
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sig = kase === 'sigkill' ? 'SIGKILL' : 'SIGTERM';
server.kill(sig);
ev(`${sig} sent to Spring JVM`);
let gone = null;
for (let i = 0; i < 300; i++) {
  if (!gone && worker && !alive(worker)) { gone = at(); ev('worker process gone'); }
  if (serverExit && (gone || i > 120)) break;
  await sleep(100);
}
ev('spring exited', serverExit ?? {});
const survivors = [];
if (worker && alive(worker)) survivors.push(worker);
// a handshake wrapper execs the real worker in place after 20 s; check whether it outlives the Broker
if (kase === 'handshake' && worker && alive(worker)) {
  await sleep(22000);
  ev('22 s later', { alive: alive(worker), cmd: alive(worker) ? execFileSync('ps', ['-o', 'stat=,ppid=,command=', '-p', String(worker)], { encoding: 'utf8' }).trim().slice(0, 160) : null });
}
const summary = { arm, kase, worker, workerGoneAt: gone, signalAt: events.find((e) => e.what.includes('sent'))?.t, serverExit, survivors, events };
fs.writeFileSync(`${RIG}/results/lifecycle-${arm}-${kase}.json`, JSON.stringify(summary, null, 2));
// cleanup strictly by PID
for (const pid of survivors) { try { process.kill(pid, 'SIGKILL'); } catch {} }
console.log(JSON.stringify({ arm, kase, workerGoneAfterSignalSec: gone && +(gone - summary.signalAt).toFixed(1), survivedBroker: survivors.length > 0 }));
process.exit(0);
