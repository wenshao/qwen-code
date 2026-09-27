// Frame sequence after opening the Managed-owned session on a paired daemon,
// then a message typed into it. Reuses the storage of ui-shots.mjs (OUT).
import fs from 'node:fs'; import path from 'node:path'; import net from 'node:net';
import { spawn } from 'node:child_process'; import { createRequire } from 'node:module';
import { startFakeModel } from './fake-model.mjs';
const WT = process.env.WT; const OUT = path.resolve(process.env.OUT); const SHOTS = path.resolve(process.env.SHOTS);
const { chromium } = createRequire(path.join(WT, 'package.json'))('playwright');
const HOME = path.join(OUT, 'home'); const WS = fs.realpathSync(path.join(OUT, 'ws/demo'));
const ids = JSON.parse(fs.readFileSync(path.join(OUT, 'ids.json'), 'utf8'));
const model = await startFakeModel('fake-model');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const fd = fs.openSync(path.join(OUT, 'probe2.log'), 'w');
const child = spawn(process.execPath, [path.join(WT, 'dist/cli.js'), 'serve', '--port', String(port), '--hostname', '127.0.0.1', '--workspace', WS, '--experimental-paired-engines'], { cwd: WS, stdio: ['ignore', fd, fd], env: { PATH: process.env.PATH, HOME, TMPDIR: process.env.TMPDIR, OPENAI_API_KEY: 'k', OPENAI_BASE_URL: model.url, OPENAI_MODEL: 'fake-model', NO_PROXY: '*' } });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 600; i++) { try { if ((await fetch(`${base}/capabilities`)).status === 200) break; } catch {} await sleep(300); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
const net2 = [];
page.on('response', (r) => { const u = new URL(r.url()); if (/^\/session/.test(u.pathname) && r.request().method() !== 'GET') net2.push(`${Date.now()} ${r.request().method()} ${u.pathname.replace(/[0-9a-f-]{36}/, (m) => m.slice(0, 8))} → ${r.status()}`); });
await page.goto(`${base}/?language=en`); await page.waitForTimeout(4000);
const t0 = Date.now();
await page.getByText(process.env.TARGET).first().click();
await page.mouse.move(1200, 500);
for (const ms of [1500]) { await page.waitForTimeout(ms - (Date.now() - t0) > 0 ? ms - (Date.now() - t0) : 0); await page.screenshot({ path: path.join(SHOTS, `probe-${process.env.TAG}-${ms}ms.png`) }); }
const toasts = await page.locator('[role="status"], [role="alert"], [data-sonner-toast]').allInnerTexts().catch(() => []);
console.log('toasts', JSON.stringify(toasts));
console.log(net2.map((l) => l.replace(/^\d+/, (t) => `+${Number(t) - t0}ms`)).join('\n'));
const chats = fs.readdirSync(path.join(HOME, '.qwen/projects')).map((p) => path.join(HOME, '.qwen/projects', p, 'chats')).find((p) => fs.existsSync(p));
console.log('transcripts now', fs.readdirSync(chats).filter((f) => f.endsWith('.jsonl') && !f.includes('ledger')).map((f) => f.slice(0, 8) + (ids.some((i) => f.startsWith(i)) ? '' : ' NEW')));
const mf = path.join(chats, `${ids[1]}.jsonl`);
console.log('managed transcript lines', fs.readFileSync(mf, 'utf8').split('\n').filter(Boolean).length);
await browser.close(); child.kill('SIGTERM'); await new Promise((r) => child.on('exit', r)); await model.close();
