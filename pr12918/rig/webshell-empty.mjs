// Finding probe: POST /session with an explicit approvalMode, never prompted,
// then the client leaves. Does an empty session appear in the Web Shell list?
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SP, TOKEN, Daemon, prepareHome, findJsonl, sleep } from './lib.mjs';

const arm = process.argv[2];
const fakePort = 18918;
const require = createRequire(path.join(SP, 'wt-head', 'package.json'));
const { chromium } = require('playwright');
const root = path.join(SP, 'runs', `empty-${arm}`);
fs.rmSync(root, { recursive: true, force: true });
const ws = path.join(root, 'ws');
const { home, qwenHome } = prepareHome({ root, ws, fakePort });
const shots = path.join(SP, 'shots');
const d = await new Daemon({ wt: path.join(SP, `wt-${arm}`), home, qwenHome, ws, fakePort, logFile: path.join(root, 'daemon.log') }).start();
const real = await d.createSession();
const sub = d.subscribe(real.sessionId, real.clientId);
await sub.ready;
const p = await d.prompt(real.sessionId, 'A real conversation', real.clientId);
await sub.waitFor((e) => e.type === 'turn_complete' && e.promptId === p.json.promptId, 30000);
sub.close();
await d.detach(real.sessionId, real.clientId);
await d.waitClosed(real.sessionId);
const out = {};
for (const mode of ['yolo', 'auto-edit']) {
  const s = await d.createSession({ approvalMode: mode });
  await sleep(300);
  await d.detach(s.sessionId, s.clientId);
  await d.waitClosed(s.sessionId);
  const f = findJsonl(qwenHome, s.sessionId);
  out[mode] = { sessionId: s.sessionId, jsonl: f ? fs.readFileSync(f, 'utf8').trim().split('\n').length + ' record(s)' : null };
}
const list = await d.req('GET', `/workspace/${encodeURIComponent(ws)}/sessions?limit=50`);
out.list = (list.json?.sessions ?? []).map((x) => ({ id: x.sessionId.slice(0, 8), displayName: x.displayName, clientCount: x.clientCount }));
console.log(JSON.stringify(out, null, 1));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
await page.goto(`${d.base}/?token=${TOKEN}&lang=en`);
await page.waitForSelector('[data-web-shell-root]', { timeout: 30000 });
await sleep(5000);
await page.screenshot({ path: path.join(shots, `empty-${arm}-full.png`) });
const sidebar = await page.evaluate(() => document.body.innerText.split('\n').slice(0, 40));
out.sidebarText = sidebar;
fs.writeFileSync(path.join(root, 'empty.json'), JSON.stringify(out, null, 2));
await browser.close();
await d.stop();
