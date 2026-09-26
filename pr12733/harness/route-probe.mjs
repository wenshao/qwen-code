// Route-boundary witness for PR #12733. Run from the repository root:
//   node route-probe.mjs <label> [hosted|default]
// Spawns dist/cli.js serve (hosted-harness profile or default profile) with an
// isolated home and prints the HTTP/WebSocket status of real daemon routes.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
const cli = path.resolve('dist/cli.js');
const root = await mkdtemp(path.join(tmpdir(), 'hosted-route-probe-'));
await mkdir(path.join(root, '.qwen'));
await writeFile(path.join(root, '.qwen', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'openai' } }, model: { name: 'x' }, telemetry: { enabled: false } }));
const TOKEN = 'probe-token';
const hosted = process.argv[3] !== 'default';
const child = spawn(process.execPath, [cli, 'serve', ...(hosted ? ['--profile', 'hosted-harness', '--hosted-harness-capability-digest', 'sha256:' + 'a'.repeat(64)] : []), '--http-bridge', '--no-web', '--hostname', '127.0.0.1', '--port', '0', '--token', TOKEN, '--workspace', root], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: root, QWEN_HOME: path.join(root, '.qwen'), QWEN_RUNTIME_DIR: path.join(root, 'rt'), OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_MODEL: 'x', NO_COLOR: '1' } });
let out = '';
child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const end = Date.now() + 30000; let base;
while (!(base = out.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1])) { if (Date.now() > end) throw new Error(out); await new Promise((r) => setTimeout(r, 50)); }
let boot;
for (;;) { const r = await fetch(base + '/capabilities', { headers: { Authorization: `Bearer ${TOKEN}` } }); if (r.status === 200) { boot = (await r.json()).hostedHarness?.bootId ?? '00000000-0000-4000-8000-000000000000'; break; } await new Promise((r) => setTimeout(r, 100)); }
const H = { Authorization: `Bearer ${TOKEN}`, 'X-Qwen-Harness-Protocol-Version': '1', 'X-Qwen-Harness-Boot-Id': boot };
const res = {};
res['GET /health (no token)'] = (await fetch(base + '/health')).status;
res['GET /capabilities (no token)'] = (await fetch(base + '/capabilities')).status;
for (const r of ['/', '/workspaces', '/sessions', '/mcp', '/session/unknown/shell', '/daemon/status', '/workspace/settings', '/standalone/sessions', '/workspace-registrations', '/capabilities', '/health']) res['GET ' + r + ' (auth)'] = (await fetch(base + r, { headers: H })).status;
const wsProbe = (p) => new Promise((resolve) => { const ws = new WebSocket(base.replace('http:', 'ws:') + p, { headers: H, handshakeTimeout: 5000 }); ws.once('open', () => { ws.terminate(); resolve('opened'); }); ws.once('unexpected-response', (_q, r) => { r.resume(); resolve('http ' + r.statusCode); }); ws.once('error', (e) => resolve(e.message)); });
res['WS /ws (auth)'] = await wsProbe('/ws');
res['WS /acp (auth)'] = await wsProbe('/acp');
console.log('PROBE ' + JSON.stringify({ label: process.argv[2], res }));
child.kill('SIGTERM'); await new Promise((r) => child.once('close', r)); await rm(root, { recursive: true, force: true });
