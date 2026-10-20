// Usage: node run-tui.mjs <arm> <scenarioDir> <prompt> <scriptJson> <waitForFile>
// Drives the real interactive TUI in tmux (post-write memory refresh only runs
// there), waits until <waitForFile> is non-empty, then tears down.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [arm, scen, prompt, script, waitFor] = process.argv.slice(2);
const root = '/root/verify/pr14841';
const outDir = path.join(scen, `wire-tui-${arm}-${Date.now()}`);
const env = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_COLOR', 'QWEN_CODE_SIMPLE']) delete env[k];
const fake = spawn('node', [path.join(root, 'harness/fake-server.mjs')], { env: { ...env, OUT_DIR: outDir, SCRIPT: script }, stdio: ['ignore', 'pipe', 'inherit'] });
const baseUrl = await new Promise((r) => fake.stdout.on('data', (d) => { const m = /FAKE_SERVER_READY (\S+)/.exec(String(d)); if (m) r(m[1]); }));
const sess = `pr14841-${arm}-${process.pid}`;
const home = path.join(scen, 'home');
const cmd = [`cd '${path.join(scen, 'proj')}'`, `&& env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u NO_COLOR`,
  `HOME='${home}' USERPROFILE='${home}' QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 TERM=xterm-256color`,
  `node '${path.join(root, `wt-${arm}/dist/cli.js`)}' --approval-mode yolo --auth-type openai --openai-api-key dummy --openai-base-url '${baseUrl}' --model dummy`].join(' ');
execFileSync('tmux', ['new-session', '-d', '-s', sess, '-x', '160', '-y', '45', cmd]);
const pane = () => { try { return execFileSync('tmux', ['capture-pane', '-p', '-t', sess], { encoding: 'utf8' }); } catch { return ''; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t0 = Date.now();
while (!/Type your message/.test(pane()) && Date.now() - t0 < 60000) {
  const p = pane();
  // Accept a first-run trust/theme prompt if one appears.
  if (/Do you trust|trust this folder/i.test(p)) execFileSync('tmux', ['send-keys', '-t', sess, 'Enter']);
  await sleep(500);
}
const ready = /Type your message/.test(pane());
execFileSync('tmux', ['send-keys', '-t', sess, '-l', prompt]);
await sleep(600);
execFileSync('tmux', ['send-keys', '-t', sess, 'Enter']);
t0 = Date.now();
const size = () => { try { return fs.statSync(waitFor).size; } catch { return 0; } };
while (size() === 0 && Date.now() - t0 < 90000) await sleep(500);
await sleep(1500);
const finalPane = pane();
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'pane.txt'), finalPane);
try { execFileSync('tmux', ['kill-session', '-t', sess]); } catch {}
fake.kill();
console.log(JSON.stringify({ arm, ready, waitedMs: Date.now() - t0, indexSize: size(), outDir }));
