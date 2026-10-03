// Real-daemon probe for PR #11071, round 4 (delta cells only).
// Usage: node probe4.mjs <armDir> <scenario> <outJson>
// <armDir> holds a bundled cli.js (a copy of the repo's dist/). Every oracle is
// wire-level: a real `qwen serve` daemon, real `channel daemon-worker` child
// processes, worker liveness read from /proc. Cells:
//   gh-loss            central claim through the REAL built-in GitHub adapter
//                      (fake GitHub REST + scripted OpenAI model): does the
//                      deleted channel keep polling and answering @mentions?
//   drain-<ms>         config-loss DELETE racing daemon SIGTERM after <ms>;
//                      restart on the same files, then retry.
//   home / home-redirect  workspace == $HOME (settings scope collapses to the
//                      user file), with default and redirected QWEN_HOME.
//   userscope-guard    channel configured in USER settings, started by
//                      workspace A's serve.channels; DELETE from A must not
//                      stop it (the R2-1 phantom-delete guard).
//   untrusted          workspace registered without trust.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import wsPkg from '/root/verify/pr11071-r4/head/node_modules/ws/index.js';

const { WebSocketServer } = wsPkg;
const PLUGIN = '/root/verify/pr11071-r4/head/packages/channels/plugin-example';
const TOKEN = 'pr11071-r4-probe-token';
const [armDir, scenario, outJson] = process.argv.slice(2);
const CLI = path.resolve(armDir, 'cli.js');
const t0 = Date.now();
const now = () => Date.now() - t0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];
const note = (what, data = {}) => {
  const e = { t: now(), what, ...data };
  events.push(e);
  if (process.env.PROBE_VERBOSE) console.error(JSON.stringify(e));
};

// ---------- plugin-example peers (one real WebSocket server per channel) ----
const peers = new Map();
async function peer(name) {
  const p = { name, connects: 0, closes: 0, open: 0 };
  const wss = new WebSocketServer({ noServer: true });
  const srv = http.createServer();
  const socks = new Set();
  srv.on('connection', (sock) => {
    socks.add(sock);
    sock.on('close', () => socks.delete(sock));
  });
  srv.on('upgrade', (req, sock, head) =>
    wss.handleUpgrade(req, sock, head, (w) => wss.emit('connection', w, req)),
  );
  wss.on('connection', (w) => {
    p.connects += 1;
    p.open += 1;
    note('peer_connect', { channel: name, connects: p.connects });
    w.on('close', () => {
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
  p.url = `ws://127.0.0.1:${srv.address().port}`;
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

// ---------- fake GitHub REST API (one per channel, so traffic is attributable)
const readBody = (req) =>
  new Promise((r) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(b));
  });
const fakes = new Map();
async function fakeGithub(name) {
  const g = { name, log: [], replies: [], comments: [], notif: null, nextId: 1000 };
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const raw = await readBody(req);
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    const p = url.pathname;
    g.log.push({ t: now(), method: req.method, path: p });
    if (p === '/user') return send(200, { login: 'qwen-bot', id: 1, type: 'User' });
    if (p === '/notifications' && req.method === 'GET')
      return send(200, g.notif ? [g.notif] : []);
    if (p === '/notifications' && req.method === 'PUT') {
      g.notif = null;
      return send(205);
    }
    if (/^\/notifications\/threads\//.test(p)) {
      g.notif = null;
      return send(205);
    }
    if (p === '/repos/acme/app/issues/1/comments' && req.method === 'GET')
      return send(200, g.comments);
    if (p === '/repos/acme/app/issues/1/comments' && req.method === 'POST') {
      const c = {
        id: g.nextId++,
        body: body?.body,
        user: { login: 'qwen-bot' },
        created_at: new Date().toISOString(),
      };
      g.replies.push({ t: now(), body: body?.body });
      note('gh_reply', { channel: name, body: String(body?.body).slice(0, 80) });
      return send(201, c);
    }
    if (/^\/repos\/acme\/app\/issues\/comments\/\d+$/.test(p) && req.method === 'PATCH') {
      g.replies.push({ t: now(), edited: true, body: body?.body });
      return send(200, { id: 1, body: body?.body });
    }
    if (p === '/repos/acme/app/issues/1')
      return send(200, {
        number: 1,
        title: 'Harness issue',
        body: 'issue body',
        user: { login: 'someone' },
        state: 'open',
      });
    if (p === '/repos/acme/app/issues/1/events') return send(200, []);
    if (/reactions/.test(p))
      return send(
        req.method === 'DELETE' ? 204 : 201,
        req.method === 'DELETE' ? undefined : { id: 7, content: body?.content ?? 'eyes' },
      );
    return send(404, { message: 'Not Found' });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  g.url = `http://127.0.0.1:${srv.address().port}`;
  g.inject = (login, text) => {
    const at = new Date().toISOString();
    g.comments.push({
      id: g.nextId++,
      body: text,
      user: { login },
      created_at: at,
      updated_at: at,
      html_url: `https://github.example/acme/app/issues/1#issuecomment-${g.nextId}`,
    });
    g.notif = {
      id: `n${g.nextId}`,
      reason: 'mention',
      unread: true,
      updated_at: new Date(Date.now() + 5).toISOString(),
      last_read_at: new Date(Date.now() - 3600_000).toISOString(),
      subject: { title: 'Harness issue', url: `${g.url}/repos/acme/app/issues/1`, type: 'Issue' },
      repository: { full_name: 'acme/app' },
    };
    note('gh_inject', { channel: name, text });
  };
  g.polls = (from, to = Infinity) =>
    g.log.filter((e) => e.path === '/notifications' && e.method === 'GET' && e.t >= from && e.t < to).length;
  g.close = () => {
    srv.closeAllConnections?.();
    return new Promise((r) => srv.close(r));
  };
  fakes.set(name, g);
  return g;
}
const ghChan = (g, cwd) => ({
  type: 'github',
  token: `ghp_harness_${g.name}`,
  baseUrl: g.url,
  pollInterval: 800,
  groupPolicy: 'open',
  senderPolicy: 'allowlist',
  allowedUsers: ['maintainer'],
  approvalMode: 'yolo',
  cwd,
});
async function askAndWait(g, tag, ms = 20000) {
  g.inject('maintainer', `@qwen-bot ${tag} please take a look`);
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (g.replies.some((r) => String(r.body).includes(`ANSWER ${tag}`))) return 'ANSWERED';
    await sleep(250);
  }
  return 'NO_REPLY';
}

// ---------- scripted OpenAI-compatible model ----------
let modelUrl = 'http://127.0.0.1:9/v1';
const modelLog = [];
async function fakeModel() {
  const flat = (c) =>
    typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? '').join('') : '';
  const srv = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }));
    }
    const parsed = JSON.parse(raw || '{}');
    const users = (parsed.messages ?? []).filter((m) => m.role === 'user');
    const last = flat(users[users.length - 1]?.content);
    const tags = [...last.matchAll(/T-[A-Za-z0-9-]+/g)].map((m) => m[0]);
    const tag = tags[tags.length - 1] ?? 'none';
    modelLog.push({ t: now(), tag });
    const chunk = (delta, finish) => ({
      id: 'c',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'fake-model',
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const c of [
      chunk({ role: 'assistant', content: '' }),
      chunk({ content: `ANSWER ${tag}` }),
      chunk({}, 'stop'),
    ])
      res.write(`data: ${JSON.stringify(c)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  modelUrl = `http://127.0.0.1:${srv.address().port}/v1`;
  return srv;
}

// ---------- fixture ----------
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `pr11071r4-${scenario}-`)));
const homeDir = path.join(root, 'home');
const qwenHome =
  scenario === 'home'
    ? path.join(homeDir, '.qwen')
    : scenario === 'home-redirect'
      ? path.join(root, 'qwen-home-redirected')
      : path.join(root, 'qwen-home');
const runtimeDir = path.join(root, 'runtime');
fs.mkdirSync(path.join(qwenHome, 'extensions'), { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });
fs.mkdirSync(runtimeDir);
fs.symlinkSync(PLUGIN, path.join(qwenHome, 'extensions', 'qwen-channel-plugin-example'), 'dir');
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
const userFile = path.join(qwenHome, 'settings.json');
const chan = (p, cwd) => ({
  type: 'plugin-example',
  serverWsUrl: p.url,
  senderPolicy: 'open',
  sessionScope: 'user',
  ...(cwd ? { cwd } : {}),
});
const trusted = [];
const trustedPath = path.join(qwenHome, 'trustedFolders.json');
const userSettings = {
  security: { folderTrust: { enabled: true }, auth: { selectedType: 'openai' } },
};
const finishFixture = () => {
  // Merge into whatever the scenario already wrote to the user file (home: the
  // user file IS the workspace file).
  const cur = fs.existsSync(userFile) ? readJson(userFile) : {};
  writeJson(userFile, { ...cur, ...userSettings, security: userSettings.security });
  writeJson(trustedPath, Object.fromEntries(trusted.map((d) => [d, 'TRUST_FOLDER'])));
};
const wsId = (cwd) => crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);

// ---------- daemon ----------
let daemon;
let baseUrl;
let stdout = '';
let stderr = '';
const daemonLogs = [];
const daemonEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (/^(QWEN_|OPENAI_|DASHSCOPE_|ANTHROPIC_|GEMINI_)/.test(k) || /_proxy$/i.test(k)) delete env[k];
  return {
    ...env,
    HOME: homeDir,
    QWEN_HOME: qwenHome,
    QWEN_RUNTIME_DIR: runtimeDir,
    QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedPath,
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: modelUrl,
    OPENAI_MODEL: 'fake-model',
    QWEN_MODEL: 'fake-model',
    NO_PROXY: '*',
    no_proxy: '*',
  };
};
async function startDaemon(primary, extraArgs = []) {
  stdout = '';
  stderr = '';
  daemon = spawn(
    process.execPath,
    [CLI, 'serve', '--hostname', '127.0.0.1', '--port', '0', '--no-web', '--token', TOKEN,
      '--workspace', primary, '--initialize-timeout-ms', '60000', ...extraArgs],
    { cwd: primary, stdio: ['ignore', 'pipe', 'pipe'], env: daemonEnv() },
  );
  const rec = { pid: daemon.pid, startedAt: now() };
  daemonLogs.push(rec);
  daemon.stdout.on('data', (c) => (stdout += c));
  daemon.stderr.on('data', (c) => (stderr += c));
  daemon.on('exit', (code, sig) => {
    rec.exit = { code, sig, t: now() };
    rec.stdout = stdout;
    rec.stderr = stderr;
  });
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
async function stopDaemon(signal = 'SIGTERM') {
  if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) return;
  const exited = new Promise((r) => daemon.once('exit', r));
  daemon.kill(signal);
  const t = setTimeout(() => daemon.kill('SIGKILL'), 15000);
  await exited;
  clearTimeout(t);
}
const H = (json) => ({
  Authorization: `Bearer ${TOKEN}`,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});
async function api(method, route, body) {
  const started = now();
  let r;
  try {
    r = await fetch(`${baseUrl}${route}`, {
      method,
      headers: H(body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    const ms = now() - started;
    note('api', { method, route, status: 'ERR', ms, err: String(e.cause?.code ?? e.message) });
    return { status: 'ERR', json: { code: String(e.cause?.code ?? e.message) }, ms };
  }
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  const ms = now() - started;
  note('api', { method, route, status: r.status, ms, ...(r.status >= 300 ? { body: json } : {}) });
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
  enabled: c?.enabled,
  selection: c?.selection,
  transition: c?.transition,
  workers: (c?.workers ?? []).map((w) => ({
    ws: path.basename(w.workspaceCwd),
    state: w.state,
    channels: w.channels,
    pid: w.pid,
    alive: alive(w.pid),
  })),
});
// Every live `daemon-worker` process whose cmdline points at this fixture's
// runtime (not just children of the current daemon: catches orphans that
// outlive a daemon).
const fixtureWorkers = () => {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0');
      if (!cmd.includes('daemon-worker')) continue;
      const env = fs.readFileSync(`/proc/${d}/environ`, 'utf8');
      if (!env.includes(`QWEN_RUNTIME_DIR=${runtimeDir}`)) continue;
      if (alive(Number(d))) out.push(Number(d));
    } catch {}
  }
  return out.sort((a, b) => a - b);
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
    } else if (c?.transition === 'idle' && Date.now() - stableSince > 1500) {
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
  ...(r.status === 'ERR' || r.status >= 300
    ? { code: r.json?.code, error: r.json?.error }
    : { instances: Object.keys(r.json?.snapshot?.instances ?? {}) }),
});

// ---------- scenarios ----------
const result = { scenario, arm: path.basename(armDir), steps: [] };
const step = (label, data) => {
  result.steps.push({ t: now(), label, ...data });
  if (process.env.PROBE_VERBOSE) console.error('STEP', label, JSON.stringify(data).slice(0, 300));
};
const loseConfig = (file, name) => {
  const s = readJson(file);
  delete s.channels[name];
  if (Object.keys(s.channels).length === 0) delete s.channels;
  writeJson(file, s);
  return s;
};
const pidOf = (c, wsName) => c.workers.find((w) => w.ws === wsName)?.pid;

// Two plugin-example workspaces A and B, each hosting its own channel at boot.
async function twoWorkspaces() {
  const pa = await peer('botA');
  const pb = await peer('botB');
  const P = ws('primary');
  const A = ws('wsA');
  const B = ws('wsB');
  trusted.push(P, A, B);
  writeJson(settingsFile(A), { channels: { botA: chan(pa, A) }, serve: { channels: ['botA'] } });
  writeJson(settingsFile(B), { channels: { botB: chan(pb, B) }, serve: { channels: ['botB'] } });
  finishFixture();
  await startDaemon(P, ['--workspace', A, '--workspace', B]);
  await waitFor(async () => pa.open > 0 && pb.open > 0, 20000, 'botA + botB connected');
  const c = await settle();
  return { pa, pb, P, A, B, idA: wsId(A), idB: wsId(B), c, pidA: pidOf(c, 'wsA'), pidB: pidOf(c, 'wsB') };
}

async function main() {
  if (scenario === 'gh-loss') {
    await fakeModel();
    const gA = await fakeGithub('ghA');
    const gB = await fakeGithub('ghB');
    const P = ws('primary');
    const A = ws('wsA');
    const B = ws('wsB');
    trusted.push(P, A, B);
    writeJson(settingsFile(A), { channels: { ghA: ghChan(gA, A) }, serve: { channels: ['ghA'] } });
    writeJson(settingsFile(B), { channels: { ghB: ghChan(gB, B) }, serve: { channels: ['ghB'] } });
    finishFixture();
    await startDaemon(P, ['--workspace', A, '--workspace', B]);
    await waitFor(async () => gA.polls(0) > 1 && gB.polls(0) > 1, 60000, 'ghA + ghB polling');
    let c = await settle();
    const pidA = pidOf(c, 'wsA');
    const pidB = pidOf(c, 'wsB');
    step('boot', { control: c, pidA, pidB, pollsA: gA.polls(0), pollsB: gB.polls(0) });
    const pre = await askAndWait(gA, 'T-pre-A');
    step('mention ghA before config loss', { verdict: pre });
    loseConfig(settingsFile(A), 'ghA');
    await sleep(3000);
    step('config lost (3s later)', { pidA_alive: alive(pidA), settingsA: readJson(settingsFile(A)) });
    const l1 = await list(wsId(A));
    const d1 = await del(wsId(A), 'ghA', l1.json?.revision);
    step('DELETE ghA #1', brief(d1));
    c = await settle();
    const tDel = now();
    await sleep(2000); // let an in-flight poll finish
    const w0 = now();
    await sleep(8000);
    const w1 = now();
    step('after DELETE: 8s observation window', {
      control: c,
      pidA_alive: alive(pidA),
      pidB_alive: alive(pidB),
      pollsA_window: gA.polls(w0, w1),
      pollsB_window: gB.polls(w0, w1),
      windowMs: w1 - w0,
      msSinceDelete: w0 - tDel,
      settingsA: readJson(settingsFile(A)),
    });
    const postA = await askAndWait(gA, 'T-post-A', 15000);
    const postB = await askAndWait(gB, 'T-post-B', 20000);
    step('mentions after DELETE', { ghA: postA, ghB: postB, pidB_alive: alive(pidB) });
    const l2 = await list(wsId(A));
    const d2 = await del(wsId(A), 'ghA', l2.json?.revision);
    step('DELETE ghA #2', brief(d2));
    result.ghTimeline = {
      ghA: gA.log.filter((e) => e.path === '/notifications' && e.method === 'GET').map((e) => e.t),
      ghB: gB.log.filter((e) => e.path === '/notifications' && e.method === 'GET').map((e) => e.t),
      replies: { ghA: gA.replies, ghB: gB.replies },
      deleteAt: tDel,
      lossAt: result.steps.find((s) => s.label.startsWith('config lost')).t - 3000,
    };
  } else if (/^drain(pre)?-\d+$/.test(scenario)) {
    // drain-<ms>: DELETE first, SIGTERM <ms> later. drainpre-<ms>: SIGTERM
    // first, DELETE <ms> later (aims at the daemon_draining window).
    const pre = scenario.startsWith('drainpre');
    const delay = Number(scenario.split('-')[1]);
    const f = await twoWorkspaces();
    step('boot', { control: f.c, pidA: f.pidA, pidB: f.pidB });
    loseConfig(settingsFile(f.A), 'botA');
    const l1 = await list(f.idA);
    const firstDaemon = daemon;
    let pDel;
    let tSig;
    if (pre) {
      tSig = now();
      firstDaemon.kill('SIGTERM');
      if (delay > 0) await sleep(delay);
      pDel = del(f.idA, 'botA', l1.json?.revision);
    } else {
      pDel = del(f.idA, 'botA', l1.json?.revision);
      if (delay > 0) await sleep(delay);
      tSig = now();
      firstDaemon.kill('SIGTERM');
    }
    const d1 = await pDel;
    const exitP = new Promise((r) =>
      firstDaemon.exitCode !== null || firstDaemon.signalCode !== null ? r() : firstDaemon.once('exit', r),
    );
    const killT = setTimeout(() => firstDaemon.kill('SIGKILL'), 15000);
    await exitP;
    clearTimeout(killT);
    await sleep(500);
    step('DELETE vs SIGTERM', {
      order: pre ? 'sigterm-first' : 'delete-first',
      delay,
      sigtermAt: tSig,
      delete: brief(d1),
      daemonExit: { code: firstDaemon.exitCode, sig: firstDaemon.signalCode },
      fixtureWorkersAfterExit: fixtureWorkers(),
      settingsA: readJson(settingsFile(f.A)),
    });
    // Restart on the same files.
    await startDaemon(f.P, ['--workspace', f.A, '--workspace', f.B]);
    await waitFor(async () => f.pb.open > 0, 20000, 'botB reconnected');
    const c2 = await settle();
    const l2 = await list(f.idA);
    step('after restart', {
      control: c2,
      fixtureWorkers: fixtureWorkers(),
      listA: { status: l2.status, instances: Object.keys(l2.json?.instances ?? {}) },
      peers: peerView(),
    });
    const d2 = await del(f.idA, 'botA', l2.json?.revision);
    step('retry DELETE botA after restart', brief(d2));
    const c3 = await settle();
    step('final', {
      control: c3,
      settingsA: readJson(settingsFile(f.A)),
      peers: peerView(),
      fixtureWorkers: fixtureWorkers(),
    });
  } else if (scenario === 'home' || scenario === 'home-redirect') {
    const ph = await peer('botH');
    const pb = await peer('botB');
    const B = ws('wsB');
    trusted.push(homeDir, B);
    // The workspace IS $HOME: channel config and startup selection live in the
    // user settings file (QWEN_HOME/settings.json).
    writeJson(userFile, { channels: { botH: chan(ph, homeDir) }, serve: { channels: ['botH'] } });
    writeJson(settingsFile(B), { channels: { botB: chan(pb, B) }, serve: { channels: ['botB'] } });
    finishFixture();
    const strayWorkspaceFile = settingsFile(homeDir);
    const strayBefore = scenario === 'home-redirect' ? fs.existsSync(strayWorkspaceFile) : undefined;
    await startDaemon(homeDir, ['--workspace', B]);
    // Boot restore reads only the workspace scope's serve.channels, which is
    // disabled for $HOME (pre-existing), so bring botH up through the route.
    await waitFor(async () => pb.open > 0, 20000, 'botB connected');
    const s0 = await api('POST', `/workspaces/${wsId(homeDir)}/channels/botH/start`, {});
    step('start botH via route', { status: s0.status, ms: s0.ms, code: s0.json?.code });
    await waitFor(async () => ph.open > 0, 20000, 'botH connected');
    let c = await settle();
    const pidH = pidOf(c, 'home');
    const pidB = pidOf(c, 'wsB');
    const l0 = await list(wsId(homeDir));
    step('boot', {
      control: c,
      pidH,
      pidB,
      listHome: { status: l0.status, instances: Object.keys(l0.json?.instances ?? {}) },
      userFile: readJson(userFile),
    });
    loseConfig(userFile, 'botH');
    await sleep(2000);
    const l1 = await list(wsId(homeDir));
    step('config lost from user file', {
      listHome: { status: l1.status, instances: Object.keys(l1.json?.instances ?? {}) },
      pidH_alive: alive(pidH),
    });
    const d1 = await del(wsId(homeDir), 'botH', l1.json?.revision);
    step('DELETE botH #1', brief(d1));
    c = await settle();
    step('after DELETE #1', {
      control: c,
      pidH_alive: alive(pidH),
      pidB_alive: alive(pidB),
      peers: peerView(),
      userFile: readJson(userFile),
      strayWorkspaceFile: fs.existsSync(strayWorkspaceFile) ? readJson(strayWorkspaceFile) : null,
      strayBefore,
    });
    const l2 = await list(wsId(homeDir));
    const d2 = await del(wsId(homeDir), 'botH', l2.json?.revision);
    step('DELETE botH #2', brief(d2));
    // Restart: does the stale selection come back?
    await stopDaemon();
    await startDaemon(homeDir, ['--workspace', B]);
    await waitFor(async () => pb.open > 0, 20000, 'botB reconnected');
    c = await settle();
    step('after restart', {
      control: c,
      peers: peerView(),
      userFile: readJson(userFile),
      fixtureWorkers: fixtureWorkers(),
    });
  } else if (scenario === 'userscope-guard') {
    const pu = await peer('botU');
    const P = ws('primary');
    const A = ws('wsA');
    trusted.push(P, A);
    // Config lives in USER settings; workspace A only selects it.
    writeJson(userFile, { channels: { botU: chan(pu, A) } });
    writeJson(settingsFile(A), { serve: { channels: ['botU'] } });
    finishFixture();
    await startDaemon(P, ['--workspace', A]);
    await waitFor(async () => pu.open > 0, 20000, 'botU connected');
    let c = await settle();
    const pidU = pidOf(c, 'wsA');
    const l1 = await list(wsId(A));
    step('boot', {
      control: c,
      pidU,
      listA: { status: l1.status, revision: l1.json?.revision, instances: Object.keys(l1.json?.instances ?? {}) },
    });
    const d1 = await del(wsId(A), 'botU', l1.json?.revision);
    step('DELETE botU from A (config in user scope)', brief(d1));
    c = await settle();
    step('after DELETE', {
      control: c,
      pidU_alive: alive(pidU),
      peers: peerView(),
      settingsA: readJson(settingsFile(A)),
      userFile: readJson(userFile),
    });
  } else if (scenario === 'untrusted') {
    const pu = await peer('botX');
    const P = ws('primary');
    const U = ws('wsU');
    trusted.push(P);
    writeJson(settingsFile(U), { channels: { botX: chan(pu, U) }, serve: { channels: ['botX'] } });
    finishFixture();
    await startDaemon(P);
    const r = await api('POST', '/workspaces', { cwd: U });
    step('register untrusted U', { status: r.status, code: r.json?.code, trusted: r.json?.trusted ?? r.json?.workspace?.trusted });
    loseConfig(settingsFile(U), 'botX');
    const before = fs.readFileSync(settingsFile(U), 'utf8');
    const l1 = await list(wsId(U));
    step('GET channels U', { status: l1.status, code: l1.json?.code });
    const d1 = await del(wsId(U), 'botX', 'any-revision');
    step('DELETE botX in U', brief(d1));
    step('after', {
      settingsU_byte_identical: fs.readFileSync(settingsFile(U), 'utf8') === before,
      peers: peerView(),
      fixtureWorkers: fixtureWorkers(),
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
await sleep(500);
const leaked = fixtureWorkers();
for (const pid of leaked) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}
for (const p of peers.values()) await p.close();
for (const g of fakes.values()) await g.close();
result.error = error;
result.leakedWorkers = leaked;
result.events = events;
result.modelCalls = modelLog;
result.daemons = daemonLogs.map(({ pid, startedAt, exit }) => ({ pid, startedAt, exit }));
fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
fs.writeFileSync(
  outJson.replace(/\.json$/, '.daemon.log'),
  daemonLogs
    .map((d, i) => `===== daemon #${i + 1} pid ${d.pid}\n${d.stdout ?? stdout}\n----- stderr -----\n${d.stderr ?? stderr}`)
    .join('\n'),
);
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ scenario, arm: result.arm, error: error?.split('\n')[0], leaked, steps: result.steps.map((s) => s.label) }));
process.exit(0);
