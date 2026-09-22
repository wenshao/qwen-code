// Real-daemon probe for PR #12396 (late-registration serve.channels restore).
// Usage: node probe.mjs <armDir> <scenario> <outJson> [extra]
// armDir holds a bundled cli.js (a copy of the repo's dist/). Every oracle is
// wire-level: a real `qwen serve` daemon, the real plugin-example channel
// adapter, and one real WebSocket peer per channel that records every
// connect/close with a timestamp.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net0 from 'node:net';
import wsPkg from '/root/git/qwen-code-x8/node_modules/ws/index.js';

const { WebSocketServer } = wsPkg;
const REPO = '/root/git/qwen-code-x8';
const TOKEN = 'pr12396-probe-token';
const [armDir, scenario, outJson, extra] = process.argv.slice(2);
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
const peers = new Map();
async function peer(name) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.once('listening', r));
  const p = { name, wss, connects: 0, closes: 0, open: 0 };
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
  p.url = `ws://127.0.0.1:${wss.address().port}`;
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
  fs.mkdtempSync(path.join(os.tmpdir(), `pr12396-${scenario}-`)),
);
const qwenHome = path.join(root, 'qwen-home');
const runtimeDir = path.join(root, 'runtime');
fs.mkdirSync(path.join(qwenHome, 'extensions'), { recursive: true });
fs.mkdirSync(runtimeDir);
fs.symlinkSync(
  path.join(REPO, 'packages', 'channels', 'plugin-example'),
  path.join(qwenHome, 'extensions', 'qwen-channel-plugin-example'),
  'dir',
);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};
const ws = (name) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
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
    const timer = setTimeout(() => reject(new Error('no listen')), 30000);
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
  for (let i = 0; i < 400; i++) {
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
  const t = setTimeout(() => daemon.kill('SIGKILL'), 8000);
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
  note('api', {
    method,
    route,
    status: r.status,
    ms: now() - started,
    ...(r.status >= 300 ? { body: json } : {}),
  });
  return { status: r.status, json };
}
const control = async () => (await api('GET', '/workspace/channel')).json;
const controlView = (c) => ({
  enabled: c.enabled,
  selection: c.selection,
  transition: c.transition,
  workers: (c.workers ?? []).map((w) => ({
    ws: path.basename(w.workspaceCwd),
    state: w.state,
    channels: w.channels,
    pid: w.pid,
  })),
});
const register = async (cwd) => {
  const r = await api('POST', '/workspaces', { cwd });
  return r;
};
const remove = async (id) => {
  let r = await api('DELETE', `/workspaces/${id}`, {});
  if (r.status === 409 && r.json?.code === 'workspace_busy') {
    r = await api('DELETE', `/workspaces/${id}`, { force: true });
  }
  return r;
};
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
async function settle(ms = 6000) {
  // Wait until the control plane is idle and has stayed unchanged for 1.5s.
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

// ---------- scenarios ----------
const result = { scenario, arm: path.basename(armDir), extra, steps: [] };
const step = (label, data) => {
  result.steps.push({ t: now(), label, ...data });
};

async function main() {
  if (scenario === 'late') {
    const pa = await peer('a');
    const P = ws('primary');
    const A = ws('wsA');
    trusted.push(P, A);
    writeJson(path.join(A, '.qwen', 'settings.json'), {
      channels: { a: chan(pa, A) },
      serve: { channels: ['a'] },
    });
    finishFixture();
    await startDaemon(P);
    step('boot', { control: controlView(await control()), peers: peerView() });
    const reg = await register(A);
    step('register A', { status: reg.status, ms: reg.ms });
    await waitFor(async () => pa.connects > 0, 10000, 'a connects');
    step('after register', { control: await settle(), peers: peerView() });
  } else if (scenario === 'once-multi') {
    // Sandbox S1 / its Finding 1: two channels, stop one, remove, re-register.
    const p1 = await peer('a1');
    const p2 = await peer('a2');
    const P = ws('primary');
    const A = ws('wsA');
    trusted.push(P, A);
    writeJson(path.join(A, '.qwen', 'settings.json'), {
      channels: { a1: chan(p1, A), a2: chan(p2, A) },
      serve: { channels: ['a1', 'a2'] },
    });
    finishFixture();
    await startDaemon(P);
    const reg = await register(A);
    const id = reg.json.id;
    await waitFor(async () => p1.open > 0 && p2.open > 0, 12000, 'a1+a2 up');
    step('registered A', { control: await settle(), peers: peerView() });
    const stop = await api('POST', `/workspaces/${id}/channels/a1/stop`, {});
    step('operator stops a1', {
      status: stop.status,
      control: await settle(),
      peers: peerView(),
    });
    const rm = await remove(id);
    step('remove A', { status: rm.status, control: await settle(), peers: peerView() });
    const reg2 = await register(A);
    await sleep(4000);
    step('re-register A', {
      status: reg2.status,
      control: await settle(8000),
      peers: peerView(),
    });
  } else if (scenario === 'once-hosted') {
    // Same as once-multi, but the primary keeps hosting its own channel, so
    // removing A does not turn hosting off and the `!enabled` guard cannot
    // stand in for the once-per-daemon record.
    const pp = await peer('p');
    const p1 = await peer('a1');
    const p2 = await peer('a2');
    const P = ws('primary');
    const A = ws('wsA');
    trusted.push(P, A);
    writeJson(path.join(P, '.qwen', 'settings.json'), {
      channels: { p: chan(pp, P) },
      serve: { channels: ['p'] },
    });
    writeJson(path.join(A, '.qwen', 'settings.json'), {
      channels: { a1: chan(p1, A), a2: chan(p2, A) },
      serve: { channels: ['a1', 'a2'] },
    });
    finishFixture();
    await startDaemon(P);
    await waitFor(async () => pp.open > 0, 12000, 'p up');
    const reg = await register(A);
    const id = reg.json.id;
    await waitFor(async () => p1.open > 0 && p2.open > 0, 12000, 'a1+a2 up');
    step('registered A', { control: await settle(), peers: peerView() });
    const stop = await api('POST', `/workspaces/${id}/channels/a1/stop`, {});
    step('operator stops a1', {
      status: stop.status,
      control: await settle(),
      peers: peerView(),
    });
    const rm = await remove(id);
    step('remove A', { status: rm.status, control: await settle(), peers: peerView() });
    const reg2 = await register(A);
    await sleep(4000);
    step('re-register A', {
      status: reg2.status,
      control: await settle(8000),
      peers: peerView(),
    });
  } else if (scenario === 'shared-rereg' || scenario === 'shared-fresh') {
    // Stage-3 finding 1: a late workspace whose listed names are all already
    // hosted. serve.channels lives in user scope (so every workspace lists
    // it); both channels are defined in the primary workspace.
    // A (registered at boot, non-primary) and B/C (registered later) are
    // checkouts of the same repository: identical committed
    // `.qwen/settings.json` defining `bot` and `other` with no `cwd`, and
    // `serve.channels: [bot, other]`.
    const pb = await peer('bot');
    const po = await peer('other');
    const P = ws('primary');
    const A = ws('wsA');
    const B = ws('wsB');
    const C = ws('wsC');
    trusted.push(P, A, B, C);
    const repoSettings = {
      channels: { bot: chan(pb), other: chan(po) },
      serve: { channels: ['bot', 'other'] },
    };
    for (const dir of [A, B, C]) {
      writeJson(path.join(dir, '.qwen', 'settings.json'), repoSettings);
    }
    finishFixture();
    await startDaemon(P, ['--workspace', A]);
    await waitFor(async () => pb.open > 0 && po.open > 0, 12000, 'boot channels up');
    step('boot', { control: await settle(), peers: peerView() });
    const reg = await register(B);
    const id = reg.json.id;
    step('register B (names already hosted)', {
      status: reg.status,
      control: await settle(),
      peers: peerView(),
    });
    const aId = (await api('GET', '/workspace/channel')).json.workers.find(
      (w) => w.workspaceCwd === A,
    )?.workspaceId;
    const stop = await api('POST', `/workspaces/${aId}/channels/bot/stop`, {});
    step('operator stops bot via its owner (A)', {
      status: stop.status,
      control: await settle(),
      peers: peerView(),
    });
    if (scenario === 'shared-rereg') {
      const rm = await remove(id);
      step('remove B', { status: rm.status, control: await settle(), peers: peerView() });
      const reg2 = await register(B);
      await sleep(4000);
      step('re-register B', {
        status: reg2.status,
        control: await settle(8000),
        peers: peerView(),
      });
    } else {
      const reg3 = await register(C);
      await sleep(4000);
      step('register C (never seen before)', {
        status: reg3.status,
        control: await settle(8000),
        peers: peerView(),
      });
    }
  } else if (scenario === 'race') {
    // Stage-3 finding 2: two workspaces registered `gap` ms apart on a daemon
    // that booted with no channels.
    const gap = Number(extra ?? 0);
    const pa = await peer('a');
    const pb = await peer('b');
    const P = ws('primary');
    const A = ws('wsA');
    const B = ws('wsB');
    trusted.push(P, A, B);
    writeJson(path.join(A, '.qwen', 'settings.json'), {
      channels: { a: chan(pa, A) },
      serve: { channels: ['a'] },
    });
    writeJson(path.join(B, '.qwen', 'settings.json'), {
      channels: { b: chan(pb, B) },
      serve: { channels: ['b'] },
    });
    finishFixture();
    await startDaemon(P);
    let regA;
    let regB;
    if (gap < 0) {
      [regA, regB] = await Promise.all([register(A), register(B)]);
    } else {
      regA = await register(A);
      await sleep(gap);
      regB = await register(B);
    }
    step('registered A and B', { gap, statusA: regA.status, statusB: regB.status });
    await sleep(3000);
    step('final', { control: await settle(10000), peers: peerView() });
  } else if (scenario === 'race-stop' || scenario === 'race-delete') {
    // An operator action is still in flight (not awaited) when a workspace
    // registers `delay` ms later. The late restore reads the committed
    // selection in the hook; the operator's change commits afterwards.
    const delay = Number(extra ?? 100);
    const pp = await peer('p');
    const pq = await peer('q');
    const pb = await peer('b');
    const P = ws('primary');
    const B = ws('wsB');
    trusted.push(P, B);
    writeJson(path.join(P, '.qwen', 'settings.json'), {
      channels: { p: chan(pp, P), q: chan(pq, P) },
      serve: { channels: ['p', 'q'] },
    });
    writeJson(path.join(B, '.qwen', 'settings.json'), {
      channels: { b: chan(pb, B) },
      serve: { channels: ['b'] },
    });
    finishFixture();
    await startDaemon(P);
    await waitFor(async () => pp.open > 0 && pq.open > 0, 12000, 'p+q up');
    step('boot', { control: await settle(), peers: peerView() });
    const op =
      scenario === 'race-stop'
        ? api('POST', '/workspace/channels/q/stop', {})
        : api('DELETE', '/workspace/channel');
    await sleep(delay);
    const reg = await register(B);
    const opResult = await op;
    step(scenario === 'race-stop' ? 'operator stop q (in flight) + register B' : 'operator DELETE (in flight) + register B', {
      delay,
      opStatus: opResult.status,
      regStatus: reg.status,
    });
    await sleep(3000);
    step('final', { control: await settle(10000), peers: peerView() });
  } else if (scenario === 'burst') {
    // N workspaces, one channel each, registered concurrently on a daemon that
    // booted with no channels.
    const n = Number(extra ?? 6);
    const P = ws('primary');
    trusted.push(P);
    const dirs = [];
    for (let i = 0; i < n; i++) {
      const p = await peer(`c${i}`);
      const dir = ws(`ws${i}`);
      trusted.push(dir);
      writeJson(path.join(dir, '.qwen', 'settings.json'), {
        channels: { [`c${i}`]: chan(p, dir) },
        serve: { channels: [`c${i}`] },
      });
      dirs.push(dir);
    }
    finishFixture();
    await startDaemon(P);
    const regs = await Promise.all(dirs.map((d) => register(d)));
    step('registered burst', { statuses: regs.map((r) => r.status) });
    await sleep(3000);
    step('final', { control: await settle(15000), peers: peerView() });
  } else if (scenario === 'bystander') {
    // A's channel peer accepts TCP and never answers the WebSocket upgrade, so
    // A's late restore holds the channel control lane until the worker startup
    // budget runs out. C configures no channels at all and registers 300 ms
    // after A.
    const net = await import('node:net');
    const sockets = [];
    const hole = net.createServer((s) => sockets.push(s));
    await new Promise((r) => hole.listen(0, '127.0.0.1', r));
    const holeUrl = `ws://127.0.0.1:${hole.address().port}`;
    const P = ws('primary');
    const A = ws('wsA');
    const C = ws('wsC');
    trusted.push(P, A, C);
    writeJson(path.join(A, '.qwen', 'settings.json'), {
      channels: {
        a: { type: 'plugin-example', serverWsUrl: holeUrl, senderPolicy: 'open', sessionScope: 'user', cwd: A },
      },
      serve: { channels: ['a'] },
    });
    finishFixture();
    await startDaemon(P);
    const regA = await register(A);
    await sleep(300);
    const t = now();
    const regC = await register(C);
    step('register C (no channels) while A restore is in flight', {
      statusA: regA.status,
      statusC: regC.status,
      cRegistrationMs: now() - t,
    });
    step('final', { control: await settle(5000), peers: peerView() });
    for (const s of sockets) s.destroy();
    hole.close();
  } else if (scenario === 'poison') {
    // A's channel points at a closed port, so its late restore fails fast.
    // D is healthy and registers after A's failure has settled.
    const closed = net0.createServer();
    await new Promise((r) => closed.listen(0, '127.0.0.1', r));
    const closedUrl = `ws://127.0.0.1:${closed.address().port}`;
    await new Promise((r) => closed.close(r));
    const pd = await peer('d');
    const P = ws('primary');
    const A = ws('wsA');
    const D = ws('wsD');
    trusted.push(P, A, D);
    writeJson(path.join(A, '.qwen', 'settings.json'), {
      channels: {
        a: { type: 'plugin-example', serverWsUrl: closedUrl, senderPolicy: 'open', sessionScope: 'user', cwd: A },
      },
      serve: { channels: ['a'] },
    });
    writeJson(path.join(D, '.qwen', 'settings.json'), {
      channels: { d: chan(pd, D) },
      serve: { channels: ['d'] },
    });
    finishFixture();
    await startDaemon(P);
    const regA = await register(A);
    await waitFor(
      async () => /not restored/.test(stdout + stderr),
      40000,
      'A restore failed',
    );
    step('A registered, its restore failed', {
      status: regA.status,
      control: await settle(),
    });
    const regD = await register(D);
    await sleep(4000);
    step('register healthy D afterwards', {
      status: regD.status,
      control: await settle(),
      peers: peerView(),
    });
  } else if (scenario === 'globalstop') {
    const pp = await peer('p');
    const pa = await peer('a');
    const P = ws('primary');
    const A = ws('wsA');
    trusted.push(P, A);
    writeJson(path.join(P, '.qwen', 'settings.json'), {
      channels: { p: chan(pp, P) },
      serve: { channels: ['p'] },
    });
    writeJson(path.join(A, '.qwen', 'settings.json'), {
      channels: { a: chan(pa, A) },
      serve: { channels: ['a'] },
    });
    finishFixture();
    await startDaemon(P);
    await waitFor(async () => pp.open > 0, 12000, 'p up');
    const del = await api('DELETE', '/workspace/channel');
    step('DELETE /workspace/channel', { status: del.status, control: await settle(), peers: peerView() });
    const reg = await register(A);
    await sleep(4000);
    step('register A after operator-wide stop', {
      status: reg.status,
      control: await settle(),
      peers: peerView(),
    });
  } else if (scenario === 'flag') {
    const px = await peer('x');
    const pa = await peer('a');
    const P = ws('primary');
    const A = ws('wsA');
    trusted.push(P, A);
    writeJson(path.join(P, '.qwen', 'settings.json'), {
      channels: { x: chan(px, P) },
    });
    writeJson(path.join(A, '.qwen', 'settings.json'), {
      channels: { a: chan(pa, A) },
      serve: { channels: ['a'] },
    });
    finishFixture();
    await startDaemon(P, ['--channel', 'x']);
    await waitFor(async () => px.open > 0, 12000, 'x up');
    const reg = await register(A);
    await sleep(4000);
    step('register A under --channel x', {
      status: reg.status,
      control: await settle(),
      peers: peerView(),
    });
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
await stopDaemon();
for (const p of peers.values()) {
  for (const c of p.wss.clients) c.terminate();
  await new Promise((r) => p.wss.close(r));
}
const logLines = (stdout + '\n' + stderr)
  .split('\n')
  .filter((l) =>
    /serve\.channels|registered after boot|hosting is stopped|not restored|channel worker exited|ambiguous|restoring/i.test(
      l,
    ),
  )
  .slice(0, 60);
result.error = error;
result.events = events;
result.logLines = logLines;
fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
fs.writeFileSync(outJson.replace(/\.json$/, '.daemon.log'), stdout + '\n----- stderr -----\n' + stderr);
fs.rmSync(root, { recursive: true, force: true });
console.log(
  JSON.stringify({
    scenario,
    arm: result.arm,
    extra,
    error: error?.split('\n')[0],
    last: result.steps.at(-1),
  }),
);
