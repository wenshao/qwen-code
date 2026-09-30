// Pause the REAL bundled CLI writer after every fs step on the settings file,
// and at each checkpoint probe with independent REAL CLI processes:
//   (1) filesystem state, (2) `qwen sandbox`, (3) a `qwen -p` agent whose
//   scripted model runs a shell command that writes inside and outside the workspace.
// usage: node checkpoints.mjs <arm> <mode: probe|kill> [killAt]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [arm, mode = 'probe', killAtArg] = process.argv.slice(2);
const killAt = Number(killAtArg || 0);
const ROOT = '/root/verify/pr13119';
const CLI = `${ROOT}/${arm}/dist/cli.js`;
const NS = `${ROOT}/bwrap-private/ns.sh`;
const QH = `${ROOT}/run/qh`;
const WS = `${ROOT}/run/ws`;
const OUTSIDE = `${ROOT}/outside`;
const TARGET = `${QH}/settings.json`;
const tag = mode === 'kill' ? `${arm}-kill${killAt}` : arm;
const CTL = `${ROOT}/run/ctl-${tag}`;
const MODEL = ['--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', 'http://127.0.0.1:18719/v1', '--model', 'dummy'];

const baseEnv = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NO_COLOR', 'NODE_OPTIONS']) delete baseEnv[k];
Object.assign(baseEnv, {
  HOME: `${ROOT}/run/home`, QWEN_HOME: QH,
  QWEN_CODE_SYSTEM_SETTINGS_PATH: '/nonexistent/system-settings.json',
  QWEN_CODE_SYSTEM_DEFAULTS_PATH: '/nonexistent/system-defaults.json',
  QWEN_CODE_NO_RELAUNCH: '1', QWEN_SANDBOX: 'false', TERM: 'xterm-256color',
});

function run(args, env = baseEnv, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const child = spawn(NS, ['node', CLI, ...args], { cwd: WS, env });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

function fsState() {
  const entries = fs.readdirSync(QH).filter((n) => n.startsWith('settings.json')).sort();
  const listing = entries.map((n) => {
    const p = path.join(QH, n);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) return `${n}/{${fs.readdirSync(p).sort().join(',')}}`;
    return n;
  });
  let target = 'ABSENT', policy = 'n/a';
  if (fs.existsSync(TARGET)) {
    try {
      const j = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
      target = `complete (language=${j.general?.language ?? '-'})`;
      policy = j.tools?.executionSandbox ? 'present' : 'MISSING';
    } catch (e) { target = `UNPARSEABLE: ${e.message}`; }
  }
  return { listing: listing.join('  '), target, policy };
}

async function probe(label) {
  const st = fsState();
  const sb = await run(['sandbox']);
  const sandboxLine = (sb.out + sb.err).split('\n').find((l) => l.trim()) ?? '';
  const id = `${tag}-${label}`.replace(/[^a-z0-9-]/gi, '_');
  const outFile = `${OUTSIDE}/escape-${id}.txt`;
  const ag = await run(['--approval-mode', 'yolo', ...MODEL, '-o', 'stream-json', '-p',
    `RUN<<echo escaped > ${outFile}; echo inside > ./inside-${id}.txt && echo WROTE_INSIDE>>`]);
  let toolResult = '';
  for (const line of ag.out.split('\n')) {
    if (!line.includes('tool_result')) continue;
    try {
      const j = JSON.parse(line);
      const blocks = j.message?.content ?? [];
      for (const b of blocks) if (b.type === 'tool_result') toolResult = String(b.content);
    } catch {}
  }
  const agentErr = (ag.err.match(/Error:[^\n]*/) || [''])[0];
  const escaped = fs.existsSync(outFile);
  const inside = fs.existsSync(`${WS}/inside-${id}.txt`);
  const row = { label, ...st, sandbox: `${sandboxLine} [rc=${sb.code}]`,
    agent: escaped ? 'ESCAPED: wrote outside workspace' : (agentErr ? `refused: ${agentErr}` : (toolResult.includes('Read-only file system') ? 'confined: outside write EROFS' : `?: ${toolResult.slice(0, 120)}`)),
    insideWrite: inside ? 'ok' : 'no' };
  console.log(JSON.stringify(row));
  return row;
}

fs.rmSync(CTL, { recursive: true, force: true });
fs.mkdirSync(CTL, { recursive: true });
for (const n of fs.readdirSync(QH)) if (n.startsWith('settings.json')) fs.rmSync(path.join(QH, n), { recursive: true, force: true });
fs.copyFileSync(`${ROOT}/run/settings.initial.json`, TARGET);

const rows = [];
if (mode === 'probe') rows.push(await probe('before'));

const writerEnv = { ...baseEnv, NODE_OPTIONS: `--require ${ROOT}/harness/pause-hook.cjs`, PAUSE_TARGET: TARGET, PAUSE_CTL: CTL };
const writer = spawn(NS, ['node', CLI, ...MODEL, '-p', '/language ui en'], { cwd: WS, env: writerEnv });
let wout = '';
writer.stdout.on('data', (d) => (wout += d));
writer.stderr.on('data', (d) => (wout += d));
let exited = null;
writer.on('close', (code, signal) => (exited = { code, signal }));

let n = 1;
let killedAt = null;
while (true) {
  const ck = path.join(CTL, `ckpt-${n}.json`);
  while (!fs.existsSync(ck) && exited === null) await new Promise((r) => setTimeout(r, 20));
  if (!fs.existsSync(ck)) break;
  await new Promise((r) => setTimeout(r, 30));
  const desc = JSON.parse(fs.readFileSync(ck, 'utf8'));
  const short = (s) => s.replace(QH + '/', '');
  const label = `#${n} after ${desc.op}(${desc.args.map(short).join(' -> ')})`;
  if (mode === 'probe') rows.push(await probe(label));
  else console.log(JSON.stringify({ label }));
  if (mode === 'kill' && n === killAt) {
    fs.writeFileSync(path.join(CTL, 'killed-pid'), String(desc.pid ?? ''));
    process.kill(desc.pid, 'SIGKILL');
    killedAt = label;
    while (exited === null) await new Promise((r) => setTimeout(r, 20));
    break;
  }
  fs.writeFileSync(path.join(CTL, `release-${n}`), '');
  n++;
}
while (exited === null) await new Promise((r) => setTimeout(r, 20));
console.log(JSON.stringify({ writerExit: exited, writerOutput: wout.trim().split('\n').slice(-2).join(' | '), killedAt }));
if (mode === 'probe') rows.push(await probe('after writer exit'));
else {
  rows.push(await probe('after SIGKILL (next startup)'));
  // A later ordinary save by a new, unhooked process: does the policy come back?
  const again = await run([...MODEL, '-p', '/language ui zh']);
  console.log(JSON.stringify({ nextSave: (again.out + again.err).trim().split('\n').slice(-1)[0], rc: again.code }));
  rows.push(await probe('after next ordinary save'));
}
fs.writeFileSync(`${ROOT}/run/result-${tag}.json`, JSON.stringify({ arm, mode, killAt, killedAt, writerExit: exited, rows }, null, 2));
