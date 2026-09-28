// Web Shell evidence: set Full Access via API, detach + restart daemon, then open
// the session in the real bundled Web Shell (which performs the cold load) and
// screenshot the composer's mode control.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SP, TOKEN, Daemon, prepareHome, sleep } from './lib.mjs';

const arm = process.argv[2];
const fakePort = 18918;
const require = createRequire(path.join(SP, 'wt-head', 'package.json'));
const { chromium } = require('playwright');
const root = path.join(SP, 'runs', `shot-${arm}`);
fs.rmSync(root, { recursive: true, force: true });
const ws = path.join(root, 'ws');
const { home, qwenHome } = prepareHome({ root, ws, fakePort });
const shots = path.join(SP, 'shots');
fs.mkdirSync(shots, { recursive: true });
const mk = () => new Daemon({ wt: path.join(SP, `wt-${arm}`), home, qwenHome, ws, fakePort, logFile: path.join(root, 'daemon.log') });

let d = await mk().start();
const s = await d.createSession();
const sub = d.subscribe(s.sessionId, s.clientId);
await sub.ready;
const p = await d.prompt(s.sessionId, 'Session selected Full Access before the daemon restart.', s.clientId);
await sub.waitFor((e) => e.type === 'turn_complete' && e.promptId === p.json.promptId, 30000);
const setRes = await d.setMode(s.sessionId, 'yolo', {}, s.clientId);
console.log('set', JSON.stringify(setRes.json));
sub.close();
await d.detach(s.sessionId, s.clientId);
await d.waitClosed(s.sessionId);
await d.stop();
d = await mk().start();
console.log('restarted', d.base);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
const loads = [];
page.on('response', async (r) => {
  if (/\/session\/[^/]+\/load$/.test(new URL(r.url()).pathname)) {
    try {
      const j = await r.json();
      loads.push({ status: r.status(), mode: j?.state?.modes?.currentModeId, attached: j?.attached });
    } catch {}
  }
});
await page.goto(`${d.base}/session/${s.sessionId}?token=${TOKEN}&lang=en`);
await page.waitForSelector('[data-web-shell-root]', { timeout: 30000 });
await sleep(6000);
const bodyText = await page.evaluate(() => document.body.innerText);
const modeHits = bodyText.split('\n').filter((l) => /yolo|full access|default|ask|auto/i.test(l)).slice(0, 20);
console.log('loads', JSON.stringify(loads));
console.log('modeHits', JSON.stringify(modeHits));
await page.screenshot({ path: path.join(shots, `webshell-${arm}-full.png`) });
fs.writeFileSync(path.join(root, 'webshell.json'), JSON.stringify({ sessionId: s.sessionId, loads, modeHits }, null, 2));
await browser.close();
await d.stop();
