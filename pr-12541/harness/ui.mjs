// Drive the real Web Shell served by a real daemon (per arm) and capture the
// sidebar workspace overview + the Extensions manager page.
// Usage: node ui.mjs <distDir> <arm> <outDir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pw from '/root/verify/pr12541/node_modules/playwright-core/index.js';
const { chromium } = pw;

const [distDir, arm, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const TOKEN = 'verify-token-12541';
const w = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), `pr12541-ui-${arm}-`));
const home = path.join(root, '.qwen');
const ws = path.join(root, 'demo-workspace');
fs.mkdirSync(ws, { recursive: true });
w(path.join(home, 'settings.json'), { security: { auth: { selectedType: 'openai' } }, model: { name: 'fake-model' } });
const ext = path.join(home, 'extensions');
w(path.join(ext, 'good', 'qwen-extension.json'), { name: 'good', version: '1.0.0' });
w(path.join(ext, 'my-ext', 'qwen-extension.json'), { name: 'my-ext', version: '1.1.0' });
// `cp -r my-ext my-ext-copy`, then the copy's manifest was bumped.
w(path.join(ext, 'my-ext-copy', 'qwen-extension.json'), { name: 'my-ext', version: '9.9.9' });
w(path.join(ext, 'bad-hook', 'qwen-extension.json'), {
  name: 'bad-hook', version: '1.0.0',
  hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 42 }] }] },
});

const port = 41000 + Math.floor(Math.random() * 5000);
const child = spawn(process.execPath, [path.join(distDir, 'cli.js'), 'serve', '--port', String(port), '--token', TOKEN, '--workspace', ws], {
  cwd: ws,
  env: { ...process.env, QWEN_HOME: home, OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'http://127.0.0.1:9', OPENAI_MODEL: 'fake-model' },
  stdio: ['ignore', fs.openSync(path.join(outDir, `ui-${arm}.daemon.log`), 'w'), 'inherit'],
});
const base = `http://127.0.0.1:${port}`;
try {
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`${base}/capabilities`, { headers: { authorization: `Bearer ${TOKEN}` } }); if (r.status !== 503) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const wire = [];
  page.on('response', async (r) => {
    if (/\/workspaces\/[^/]+\/extensions$/.test(new URL(r.url()).pathname)) {
      try { wire.push(await r.json()); } catch {}
    }
  });
  await page.goto(`${base}/?token=${TOKEN}`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(outDir, `ui-${arm}-full.png`) });
  await page.locator('aside, nav, body').first().getByText('demo-workspace', { exact: true }).first().hover();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outDir, `ui-${arm}-hover.png`) });
  await page.mouse.move(900, 100);
  await page.getByText('Plugins', { exact: true }).first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outDir, `ui-${arm}-plugins.png`) });
  fs.writeFileSync(path.join(outDir, `ui-${arm}-wire.json`), JSON.stringify(wire, null, 2));
  fs.writeFileSync(path.join(outDir, `ui-${arm}-body.txt`), await page.locator('body').innerText());
  await browser.close();
} finally {
  child.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
