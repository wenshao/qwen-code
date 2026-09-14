// Usage: node ui.mjs <arm> <distDir>
// Drives the real `qwen serve` Web Shell (served from <distDir>/web-shell) with
// Playwright and records the managed DWS channel editor: field layout, the
// dmPolicy round-trip through <workspace>/.qwen/settings.json, and the legacy
// channel default. Screenshots land in runs/ui-<arm>/shots.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { RIG, RUNS, sleep, note } from './lib.mjs';

const [arm, distDir] = process.argv.slice(2);
const require = createRequire(path.join(RIG, '..', 'wt-head', 'package.json'));
const { chromium } = require('playwright');

const dir = path.join(RUNS, `ui-${arm}`);
fs.rmSync(dir, { recursive: true, force: true });
const home = path.join(dir, 'qwen-home');
const runtime = path.join(dir, 'runtime');
const ws = path.join(dir, 'ws');
const shots = path.join(dir, 'shots');
for (const d of [home, runtime, path.join(ws, '.qwen'), shots]) fs.mkdirSync(d, { recursive: true });
const run = { dir, arm };

fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'openai' } } }, null, 2));
// A pre-existing managed channel that was saved before dmPolicy existed.
const wsSettingsPath = path.join(ws, '.qwen', 'settings.json');
fs.writeFileSync(wsSettingsPath, JSON.stringify({
  channels: {
    'dws-legacy': { type: 'dws', profile: 'probe-profile', senderPolicy: 'open', groupPolicy: 'open', watchTodos: false },
  },
}, null, 2) + '\n');

const readWsSettings = () => JSON.parse(fs.readFileSync(wsSettingsPath, 'utf8'));

async function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/_proxy$/i.test(key) || key === 'NODE_OPTIONS') delete env[key];
  return env;
}

const port = await freePort();
const log = fs.openSync(path.join(dir, 'serve.log'), 'a');
const serve = spawn(process.execPath, [path.join(distDir, 'cli.js'), 'serve', '--workspace', ws, '--port', String(port), '--hostname', '127.0.0.1'], {
  cwd: ws,
  env: { ...cleanEnv(), QWEN_HOME: home, QWEN_RUNTIME_DIR: runtime, QWEN_CODE_NO_RELAUNCH: 'true', OPENAI_API_KEY: 'dummy', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_MODEL: 'dummy', PATH: `${path.join(RIG, 'bin')}:${process.env.PATH}`, DWS_RIG_DIR: path.join(dir, 'dws'), NO_COLOR: '1' },
  stdio: ['ignore', log, log],
  detached: true,
});
note(run, `serve pid ${serve.pid} port ${port}`);
const base = `http://127.0.0.1:${port}`;
let healthy = false;
for (let i = 0; i < 120 && !healthy; i++) {
  try { const r = await fetch(`${base}/health`); healthy = r.ok; } catch { /* not yet */ }
  if (!healthy) await sleep(500);
}
if (!healthy) { note(run, 'daemon never became healthy'); process.kill(-serve.pid, 'SIGKILL'); process.exit(1); }
note(run, 'daemon healthy');

const types = await (await fetch(`${base}/workspace/channel-types`)).json();
fs.writeFileSync(path.join(dir, 'channel-types.json'), JSON.stringify(types, null, 2));
const dwsDescriptor = (types.channelTypes ?? types.types ?? types).find?.((t) => t.type === 'dws') ?? (Array.isArray(types) ? types.find((t) => t.type === 'dws') : undefined);
const dwsFields = (dwsDescriptor?.fields ?? []).map((f) => `${f.key}:${f.kind}${f.default !== undefined ? `=${f.default}` : ''}`);
note(run, `dws descriptor fields: ${dwsFields.join(', ')}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1500 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const page = await context.newPage();
const result = { arm, dwsFields, steps: [] };
const step = (name, data) => { result.steps.push({ name, ...data }); note(run, `${name}: ${JSON.stringify(data)}`); };

async function openShell(lang) {
  await page.goto(`${base}/?lang=${lang}`);
  await page.locator('[data-web-shell-root]:not([data-web-shell-gate])').waitFor({ timeout: 60_000 });
  await page.getByText('Loading...').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => undefined);
}

async function shot(name, locator) {
  const file = path.join(shots, `${name}.png`);
  if (locator) await locator.screenshot({ path: file }); else await page.screenshot({ path: file });
  note(run, `screenshot ${file}`);
  return file;
}

async function dialogState(dialog) {
  const labels = ['Sender policy', 'Sender Policy', 'Direct message access', 'Direct Message Access', 'Group policy', 'Group Policy', 'Allowed users', 'Watch native todos', 'Watch Native Todos'];
  const state = {};
  for (const label of labels) {
    const l = dialog.getByLabel(new RegExp(`^${label}\\*?$`));
    const n = await l.count();
    if (n > 0) state[label] = (await l.first().textContent())?.trim();
  }
  return state;
}

// ---- English: create a group-only channel via the editor ----
await openShell('en');
await page.getByRole('button', { name: 'Channels' }).click();
await page.getByRole('button', { name: /Configure DingTalk Workspace/ }).waitFor({ timeout: 30_000 });
await shot('01-channels-page');
await page.getByRole('button', { name: /Configure DingTalk Workspace/ }).click();
let dialog = page.getByRole('dialog');
await dialog.getByRole('heading', { name: /DingTalk Workspace/ }).waitFor();
await dialog.getByLabel('Instance name').fill('dws-group-only');
await sleep(300);
const domDump = await dialog.evaluate((root) => ({
  labels: [...root.querySelectorAll('label')].map((l) => ({ text: l.textContent?.trim().slice(0, 60), for: l.getAttribute('for') })),
  combos: [...root.querySelectorAll('[role="combobox"]')].map((c) => ({ id: c.id, labelledby: c.getAttribute('aria-labelledby'), label: c.getAttribute('aria-label'), text: c.textContent?.trim().slice(0, 40) })),
  headings: [...root.querySelectorAll('h2,h3')].map((h) => h.textContent?.trim()),
}));
fs.writeFileSync(path.join(dir, 'dom-dump.json'), JSON.stringify(domDump, null, 2));
step('create-dialog-initial', await dialogState(dialog));
await shot('02-create-dialog', dialog);
const accessHeading = dialog.getByRole('heading', { name: /Access/ });
if (await accessHeading.count()) {
  const section = accessHeading.locator('xpath=ancestor::section[1]');
  await shot('03-create-access-section', section);
}
const dmAccess = dialog.getByLabel(/^Direct message access\*?$/);
const hasDmAccess = (await dmAccess.count()) > 0;
if (hasDmAccess) {
  await dmAccess.click();
  await page.getByRole('option', { name: 'Disabled' }).click();
}
const groupPolicy = dialog.getByLabel(/Group policy/i);
if (await groupPolicy.count()) { await groupPolicy.click(); await page.getByRole('option', { name: 'Open' }).click(); }
const senderPolicy = dialog.getByLabel(/Sender policy/i);
if (await senderPolicy.count()) { await senderPolicy.click(); await page.getByRole('option', { name: 'Open' }).click(); }
await sleep(300);
step('create-dialog-before-save', { hasDmAccess, ...(await dialogState(dialog)) });
if (await accessHeading.count()) {
  const section = accessHeading.locator('xpath=ancestor::section[1]');
  await shot('04-create-access-section-set', section);
}
await dialog.getByRole('button', { name: 'Save' }).click();
await dialog.waitFor({ state: 'detached', timeout: 30_000 });
await sleep(500);
step('settings-after-create', { channel: readWsSettings().channels['dws-group-only'] });
await shot('05-channels-page-after-create');

// Reopen: does the disabled value round-trip?
await page.getByRole('button', { name: 'Edit dws-group-only' }).click();
dialog = page.getByRole('dialog');
await dialog.getByRole('heading', { name: /DingTalk Workspace/ }).waitFor();
await sleep(300);
step('reopen-group-only', await dialogState(dialog));
if (await accessHeading.count()) await shot('06-reopen-group-only-access', accessHeading.locator('xpath=ancestor::section[1]'));
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached', timeout: 10_000 });

// Legacy channel saved without dmPolicy: what does the editor show, and what does Save write?
await page.getByRole('button', { name: 'Edit dws-legacy' }).click();
dialog = page.getByRole('dialog');
await dialog.getByRole('heading', { name: /DingTalk Workspace/ }).waitFor();
await sleep(300);
step('legacy-open', await dialogState(dialog));
if (await accessHeading.count()) await shot('07-legacy-access', accessHeading.locator('xpath=ancestor::section[1]'));
await dialog.getByRole('button', { name: 'Save' }).click();
await dialog.waitFor({ state: 'detached', timeout: 30_000 });
await sleep(500);
step('settings-after-legacy-save', { channel: readWsSettings().channels['dws-legacy'] });

// ---- Chinese labels ----
await openShell('zh');
await page.getByRole('button', { name: /频道|Channels/ }).first().click();
const zhEdit = page.getByRole('button', { name: /dws-group-only/ }).first();
await zhEdit.waitFor({ timeout: 30_000 });
await zhEdit.click();
dialog = page.getByRole('dialog');
await dialog.waitFor();
await sleep(500);
const zhText = (await dialog.textContent()) ?? '';
step('zh-dialog', { has私聊访问: zhText.includes('私聊访问'), has发送者策略: zhText.includes('发送者策略'), has群聊: /群聊/.test(zhText) });
const zhHeading = dialog.getByRole('heading', { name: /访问|Access/ });
if (await zhHeading.count()) await shot('08-zh-access-section', zhHeading.locator('xpath=ancestor::section[1]'));
await shot('09-zh-dialog', dialog);
await page.keyboard.press('Escape');

fs.writeFileSync(path.join(dir, 'ui-result.json'), JSON.stringify({ ...result, wsSettings: readWsSettings() }, null, 2) + '\n');
await browser.close();
try { process.kill(-serve.pid, 'SIGTERM'); } catch { /* gone */ }
await sleep(1500);
try { process.kill(-serve.pid, 'SIGKILL'); } catch { /* gone */ }
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(0);
