// Usage: node run-scenario.mjs <arm> <scenarioDir> <prompt> [scriptJson]
// Boots the fake server, runs the arm's real bundled CLI headless in
// <scenarioDir>/proj with HOME=<scenarioDir>/home, waits for exit.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [arm, scen, prompt, script = '[]'] = process.argv.slice(2);
const root = '/root/verify/pr14841';
const outDir = path.join(scen, `wire-${arm}-${Date.now()}`);
const env = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_COLOR', 'QWEN_CODE_SIMPLE']) delete env[k];

const fake = spawn('node', [path.join(root, 'harness/fake-server.mjs')], {
  env: { ...env, OUT_DIR: outDir, SCRIPT: script }, stdio: ['ignore', 'pipe', 'inherit'],
});
const baseUrl = await new Promise((resolve) => {
  fake.stdout.on('data', (d) => {
    const m = /FAKE_SERVER_READY (\S+)/.exec(String(d));
    if (m) resolve(m[1]);
  });
});
const cli = spawn('node', [path.join(root, `wt-${arm}/dist/cli.js`), '-p', prompt,
  '--approval-mode', 'yolo', '--auth-type', 'openai', '--openai-api-key', 'dummy',
  '--openai-base-url', baseUrl, '--model', 'dummy'], {
  cwd: path.join(scen, 'proj'),
  env: { ...env, HOME: path.join(scen, 'home'), USERPROFILE: path.join(scen, 'home'),
    QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', CI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
cli.stdout.on('data', (d) => (out += d));
cli.stderr.on('data', (d) => (out += d));
const code = await new Promise((r) => cli.on('exit', r));
fake.kill();
fs.writeFileSync(path.join(outDir, 'cli-output.txt'), out);
console.log(JSON.stringify({ arm, code, outDir }));
