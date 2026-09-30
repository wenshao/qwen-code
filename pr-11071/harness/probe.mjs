// Real-daemon probe for PR #11071 (DELETE converges a Channel after config loss).
// Usage: node probe.mjs <armDir> <scenario> <outJson>
// <armDir> holds a bundled cli.js (a copy of the repo's dist/). Every oracle is
// wire-level: a real `qwen serve` daemon, the real plugin-example channel
// adapter running inside real `channel daemon-worker` child processes, and one
// real WebSocket peer per channel that records every connect/close.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import wsPkg from '/root/verify/pr11071/head/node_modules/ws/index.js';

const { WebSocketServer } = wsPkg;
const PLUGIN = '/root/verify/pr11071/head/packages/channels/plugin-example';
const TOKEN = 'pr11071-probe-token';
const [armDir, scenario, outJson] = process.argv.slice(2);
const CLI = path.join(armDir, 'cli.js');
const t0 = Date.now();
const now = () => Date.now() - t0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];
const note = (what, data = {}) => {
  const e = { t: now(), what, ...data };
  events.push(e);
  if (process.env.PROBE_VERBOSE) console.error(JSON.stringify(e));
};

// ---------- channel peers ----------
// kind: 'ok' (answers the upgrade at once), 'slow' (answers after delayMs),
// 'hole' (accepts TCP and never answers -> the worker hits its startup budget).
const peers = new Map();
async function peer(name, kind = 'ok', delayMs = 0) {
  const p = { name, kind, connects: 0, closes: 0, open: 0, tcp: 0 };
  if (kind === 'hole') {
    const socks = new Set();
    const srv = net.createServer((sock) => {
      p.tcp += 1;
      socks.add(sock);
      note('hole_tcp', { channel: name });
      sock.on('error', () => {});
      sock.on('close', () => socks.delete(sock));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    p.close = () => {
      for (const sock of socks) sock.destroy();
      return new Promise((r) => srv.close(r));
    };
    p.srv = srv;
    p.url = `ws://127.0.0.1:${srv.address().port}`;
  } else {
    const wss = new WebSocketServer({ noServer: true });
    const srv = http.createServer();
    const socks = new Set();
    srv.on('connection', (sock) => {
      socks.add(sock);
      sock.on('close', () => socks.delete(sock));
    });
    srv.on('upgrade', (req, sock, head) => {
      p.tcp += 1;
      note('peer_upgrade_req', { channel: name });
      setTimeout(
        () =>
          wss.handleUpgrade(req, sock, head, (ws) =>
            wss.emit('connection', ws, req),
          ),
        kind === 'slow' ? delayMs : 0,
      );
    });
    wss.on('connection', (ws) => {
      p.connects += 1;
      p.open += 1;
      note('peer_connect', { channel: name, connects: p.connects });
      ws.on('close', () => {
        p.closes += 1;
        p.open -= 1;
        note('peer_close', { channel: name, closes: p.closes });
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    p.close = async () => {
      for (const c of wss.clients) c.terminate();
      for (const sock of socks) sock.destroy();
      await new Promise((r) => srv.close(r));
    };
    p.srv = srv;
    p.url = `ws://127.0.0.1:${srv.address().port}`;
  }
  peers.set(name, p);
  return p;
}
const peerView = () =>
  Object.fromEntries(
    [...peers.values()].map((p) => [
      p.name,
      { connects: p.connects, closes: p.closes, open: p.open },
    ]),
  );

// ---------- fixture ----------
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), `pr11071-${scenario}-`)),
);
const qwenHome = path.join(root, 'qwen-home');
const runtimeDir = path.join(root, 'runtime');
fs.mkdirSync(path.join(qwenHome, 'extensions'), { recursive: true });
fs.mkdirSync(runtimeDir);
fs.symlinkSync(
  PLUGIN,
  path.join(qwenHome, 'extensions', 'qwen-channel-plugin-example'),
  'dir',
);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { __error: String(e.code ?? e) };
  }
};
const ws = (name) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const settingsFile = (dir) => path.join(dir, '.qwen', 'settings.json');
const chan = (p, cwd) => ({
  type: 'plugin-example',
  serverWsUrl: p.url,
  senderPolicy: 'open',
  sessionScope: 'user',
  ...(cwd ? { cwd } : {}),
});
const trusted = [];
const trustedPath = path.join(qwenHome, 'trustedFolders.json');
const userSettings = { security: { folderTrust: { enabled: true } } };
const finishFixture = () => {
  writeJson(path.join(qwenHome, 'settings.json'), userSettings);
  writeJson(
    trustedPath,
    Object.fromEntries(trusted.map((d) => [d, 'TRUST_FOLDER'])),
  );
};
const wsId = (cwd) =>
  crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);

// ---------- daemon ----------
let daemon;
let baseUrl;
let stdout = '';
let stderr = '';
async function startDaemon(primary, extraArgs = []) {
  daemon = spawn(
    process.execPath,
    [
      CLI,
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      '0',
      '--no-web',
      '--token',
      TOKEN,
      '--workspace',
      primary,
      '--initialize-timeout-ms',
      '60000',
      ...extraArgs,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        QWEN_HOME: qwenHome,
        QWEN_RUNTIME_DIR: runtimeDir,
        QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedPath,
        OPENAI_API_KEY: 'fake-key',
        OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
        OPENAI_MODEL: 'fake-model',
        QWEN_MODEL: 'fake-model',
      },
    },
  );
  daemon.stdout.on('data', (c) => (stdout += c));
  daemon.stderr.on('data', (c) => (stderr += c));
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no listen')), 60000);
    const tick = setInterval(() => {
      const m = stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearInterval(tick);
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    }, 20);
    daemon.once('exit', (code, sig) => {
      clearInterval(tick);
      clearTimeout(timer);
      reject(new Error(`daemon exited ${code} ${sig}\n${stderr}`));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 2400; i++) {
    const r = await fetch(`${baseUrl}/capabilities`, { headers: H() });
    if (r.status !== 503) break;
    await sleep(25);
  }
  note('daemon_ready', { pid: daemon.pid });
}
async function stopDaemon() {
  if (!daemon || daemon.exitCode !== null) return;
  const exited = new Promise((r) => daemon.once('exit', r));
  daemon.kill('SIGTERM');
  const t = setTimeout(() => daemon.kill('SIGKILL'), 10000);
  await exited;
  clearTimeout(t);
}
const H = (json) => ({
  Authorization: `Bearer ${TOKEN}`,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});
async function api(method, route, body) {
  const started = now();
  const r = await fetch(`${baseUrl}${route}`, {
    method,
    headers: H(body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  const ms = now() - started;
  note('api', {
    method,
    route,
    status: r.status,
    ms,
    ...(r.status >= 300 ? { body: json } : {}),
  });
  return { status: r.status, json, ms };
}
const control = async () => (await api('GET', '/workspace/channel')).json;
const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return !/\) Z /.test(st);
  } catch {
    return false;
  }
};
const controlView = (c) => ({
  enabled: c.enabled,
  selection: c.selection,
  transition: c.transition,
  workers: (c.workers ?? []).map((w) => ({
    ws: path.basename(w.workspaceCwd),
    state: w.state,
    channels: w.channels,
    pid: w.pid,
    alive: alive(w.pid),
  })),
});
// Worker PIDs straight from the process table (children of the daemon).
const workerPids = () => {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (ppid !== daemon.pid) continue;
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0');
      if (cmd.includes('daemon-worker')) out.push(Number(d));
    } catch {}
  }
  return out.sort((a, b) => a - b);
};
const register = (cwd) => api('POST', '/workspaces', { cwd });
async function waitFor(pred, ms, label) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) {
      note('wait_ok', { label });
      return true;
    }
    await sleep(50);
  }
  note('wait_timeout', { label });
  return false;
}
async function settle(ms = 8000) {
  const deadline = Date.now() + ms;
  let last = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const c = await control();
    const key = JSON.stringify([controlView(c), peerView()]);
    if (key !== last) {
      last = key;
      stableSince = Date.now();
    } else if (c.transition === 'idle' && Date.now() - stableSince > 1500) {
      break;
    }
    await sleep(100);
  }
  return controlView(await control());
}
const list = (id) => api('GET', `/workspaces/${id}/channels`);
const del = (id, name, expectedRevision) =>
  api('DELETE', `/workspaces/${id}/channels/${name}`, { expectedRevision });
const brief = (r) => ({
  status: r.status,
  ms: r.ms,
  ...(r.status >= 300
    ? { code: r.json?.code, error: r.json?.error }
    : {
        revision: r.json?.snapshot?.revision,
        instances: Object.keys(r.json?.snapshot?.instances ?? {}),
        instance: r.json?.instance
          ? {
              startsWithServe: r.json.instance.startsWithServe,
              runtime: r.json.instance.runtime,
            }
          : undefined,
      }),
});

// ---------- scenarios ----------
const result = { scenario, arm: path.basename(armDir), steps: [] };
const step = (label, data) => {
  result.steps.push({ t: now(), label, ...data });
  if (process.env.PROBE_VERBOSE) console.error('STEP', label);
};

// Two workspaces A and B, each hosting its own channel from boot.
async function twoWorkspaces() {
  const pa = await peer('botA');
  const pb = await peer('botB');
  const P = ws('primary');
  const A = ws('wsA');
  const B = ws('wsB');
  trusted.push(P, A, B);
  writeJson(settingsFile(A), {
    channels: { botA: chan(pa, A) },
    serve: { channels: ['botA'] },
  });
  writeJson(settingsFile(B), {
    channels: { botB: chan(pb, B) },
    serve: { channels: ['botB'] },
  });
  finishFixture();
  await startDaemon(P, ['--workspace', A, '--workspace', B]);
  await waitFor(
    async () => pa.open > 0 && pb.open > 0,
    20000,
    'botA + botB connected',
  );
  const c = await settle();
  const pidOf = (name) => c.workers.find((w) => w.ws === name)?.pid;
  return { pa, pb, P, A, B, idA: wsId(A), idB: wsId(B), c, pidA: pidOf('wsA'), pidB: pidOf('wsB') };
}
// Remove A's channel config from disk but keep its startup selection.
const loseConfig = (A) => {
  const s = readJson(settingsFile(A));
  delete s.channels.botA;
  if (Object.keys(s.channels).length === 0) delete s.channels;
  writeJson(settingsFile(A), s);
  return s;
};
const world = (f, extra = {}) => ({
  control: f.c,
  peers: peerView(),
  pidA_alive: alive(f.pidA),
  pidB_alive: alive(f.pidB),
  workerPids: workerPids(),
  settingsA: readJson(settingsFile(f.A)),
  ...extra,
});

async function main() {
  if (scenario === 'loss') {
    // Central claim + repeat + other workspace preserved.
    const f = await twoWorkspaces();
    step('boot', world(f, { pidA: f.pidA, pidB: f.pidB }));
    loseConfig(f.A);
    await sleep(3000); // give any watcher a chance to react on its own
    f.c = controlView(await control());
    step('config lost (3s later, no API call yet)', world(f));
    const l1 = await list(f.idA);
    step('GET channels A', {
      status: l1.status,
      revision: l1.json?.revision,
      instances: Object.keys(l1.json?.instances ?? {}),
    });
    const d1 = await del(f.idA, 'botA', l1.json?.revision);
    step('DELETE botA #1', brief(d1));
    f.c = await settle();
    step('after DELETE #1', world(f));
    const l2 = await list(f.idA);
    const d2 = await del(f.idA, 'botA', l2.json?.revision);
    step('DELETE botA #2 (current revision)', brief(d2));
    f.c = await settle();
    step('after DELETE #2', world(f));
  } else if (scenario === 'stale') {
    const f = await twoWorkspaces();
    step('boot', world(f, { pidA: f.pidA, pidB: f.pidB }));
    loseConfig(f.A);
    const before = fs.readFileSync(settingsFile(f.A), 'utf8');
    const d1 = await del(f.idA, 'botA', 'stale-revision');
    step('DELETE botA with stale revision', brief(d1));
    f.c = await settle();
    step('after stale DELETE', world(f, {
      settingsA_byte_identical: fs.readFileSync(settingsFile(f.A), 'utf8') === before,
    }));
  } else if (scenario === 'normal') {
    // Regression control: ordinary configured delete.
    const f = await twoWorkspaces();
    step('boot', world(f, { pidA: f.pidA, pidB: f.pidB }));
    const l1 = await list(f.idA);
    const d1 = await del(f.idA, 'botA', l1.json?.revision);
    step('DELETE configured botA', brief(d1));
    f.c = await settle();
    step('after DELETE', world(f));
  } else if (scenario === 'busy' || scenario === 'busy-start') {
    // Finding: a transition caused by workspace C (unrelated to A) makes A's
    // ordinary configured DELETE fail. C's channel peer never answers, so
    // the transition lasts the worker's startup budget.
    const pc = await peer('slowC', 'hole');
    const C = ws('wsC');
    trusted.push(C);
    writeJson(settingsFile(C), {
      channels: { slowC: chan(pc, C) },
      ...(scenario === 'busy' ? { serve: { channels: ['slowC'] } } : {}),
    });
    const f = await twoWorkspaces();
    step('boot', world(f, { pidA: f.pidA, pidB: f.pidB }));
    let trigger;
    if (scenario === 'busy') {
      // Ordinary lifecycle event: register workspace C at runtime; its
      // serve.channels restore runs on the channel-control lane.
      trigger = register(C);
    } else {
      await register(C);
      trigger = api('POST', `/workspaces/${wsId(C)}/channels/slowC/start`, {});
    }
    await waitFor(
      async () => (await control()).transition !== 'idle',
      10000,
      'manager left idle',
    );
    await waitFor(async () => pc.tcp > 0, 10000, 'slowC worker dialing');
    const mid = await control();
    step('C transition in flight', {
      transition: mid.transition,
      pendingSelection: mid.pendingSelection,
      selection: mid.selection,
    });
    const l1 = await list(f.idA);
    const d1 = await del(f.idA, 'botA', l1.json?.revision);
    step('DELETE configured botA in A (during C transition)', brief(d1));
    f.c = controlView(await control());
    step('right after DELETE', world(f));
    const trig = await trigger;
    step(scenario === 'busy' ? 'register C resolved' : 'start slowC resolved', {
      status: trig.status,
      ms: trig.ms,
      code: trig.json?.code,
    });
    await waitFor(
      async () => (await control()).transition === 'idle',
      60000,
      'manager idle again',
    );
    f.c = await settle(10000);
    step('after settle', world(f));
    if (d1.status !== 200) {
      const l2 = await list(f.idA);
      const d2 = await del(f.idA, 'botA', l2.json?.revision);
      step('retry DELETE botA after settle', brief(d2));
      f.c = await settle();
      step('after retry', world(f));
    }
  } else if (scenario === 'busy-stop' || scenario === 'busy-loss') {
    // Same unrelated transition as busy-start (C starts a channel whose peer
    // never answers). busy-stop: the ordinary POST .../stop for A's botA, a
    // sibling lane-serialized mutation. busy-loss: A's botA lost its config
    // and the missing-config DELETE lands during C's transition.
    const pc = await peer('slowC', 'hole');
    const C = ws('wsC');
    trusted.push(C);
    writeJson(settingsFile(C), { channels: { slowC: chan(pc, C) } });
    const f = await twoWorkspaces();
    step('boot', world(f, { pidA: f.pidA, pidB: f.pidB }));
    await register(C);
    const trigger = api('POST', `/workspaces/${wsId(C)}/channels/slowC/start`, {});
    await waitFor(async () => (await control()).transition !== 'idle', 10000, 'manager left idle');
    await waitFor(async () => pc.tcp > 0, 10000, 'slowC worker dialing');
    if (scenario === 'busy-loss') loseConfig(f.A);
    const mid = await control();
    step('C transition in flight', { transition: mid.transition, pendingSelection: mid.pendingSelection });
    let r1;
    if (scenario === 'busy-stop') {
      r1 = await api('POST', `/workspaces/${f.idA}/channels/botA/stop`, {});
      step('POST stop botA in A (during C transition)', { status: r1.status, ms: r1.ms, code: r1.json?.code });
    } else {
      const l1 = await list(f.idA);
      r1 = await del(f.idA, 'botA', l1.json?.revision);
      step('DELETE config-lost botA in A (during C transition)', brief(r1));
    }
    const trig = await trigger;
    step('start slowC resolved', { status: trig.status, ms: trig.ms, code: trig.json?.code });
    await waitFor(async () => (await control()).transition === 'idle', 60000, 'manager idle again');
    f.c = await settle(10000);
    step('after settle', world(f));
    if (scenario === 'busy-loss' && r1.status !== 200) {
      const l2 = await list(f.idA);
      const d2 = await del(f.idA, 'botA', l2.json?.revision);
      step('retry DELETE botA after settle', brief(d2));
      f.c = await settle();
      step('after retry', world(f));
    }
  } else if (scenario === 'poison') {
    // #11063's stuck state is daemon-wide: while A's lost-config channel is
    // still committed, starting any other channel re-resolves the whole
    // selection and fails. Does DELETE unblock it?
    const pc = await peer('botC');
    const C = ws('wsC');
    trusted.push(C);
    writeJson(settingsFile(C), { channels: { botC: chan(pc, C) } });
    const f = await twoWorkspaces();
    step('boot', world(f, { pidA: f.pidA, pidB: f.pidB }));
    await register(C);
    loseConfig(f.A);
    const s1 = await api('POST', `/workspaces/${wsId(C)}/channels/botC/start`, {});
    step('start botC in C (A lost config)', { status: s1.status, ms: s1.ms, code: s1.json?.code, error: s1.json?.error });
    const l1 = await list(f.idA);
    const d1 = await del(f.idA, 'botA', l1.json?.revision);
    step('DELETE botA in A', brief(d1));
    f.c = await settle();
    const s2 = await api('POST', `/workspaces/${wsId(C)}/channels/botC/start`, {});
    step('start botC in C again', { status: s2.status, ms: s2.ms, code: s2.json?.code, error: s2.json?.error });
    f.c = await settle();
    step('final', world(f));
  } else if (scenario === 'twin-loss') {
    // Two channels lose their config at once (the PR's disclosed limit).
    const f = await twoWorkspaces();
    step('boot', world(f, { pidA: f.pidA, pidB: f.pidB }));
    loseConfig(f.A);
    const sB = readJson(settingsFile(f.B));
    delete sB.channels;
    writeJson(settingsFile(f.B), sB);
    const la = await list(f.idA);
    const da = await del(f.idA, 'botA', la.json?.revision);
    step('DELETE botA in A (botB also lost)', brief(da));
    const lb = await list(f.idB);
    const db = await del(f.idB, 'botB', lb.json?.revision);
    step('DELETE botB in B (botA also lost)', brief(db));
    f.c = await settle();
    step('after both', world(f));
    const off = await api('DELETE', '/workspace/channel', {});
    step('DELETE /workspace/channel (stop all hosting)', { status: off.status, ms: off.ms, code: off.json?.code });
    f.c = await settle();
    const la2 = await list(f.idA);
    const da2 = await del(f.idA, 'botA', la2.json?.revision);
    step('DELETE botA after hosting stop', brief(da2));
    const lb2 = await list(f.idB);
    const db2 = await del(f.idB, 'botB', lb2.json?.revision);
    step('DELETE botB after hosting stop', brief(db2));
    f.c = await settle();
    step('final', world(f, { settingsB: readJson(settingsFile(f.B)) }));
  } else if (scenario === 'samename') {
    // A and B both configure "botX"; B lists it in serve.channels and hosts
    // it (owner hint B). A's botX is configured but not hosted by A. An
    // unrelated transition (C starting a channel whose peer never answers)
    // is in flight when A deletes its own (non-running) botX.
    const pc = await peer('slowC', 'hole');
    const pa = await peer('botXa');
    const pb = await peer('botXb');
    const P = ws('primary');
    const A = ws('wsA');
    const B = ws('wsB');
    const C = ws('wsC');
    trusted.push(P, A, B, C);
    writeJson(settingsFile(A), process.env.STOPPED_ONLY === '1'
      ? { channels: { botS: chan(pa, A) } }
      : { channels: { botX: chan(pa, A) } });
    writeJson(settingsFile(B), {
      channels: { botX: chan(pb, B) },
      serve: { channels: ['botX'] },
    });
    writeJson(settingsFile(C), { channels: { slowC: chan(pc, C) } });
    finishFixture();
    await startDaemon(P, ['--workspace', A, '--workspace', B]);
    await waitFor(async () => pb.open > 0, 20000, 'botX(B) connected');
    const c0 = await settle();
    const idA = wsId(A);
    const l0 = await list(idA);
    step('boot', {
      control: c0,
      peers: peerView(),
      listA: Object.fromEntries(
        Object.entries(l0.json?.instances ?? {}).map(([k, v]) => [k, v.runtime]),
      ),
    });
    if (process.env.SAMENAME_IDLE === '1') {
      const d0 = await del(idA, 'botX', l0.json?.revision);
      step('DELETE A botX (idle)', brief(d0));
      const c1 = await settle();
      step('after idle DELETE', { control: c1, peers: peerView(), settingsA: readJson(settingsFile(A)) });
      return;
    }
    await register(C);
    const trigger = api('POST', `/workspaces/${wsId(C)}/channels/slowC/start`, {});
    await waitFor(async () => (await control()).transition !== 'idle', 10000, 'manager left idle');
    await waitFor(async () => pc.tcp > 0, 10000, 'slowC worker dialing');
    const mid = await control();
    step('C transition in flight', { transition: mid.transition, pendingSelection: mid.pendingSelection });
    const l1 = await list(idA);
    const target = process.env.STOPPED_ONLY === '1' ? 'botS' : 'botX';
    const d1 = await del(idA, target, l1.json?.revision);
    step(`DELETE A ${target} (during C transition)`, brief(d1));
    const trig = await trigger;
    step('start slowC resolved', { status: trig.status, ms: trig.ms, code: trig.json?.code });
    await waitFor(async () => (await control()).transition === 'idle', 60000, 'manager idle again');
    const c2 = await settle(10000);
    step('after settle', { control: c2, peers: peerView(), settingsA: readJson(settingsFile(A)) });
    if (d1.status !== 200) {
      const l2 = await list(idA);
      const d2 = await del(idA, target, l2.json?.revision);
      step(`retry DELETE A ${target} after settle`, brief(d2));
      const c3 = await settle();
      step('after retry', { control: c3, peers: peerView(), settingsA: readJson(settingsFile(A)) });
    }
  } else if (scenario === 'inflight') {
    // The hazard the hoisted guard closes: a configured DELETE that lands
    // while the manager is still bringing that same channel up (a late
    // workspace registration restoring serve.channels). The peer answers the
    // upgrade after 6s so the start eventually succeeds.
    const pp = await peer('botP');
    const pa = await peer('botA', 'slow', 6000);
    const P = ws('primary');
    const A = ws('wsA');
    trusted.push(P, A);
    writeJson(settingsFile(P), {
      channels: { botP: chan(pp, P) },
      serve: { channels: ['botP'] },
    });
    writeJson(settingsFile(A), {
      channels: { botA: chan(pa, A) },
      serve: { channels: ['botA'] },
    });
    finishFixture();
    await startDaemon(P);
    await waitFor(async () => pp.open > 0, 20000, 'botP connected');
    const c0 = await settle();
    step('boot', { control: c0, peers: peerView() });
    const idA = wsId(A);
    const reg = register(A);
    await waitFor(
      async () => (await control()).transition !== 'idle',
      10000,
      'manager left idle',
    );
    if (process.env.INFLIGHT_EARLY !== '1') {
      // The worker has read its config and is dialing the peer.
      await waitFor(async () => pa.tcp > 0, 10000, 'botA worker dialing');
    }
    const mid = await control();
    step('A restore in flight', {
      transition: mid.transition,
      pendingSelection: mid.pendingSelection,
      selection: mid.selection,
      peers: peerView(),
    });
    const l1 = await list(idA);
    step('GET channels A (mid restore)', {
      status: l1.status,
      revision: l1.json?.revision,
      instances: Object.fromEntries(
        Object.entries(l1.json?.instances ?? {}).map(([k, v]) => [k, v.runtime]),
      ),
    });
    const d1 = await del(idA, 'botA', l1.json?.revision);
    step('DELETE configured botA (mid restore)', brief(d1));
    const r = await reg;
    step('register A resolved', { status: r.status, ms: r.ms });
    const c1 = await settle(20000);
    const l2 = await list(idA);
    step('after settle', {
      control: c1,
      peers: peerView(),
      workerPids: workerPids(),
      settingsA: readJson(settingsFile(A)),
      listA: {
        status: l2.status,
        revision: l2.json?.revision,
        instances: Object.keys(l2.json?.instances ?? {}),
      },
    });
    const d2 = await del(idA, 'botA', l2.json?.revision);
    step('DELETE botA again (current revision)', brief(d2));
    const c2 = await settle();
    step('final', {
      control: c2,
      peers: peerView(),
      workerPids: workerPids(),
      settingsA: readJson(settingsFile(A)),
    });
  } else if (scenario === 'samename-starting') {
    // A configures botX but does not host it. B hosts botX (boot owner hint
    // B). B's botX is stopped then started again (peer answers after 6s), so
    // botX is pending-but-uncommitted when A deletes its own copy.
    const pa = await peer('botXa');
    const pb = await peer('botXb', 'slow', 6000);
    const P = ws('primary');
    const A = ws('wsA');
    const B = ws('wsB');
    trusted.push(P, A, B);
    writeJson(settingsFile(A), { channels: { botX: chan(pa, A) } });
    writeJson(settingsFile(B), {
      channels: { botX: chan(pb, B) },
      serve: { channels: ['botX'] },
    });
    finishFixture();
    await startDaemon(P, ['--workspace', A, '--workspace', B]);
    await waitFor(async () => pb.open > 0, 30000, 'botX(B) connected');
    const c0 = await settle();
    step('boot', { control: c0, peers: peerView() });
    const idA = wsId(A);
    const idB = wsId(B);
    const s1 = await api('POST', `/workspaces/${idB}/channels/botX/stop`, {});
    step('stop B botX', { status: s1.status, ms: s1.ms, code: s1.json?.code });
    const c1 = await settle();
    step('after stop', { control: c1, peers: peerView() });
    const tcpBefore = pb.tcp;
    const trigger = api('POST', `/workspaces/${idB}/channels/botX/start`, {});
    await waitFor(async () => (await control()).transition !== 'idle', 10000, 'manager left idle');
    await waitFor(async () => pb.tcp > tcpBefore, 10000, 'botX(B) worker dialing');
    const mid = await control();
    step('B start in flight', { transition: mid.transition, pendingSelection: mid.pendingSelection, selection: mid.selection });
    const l1 = await list(idA);
    const d1 = await del(idA, 'botX', l1.json?.revision);
    step('DELETE A botX (during B start of same name)', brief(d1));
    const trig = await trigger;
    step('start B botX resolved', { status: trig.status, ms: trig.ms, code: trig.json?.code });
    const c2 = await settle(15000);
    step('after settle', { control: c2, peers: peerView(), settingsA: readJson(settingsFile(A)) });
    if (d1.status !== 200) {
      const l2 = await list(idA);
      const d2 = await del(idA, 'botX', l2.json?.revision);
      step('retry DELETE A botX after settle', brief(d2));
      const c3 = await settle();
      step('after retry', { control: c3, peers: peerView(), settingsA: readJson(settingsFile(A)) });
    }
  } else if (scenario === 'all-unrelated' || scenario === 'all-samename') {
    // --channel all hosts the primary only. A (non-primary) configures a
    // channel it never hosts. The primary's mode-all selection is started
    // (peer answers after 6s) while A deletes its channel.
    const pp = await peer('botP', 'slow', 6000);
    const pa = await peer('botA');
    const P = ws('primary');
    const A = ws('wsA');
    trusted.push(P, A);
    const aName = scenario === 'all-samename' ? 'botP' : 'botA';
    writeJson(settingsFile(P), { channels: { botP: chan(pp, P) } });
    writeJson(settingsFile(A), { channels: { [aName]: chan(pa, A) } });
    finishFixture();
    await startDaemon(P, ['--channel', 'all', '--workspace', A]);
    await waitFor(async () => pp.open > 0, 30000, 'botP connected');
    const c0 = await settle();
    step('boot', { control: c0, peers: peerView() });
    const off = await api('DELETE', '/workspace/channel', {});
    step('DELETE /workspace/channel', { status: off.status, ms: off.ms, code: off.json?.code });
    const c1 = await settle();
    step('after hosting stop', { control: c1, peers: peerView() });
    const tcpBefore = pp.tcp;
    const trigger = api('PUT', '/workspace/channel', { selection: { mode: 'all' } });
    await waitFor(async () => (await control()).transition !== 'idle', 10000, 'manager left idle');
    await waitFor(async () => pp.tcp > tcpBefore, 10000, 'botP worker dialing');
    const mid = await control();
    step('mode-all start in flight', { transition: mid.transition, pendingSelection: mid.pendingSelection, selection: mid.selection });
    const idA = wsId(A);
    const l1 = await list(idA);
    const d1 = await del(idA, aName, l1.json?.revision);
    step(`DELETE A ${aName} (during mode-all start)`, brief(d1));
    const trig = await trigger;
    step('PUT all resolved', { status: trig.status, ms: trig.ms, code: trig.json?.code });
    const c2 = await settle(15000);
    step('after settle', { control: c2, peers: peerView(), settingsA: readJson(settingsFile(A)) });
    if (d1.status !== 200) {
      const l2 = await list(idA);
      const d2 = await del(idA, aName, l2.json?.revision);
      step(`retry DELETE A ${aName} after settle`, brief(d2));
      const c3 = await settle();
      step('after retry', { control: c3, peers: peerView(), settingsA: readJson(settingsFile(A)) });
    }
  } else if (scenario === 'all-reload') {
    // --channel all: the primary gains botN on disk after boot; a forced
    // reload re-reads settings (botN peer answers after 6s) while P deletes
    // botN. botN is pending under mode all but not in the committed names.
    const pp = await peer('botP');
    const pn = await peer('botN', 'slow', 6000);
    const P = ws('primary');
    trusted.push(P);
    writeJson(settingsFile(P), { channels: { botP: chan(pp, P) } });
    finishFixture();
    await startDaemon(P, ['--channel', 'all']);
    await waitFor(async () => pp.open > 0, 30000, 'botP connected');
    const c0 = await settle();
    step('boot', { control: c0, peers: peerView() });
    const sP = readJson(settingsFile(P));
    sP.channels.botN = chan(pn, P);
    writeJson(settingsFile(P), sP);
    const idP = wsId(P);
    const l0 = await list(idP);
    step('GET P after botN added on disk', { status: l0.status, instances: Object.fromEntries(Object.entries(l0.json?.instances ?? {}).map(([k, v]) => [k, v.runtime])) });
    const trigger = api('POST', '/workspace/channel/reload', {});
    await waitFor(async () => (await control()).transition !== 'idle', 10000, 'manager left idle');
    await waitFor(async () => pn.tcp > 0, 15000, 'botN worker dialing');
    const mid = await control();
    step('reload in flight', { transition: mid.transition, pendingSelection: mid.pendingSelection, selection: mid.selection });
    const l1 = await list(idP);
    const d1 = await del(idP, 'botN', l1.json?.revision);
    step('DELETE P botN (during reload)', brief(d1));
    const trig = await trigger;
    step('reload resolved', { status: trig.status, ms: trig.ms, code: trig.json?.code });
    const c2 = await settle(20000);
    step('after settle', { control: c2, peers: peerView(), settingsP: readJson(settingsFile(P)) });
    if (d1.status !== 200) {
      const l2 = await list(idP);
      const d2 = await del(idP, 'botN', l2.json?.revision);
      step('retry DELETE P botN after settle', brief(d2));
      const c3 = await settle();
      step('after retry', { control: c3, peers: peerView(), settingsP: readJson(settingsFile(P)) });
    }
  } else if (scenario === 'late-collateral') {
    // v3 exemption (b): A registers late while an unrelated C transition is
    // in flight; A's serve.channels restore [botA, botW] is queued on the
    // lane with names read at registration. DELETE botA lands mid-transition.
    const pp = await peer('botP');
    const pc = await peer('slowC', 'hole');
    const pa = await peer('botA');
    const pw = await peer('botW');
    const P = ws('primary');
    const C = ws('wsC');
    const A = ws('wsA');
    trusted.push(P, C, A);
    writeJson(settingsFile(P), { channels: { botP: chan(pp, P) }, serve: { channels: ['botP'] } });
    writeJson(settingsFile(C), { channels: { slowC: chan(pc, C) } });
    writeJson(settingsFile(A), {
      channels: { botA: chan(pa, A), botW: chan(pw, A) },
      serve: { channels: ['botA', 'botW'] },
    });
    finishFixture();
    await startDaemon(P, ['--workspace', C]);
    await waitFor(async () => pp.open > 0, 20000, 'botP connected');
    step('boot', { control: await settle(), peers: peerView() });
    const trigger = api('POST', `/workspaces/${wsId(C)}/channels/slowC/start`, {});
    await waitFor(async () => (await control()).transition !== 'idle', 10000, 'manager left idle');
    await waitFor(async () => pc.tcp > 0, 10000, 'slowC worker dialing');
    const mid = await control();
    step('C transition in flight', { transition: mid.transition, pendingSelection: mid.pendingSelection });
    const reg = await register(A);
    step('register A (late) resolved', { status: reg.status, ms: reg.ms });
    await sleep(300);
    const idA = wsId(A);
    const l1 = await list(idA);
    step('GET A mid-transition', { status: l1.status, instances: Object.fromEntries(Object.entries(l1.json?.instances ?? {}).map(([k, v]) => [k, v.runtime])) });
    const d1 = await del(idA, 'botA', l1.json?.revision);
    step('DELETE A botA (during C transition, A restore queued)', brief(d1));
    const trig = await trigger;
    step('start slowC resolved', { status: trig.status, ms: trig.ms, code: trig.json?.code });
    await waitFor(async () => (await control()).transition === 'idle', 60000, 'idle');
    const c1 = await settle(20000);
    const l2 = await list(idA);
    step('after settle', {
      control: c1, peers: peerView(), settingsA: readJson(settingsFile(A)),
      listA: Object.fromEntries(Object.entries(l2.json?.instances ?? {}).map(([k, v]) => [k, v.runtime])),
    });
    if (d1.status !== 200) {
      const d2 = await del(idA, 'botA', l2.json?.revision);
      step('retry DELETE A botA after settle', brief(d2));
      const c2 = await settle();
      const l3 = await list(idA);
      step('after retry', {
        control: c2, peers: peerView(), settingsA: readJson(settingsFile(A)),
        listA: Object.fromEntries(Object.entries(l3.json?.instances ?? {}).map(([k, v]) => [k, v.runtime])),
      });
    }
  } else {
    throw new Error(`unknown scenario ${scenario}`);
  }
}

let error;
try {
  await main();
} catch (e) {
  error = String(e?.stack ?? e);
}
const pidsBeforeStop = daemon ? workerPids() : [];
await stopDaemon();
await sleep(300);
const leaked = pidsBeforeStop.filter(alive);
for (const pid of leaked) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}
for (const p of peers.values()) await p.close();
const logLines = (stdout + '\n' + stderr)
  .split('\n')
  .filter((l) =>
    /channel|worker|serve\.channels|restor/i.test(l),
  )
  .slice(0, 80);
result.error = error;
result.leakedWorkers = leaked;
result.events = events;
result.logLines = logLines;
fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
fs.writeFileSync(
  outJson.replace(/\.json$/, '.daemon.log'),
  stdout + '\n----- stderr -----\n' + stderr,
);
fs.rmSync(root, { recursive: true, force: true });
console.log(
  JSON.stringify({
    scenario,
    arm: result.arm,
    error: error?.split('\n')[0],
    leaked,
    steps: result.steps.map((s) => s.label),
  }),
);
