// Web Shell screenshots for PR #12828: a paired daemon (bundled CLI) serving
// its own Web Shell, three sessions in one workspace:
//   1. an ordinary Legacy session created on the paired host
//   2. the same kind of session whose owner record was switched to managed
//   3. a Legacy session whose last transcript line is torn (crash mid-append)
// Then the unpaired daemon over the same storage for session 3.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { startFakeModel } from './fake-model.mjs';

const WT = process.env.WT;
const OUT = path.resolve(process.env.OUT);
const SHOTS = path.resolve(process.env.SHOTS ?? 'shots');
const require = createRequire(path.join(WT, 'package.json'));
const { chromium } = require('playwright');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const HOME = path.join(OUT, 'home');
const QDIR = path.join(HOME, '.qwen');
fs.mkdirSync(QDIR, { recursive: true });
fs.mkdirSync(path.join(OUT, 'ws/demo'), { recursive: true });
const WS = fs.realpathSync(path.join(OUT, 'ws/demo'));
fs.writeFileSync(path.join(QDIR, 'settings.json'), JSON.stringify({
  security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: true } },
  model: { name: 'fake-model' }, general: { enableAutoUpdate: false }, tools: { approvalMode: 'yolo' },
}, null, 2));
fs.writeFileSync(path.join(QDIR, 'trustedFolders.json'), JSON.stringify({ [WS]: 'TRUST_FOLDER' }));
const model = await startFakeModel('fake-model');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function daemon(paired, tag) {
  const port = await freePort();
  const fd = fs.openSync(path.join(OUT, `${tag}.log`), 'w');
  const child = spawn(process.execPath, [path.join(WT, 'dist/cli.js'), 'serve', '--port', String(port), '--hostname', '127.0.0.1', '--workspace', WS, ...(paired ? ['--experimental-paired-engines'] : [])], {
    cwd: WS, stdio: ['ignore', fd, fd],
    env: { PATH: process.env.PATH, HOME, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', OPENAI_API_KEY: 'k', OPENAI_BASE_URL: model.url, OPENAI_MODEL: 'fake-model', NO_PROXY: '*' },
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 600; i++) { try { if ((await fetch(`${base}/capabilities`)).status === 200) break; } catch {} await sleep(300); }
  return { base, child, stop: async () => { child.kill('SIGTERM'); await new Promise((r) => child.on('exit', r)); } };
}
async function req(d, method, url, body) {
  for (let i = 0; ; i++) {
    const r = await fetch(d.base + url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503 && j.code === 'daemon_runtime_starting' && i < 100) { await sleep(300); continue; }
    return { status: r.status, json: j };
  }
}
const chats = () => { const d = fs.readdirSync(path.join(QDIR, 'projects')).map((p) => path.join(QDIR, 'projects', p, 'chats')).find((p) => fs.existsSync(p)); return d; };
const PROMPTS = [
  'Legacy session created on the paired host',
  'Session whose owner record names managed',
  'Legacy session whose last line is torn',
];
let d = await daemon(true, 'paired-setup');
const ids = [];
for (const text of PROMPTS) {
  const c = await req(d, 'POST', '/session', { cwd: WS });
  const id = c.json.sessionId;
  ids.push(id);
  await req(d, 'POST', `/session/${id}/prompt`, { prompt: [{ type: 'text', text }] });
  const t0 = Date.now();
  for (;;) {
    const f = chats() && path.join(chats(), `${id}.jsonl`);
    if (f && fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('"type":"assistant"')) break;
    if (Date.now() - t0 > 90_000) throw new Error('turn did not finish');
    await sleep(300);
  }
  await sleep(1500);
  await req(d, 'DELETE', `/session/${id}`);
}
await d.stop();
const file = (id) => path.join(chats(), `${id}.jsonl`);
{
  const lines = fs.readFileSync(file(ids[1]), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const i = lines.findIndex((r) => r.subtype === 'session_execution_engine');
  lines[i].systemPayload = { version: 1, engine: 'managed' };
  fs.writeFileSync(file(ids[1]), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const good = fs.readFileSync(file(ids[2]), 'utf8');
  const last = good.trimEnd().split('\n').at(-1);
  fs.writeFileSync(file(ids[2]), good + last.slice(0, Math.floor(last.length / 2)));
}
fs.writeFileSync(path.join(OUT, 'ids.json'), JSON.stringify(ids));

const browser = await chromium.launch();
async function shoot(dm, tag, clicks) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('response', async (r) => { if (/\/session\/[^/]+\/(load|resume)$/.test(new URL(r.url()).pathname)) errors.push(`${r.request().method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/, (m) => m.slice(0, 8))} → ${r.status()}`); });
  await page.goto(`${dm.base}/?language=en`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-00-home.png`) });
  for (const [n, text] of clicks) {
    const item = page.getByText(text, { exact: false }).first();
    try { await item.click({ timeout: 15_000 }); } catch (e) { console.log(tag, 'click failed', text, e.message.split('\n')[0]); continue; }
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(SHOTS, `${tag}-${n}.png`) });
    console.log(tag, n, 'restores:', errors.splice(0).join(' | '));
  }
  await page.close();
}
d = await daemon(true, 'paired-ui');
await shoot(d, 'paired', [['01-legacy', PROMPTS[0]], ['02-managed', PROMPTS[1]], ['03-torn', PROMPTS[2]]]);
await d.stop();
d = await daemon(false, 'unpaired-ui');
await shoot(d, 'unpaired', [['03-torn', PROMPTS[2]]]);
await d.stop();
await browser.close();
await model.close();
