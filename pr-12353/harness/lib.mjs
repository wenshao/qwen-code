// Shared helpers: isolated QWEN_HOME + workspaces, a recording fake provider,
// a real `qwen serve` daemon from an arm's bundle, and process introspection.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const ROOT = '/root/verify/pr12353-work';
export const PROBE = path.join(ROOT, 'harness/probe.cjs');
export const TOKEN = 'pr12353-verify-token';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeRun(name) {
  const dir = path.join(ROOT, 'runs', name);
  fs.rmSync(dir, { recursive: true, force: true });
  const home = path.join(dir, 'home');
  const qhome = path.join(home, '.qwen');
  const probeDir = path.join(dir, 'probe');
  for (const d of [qhome, probeDir]) fs.mkdirSync(d, { recursive: true });
  const ws = {};
  for (const w of ['primary', 'secondary', 'dynamic', 'extra']) {
    const p = path.join(dir, 'ws', w);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'README.md'), `# ${w}\n`);
    execFileSync('git', ['init', '-q'], { cwd: p });
    ws[w] = p;
  }
  fs.writeFileSync(
    path.join(qhome, 'trustedFolders.json'),
    JSON.stringify(Object.fromEntries(Object.values(ws).map((p) => [p, 'TRUST_FOLDER']))),
  );
  return { dir, home, qhome, probeDir, ws };
}

// Any request reaching the "provider" is recorded; the lifecycle must make none.
export async function startFakeProvider(run) {
  const log = path.join(run.dir, 'provider-requests.jsonl');
  fs.writeFileSync(log, '');
  const server = http.createServer((req, res) => {
    fs.appendFileSync(log, JSON.stringify({ method: req.method, url: req.url }) + '\n');
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"no model in this harness"}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  fs.writeFileSync(
    path.join(run.qhome, 'settings.json'),
    JSON.stringify({
      security: { auth: { selectedType: 'openai', apiKey: 'dummy', baseUrl } },
      model: { name: 'fake-model' },
    }),
  );
  return {
    baseUrl,
    count: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length,
    close: () => new Promise((r) => server.close(r)),
  };
}

export function cleanEnv() {
  const env = { ...process.env };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_COLOR', 'NODE_OPTIONS', 'DEV']) delete env[k];
  return env;
}

export async function startDaemon(run, { arm, nodeBin = 'node', nodeArgs = [], serveArgs = [], env = {}, provider, wrap = [] }) {
  const cli = path.join(`/root/verify/pr12353-${arm}`, 'dist/cli.js');
  const argv = [...wrap, nodeBin, ...nodeArgs, cli, 'serve', '--port', '0', '--token', TOKEN, '--no-web', ...serveArgs];
  const fullEnv = {
    ...cleanEnv(),
    HOME: run.home,
    QWEN_HOME: run.qhome,
    OPENAI_BASE_URL: provider?.baseUrl ?? 'http://127.0.0.1:9/v1',
    OPENAI_API_KEY: 'dummy',
    OPENAI_MODEL: 'fake-model',
    QWEN_SANDBOX: 'false',
    PR12353_PROBE_DIR: run.probeDir,
    ...env,
  };
  const child = spawn(argv[0], argv.slice(1), { cwd: run.ws.primary, env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const logPath = path.join(run.dir, 'daemon.log');
  const dlog = fs.createWriteStream(logPath);
  let exited = null;
  const exitP = new Promise((r) => child.on('exit', (code, sig) => { exited = { code, sig }; r(exited); }));
  const url = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 60000);
    const onData = (d) => {
      dlog.write(d);
      const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(String(d));
      if (m) { clearTimeout(t); resolve(m[1]); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    exitP.then(() => { clearTimeout(t); resolve(null); });
  });
  const api = async (method, p, body) => {
    const t0 = Date.now();
    const res = await fetch(url + p, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, ms: Date.now() - t0 };
  };
  if (url) {
    // The listener is up before the runtime; wait until routes stop answering 503.
    for (let i = 0; i < 200; i++) {
      const r = await api('GET', '/daemon/status').catch(() => null);
      if (r && r.status === 200 && !JSON.stringify(r.json.issues ?? []).includes('daemon_runtime_starting')) break;
      await sleep(250);
    }
  }
  return {
    child,
    url,
    api,
    logPath,
    exited: () => exited,
    exitP,
    log: () => fs.readFileSync(logPath, 'utf8'),
    stop: async () => {
      if (!exited) child.kill('SIGTERM');
      await Promise.race([exitP, sleep(20000)]);
      if (!exited) child.kill('SIGKILL');
      await exitP;
      dlog.end();
    },
  };
}

export function probes(run) {
  return fs.readdirSync(run.probeDir).map((f) => JSON.parse(fs.readFileSync(path.join(run.probeDir, f), 'utf8')));
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function procCmdline(pid) {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { return null; }
}

export function procEnvKeys(pid, keys) {
  try {
    const env = Object.fromEntries(
      fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    return Object.fromEntries(keys.map((k) => [k, env[k] ?? null]));
  } catch { return null; }
}

// Live ACP children of a daemon pid, from the process table (not from the probe).
export function acpChildren(daemonPid) {
  let out = '';
  try { out = execFileSync('ps', ['-o', 'pid=', '--ppid', String(daemonPid)], { encoding: 'utf8' }); } catch { return []; }
  return out.split('\n').map((s) => Number(s.trim())).filter(Boolean).filter((pid) => (procCmdline(pid) ?? []).includes('--acp'));
}

export function heapFlags(argv) {
  return (argv ?? []).filter((a) => /^--max[-_]old[-_]space[-_]size/.test(a) || /^--expose[-_]gc$/.test(a));
}

export function childView(pid, run) {
  const probe = probes(run).find((p) => p.pid === pid) ?? null;
  const cmd = procCmdline(pid);
  return {
    pid,
    alive: alive(pid),
    cmdlineHeapFlags: heapFlags(cmd),
    cmdlineOther: cmd ? cmd.slice(1, cmd.indexOf(cmd.find((a) => a.endsWith('cli.js')))).filter((a) => !heapFlags([a]).length) : null,
    env: procEnvKeys(pid, ['NODE_OPTIONS', 'QWEN_CODE_SERVE', 'DEV']),
    v8HeapSizeLimitMb: probe?.heapSizeLimitMb ?? null,
    gcExposed: probe?.gcExposed ?? null,
    probeLoadedVia: probe?.loadedVia ?? null,
    childSawNodeOptions: probe?.nodeOptions ?? null,
    cwd: (() => { try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; } })(),
  };
}

export async function waitFor(pred, ms = 30000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await pred();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

export function memoryStatus(statusJson) {
  const m = statusJson?.limits?.memory ?? statusJson?.status?.limits?.memory ?? null;
  return m;
}
