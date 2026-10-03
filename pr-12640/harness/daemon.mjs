// Start a real `qwen serve` daemon from an arm's dist with an isolated QWEN_HOME.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';

export async function startDaemon({ arm, home, workspace, port, token = 'tok-12640', log, extraArgs = [], env = {} }) {
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const settings = join(home, 'settings.json');
  if (!existsSync(settings)) {
    writeFileSync(settings, JSON.stringify({
      security: { auth: { selectedType: 'openai' } },
      general: { language: 'en' },
      model: { name: 'fake-model' },
    }, null, 2));
  }
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, [join(arm, 'dist/cli.js'), 'serve', '--port', String(port), '--token', token, '--workspace', workspace, ...extraArgs], {
    env: { ...process.env, QWEN_HOME: home, OPENAI_API_KEY: 'sk-dummy', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_MODEL: 'fake-model', NO_PROXY: '*', no_proxy: '*', HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '', ...env },
    stdio: ['ignore', fd, fd],
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`daemon exited ${child.exitCode}, see ${log}`);
    try {
      const r = await fetch(`${base}/capabilities`, { headers: { authorization: `Bearer ${token}` } });
      if (r.status === 200) { const j = await r.json(); return { child, base, token, capabilities: j, stop: () => stop(child) }; }
    } catch {}
    if (Date.now() > deadline) throw new Error('daemon not ready');
    await new Promise((r) => setTimeout(r, 250));
  }
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
  });
}

export async function get(d, path) {
  const t0 = performance.now();
  const r = await fetch(d.base + path, { headers: { authorization: `Bearer ${d.token}` } });
  const text = await r.text();
  const ms = performance.now() - t0;
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, ms, bytes: Buffer.byteLength(text) };
}
