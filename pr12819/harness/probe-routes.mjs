// Independent route probe: the same packaged dist/cli.js started once with the
// default profile and once with --profile hosted-harness, same token, same
// requests. Prints status + body head for every probe.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const CLI = path.resolve(process.argv[2]);
const TOKEN = 'probe-token';
const DIGEST = `sha256:${'a'.repeat(64)}`;

async function startDaemon(hosted) {
  const root = await mkdtemp(path.join(tmpdir(), 'pr12819-probe-'));
  const config = path.join(root, '.qwen');
  await mkdir(config);
  await writeFile(
    path.join(config, 'settings.json'),
    JSON.stringify({
      security: { auth: { selectedType: 'openai' } },
      model: { name: 'm' },
      telemetry: { enabled: false },
      modelProviders: { openai: [{ id: 'm', envKey: 'OPENAI_API_KEY', baseUrl: 'http://127.0.0.1:9/v1' }] },
    }),
  );
  const args = [CLI, 'serve', ...(hosted ? ['--profile', 'hosted-harness'] : []), '--http-bridge', '--no-web',
    '--hostname', '127.0.0.1', '--port', '0', '--token', TOKEN,
    ...(hosted ? ['--hosted-harness-capability-digest', DIGEST] : []), '--workspace', root];
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: root, QWEN_HOME: config,
    QWEN_RUNTIME_DIR: path.join(root, 'runtime'), OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
    OPENAI_MODEL: 'm', QWEN_SANDBOX: 'false', NO_COLOR: '1',
    QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(root, 'ss.json'), QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(root, 'sd.json') };
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
  const end = Date.now() + 30000;
  let baseUrl;
  while (!(baseUrl = out.match(/qwen serve listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1])) {
    if (Date.now() > end || child.exitCode !== null) throw new Error('startup failed: ' + out.slice(-2000));
    await new Promise((r) => setTimeout(r, 50));
  }
  let bootId = '';
  for (;;) {
    const r = await fetch(baseUrl + '/capabilities', { headers: { Authorization: `Bearer ${TOKEN}`, 'X-Qwen-Harness-Protocol-Version': '1' } });
    if (r.status !== 503) { const j = await r.json().catch(() => ({})); bootId = j.hostedHarness?.bootId ?? ''; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, root, baseUrl, bootId };
}

const sid = randomUUID();
const PROBES = [
  ['health (no auth)', 'GET', '/health', 'none'],
  ['daemon/status (no auth)', 'GET', '/daemon/status', 'none'],
  ['daemon/status', 'GET', '/daemon/status', 'auth'],
  ['workspace/settings', 'GET', '/workspace/settings', 'auth'],
  ['standalone/sessions', 'GET', '/standalone/sessions', 'auth'],
  ['workspace-registrations', 'GET', '/workspace-registrations', 'auth'],
  ['acp (HTTP GET)', 'GET', '/acp', 'auth'],
  ['session/<id>/shell', 'POST', `/session/${sid}/shell`, 'auth'],
  ['session/<id>/mcp-app/tools/call (new on main)', 'POST', `/session/${sid}/mcp-app/tools/call`, 'auth'],
  ['OLD probe /', 'GET', '/', 'auth'],
  ['OLD probe /workspaces', 'GET', '/workspaces', 'auth'],
  ['OLD probe /sessions', 'GET', '/sessions', 'auth'],
  ['OLD probe /mcp', 'GET', '/mcp', 'auth'],
  ['OLD probe GET /session/unknown/shell', 'GET', '/session/unknown/shell', 'auth'],
];

const results = {};
for (const hosted of [false, true]) {
  const d = await startDaemon(hosted);
  const label = hosted ? 'hosted' : 'default';
  results[label] = [];
  const auth = { Authorization: `Bearer ${TOKEN}`, 'X-Qwen-Harness-Protocol-Version': '1', 'X-Qwen-Harness-Boot-Id': d.bootId, 'Content-Type': 'application/json' };
  try {
    for (const [name, method, route, mode] of PROBES) {
      const r = await fetch(d.baseUrl + route, { method, headers: mode === 'none' ? {} : auth, ...(method === 'POST' ? { body: '{}' } : {}) });
      const body = (await r.text()).replace(/\s+/g, ' ').slice(0, 70);
      results[label].push([name, r.status, body]);
    }
    if (hosted) {
      const r = await fetch(d.baseUrl + '/session', { method: 'POST', headers: auth, body: JSON.stringify({ sessionId: sid, sessionScope: 'thread',
        managedSessionStore: { baseUrl: 'http://127.0.0.1:9', tenantId: 't', workspaceId: 'w', writerId: randomUUID(), leaseDurationMs: 60000 } }) });
      results[label].push(['POST /session, store writerId != bootId', r.status, (await r.text()).slice(0, 70)]);
    }
  } finally {
    d.child.kill('SIGTERM');
    await new Promise((r) => d.child.once('close', r));
    await rm(d.root, { recursive: true, force: true });
  }
}
const w = Math.max(...PROBES.map((p) => p[0].length), 40);
console.log('probe'.padEnd(w), '| default profile'.padEnd(34), '| hosted-harness profile');
for (let i = 0; i < results.hosted.length; i++) {
  const [name, hs, hb] = results.hosted[i];
  const dflt = results.default[i];
  const ds = dflt ? `${dflt[1]} ${dflt[2].slice(0, 26)}` : '-';
  console.log(name.padEnd(w), '|', ds.padEnd(32), '|', `${hs} ${hb.slice(0, 40)}`);
}
