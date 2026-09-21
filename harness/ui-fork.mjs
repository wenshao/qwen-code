// Real Web Shell (served by the daemon itself) against the real daemon:
// start the background-agent scenario from the composer, and while the
// automatic background-notification turn is running type `/fork review this`.
//   ARM=head|mut node ui-fork.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/wenshao/git/qc-12008-r5-head/package.json');
const { chromium } = require('playwright');

const env = process.env;
const ARM = env.ARM;
const BASE = env.BASE_URL;
const TOKEN = env.TOKEN;
const WS = env.WS;
const MOCK = `http://127.0.0.1:${env.MOCK_PORT}`;
const OUT = `${env.R}/out/ui`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (m, x) => console.log(`[ui-${ARM} +${((Date.now() - T0) / 1000).toFixed(2)}s] ${m}`, x ? JSON.stringify(x).slice(0, 300) : '');
const api = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json().catch(() => ({}));
};

await fetch(`${MOCK}/__run`, { method: 'POST', body: JSON.stringify({ label: `${ARM}-ui-fork` }) });
const before = new Set(((await api(`/workspaces/${encodeURIComponent(WS)}/sessions/live-state`)).sessions ?? []).map((s) => s.sessionId));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const httpLog = [];
page.on('response', async (res) => {
  const u = res.url();
  if (/\/session\/[^/]+\/(fork|branch|prompt)$/.test(u) && res.request().method() === 'POST') {
    let body = '';
    try {
      body = (await res.text()).slice(0, 300);
    } catch {}
    httpLog.push({ t: ((Date.now() - T0) / 1000).toFixed(2), url: u.replace(BASE, ''), status: res.status(), body });
  }
});
await page.goto(`${BASE}/?token=${TOKEN}&lang=en`, { waitUntil: 'domcontentloaded' });
const editor = page.locator('.cm-content').first();
await editor.waitFor({ timeout: 30000 });
await sleep(1200);
await editor.click();
await page.keyboard.type('[[S:bgwin]] launch alpha in the background');
await page.keyboard.press('Enter');
log('prompt sent');

// find the Web Shell's session and wait for its automatic background turn
let sid;
let bgTurn;
for (let i = 0; i < 200 && !bgTurn; i++) {
  const ls = (await api(`/workspaces/${encodeURIComponent(WS)}/sessions/live-state`)).sessions ?? [];
  const mine = ls.find((s) => !before.has(s.sessionId));
  if (mine) {
    sid = mine.sessionId;
    const st = await api(`/session/${sid}/status`);
    if (st.backgroundTurn) bgTurn = st.backgroundTurn;
  }
  await sleep(150);
}
log('background turn running', { sid, turnId: bgTurn?.turnId });
await sleep(1500);
await page.screenshot({ path: `${OUT}/${ARM}-1-bg-running.png` });

await editor.click();
await page.keyboard.type('/fork review this');
await sleep(300);
await page.keyboard.press('Enter');
await sleep(300);
await page.keyboard.press('Enter');
log('typed /fork');
await sleep(2500);
const st2 = await api(`/session/${sid}/status`);
await page.screenshot({ path: `${OUT}/${ARM}-2-after-fork.png` });
const mock = await (await fetch(`${MOCK}/__log`)).json();
const result = {
  arm: ARM,
  sid,
  backgroundTurn: bgTurn,
  statusAfterFork: { hasActivePrompt: st2.hasActivePrompt, backgroundTurn: st2.backgroundTurn?.turnId },
  http: httpLog,
  mockRequestsWhileBgTurnRunning: mock.map((r) => ({ seq: r.seq, kind: r.kind, reply: r.reply, ended: r.ended, at: r.at })),
};
fs.writeFileSync(`${OUT}/${ARM}-ui-fork.json`, JSON.stringify(result, null, 1));
log('http', httpLog);
// let the turn finish so the daemon is quiet for the next run
for (let i = 0; i < 200; i++) {
  const st = await api(`/session/${sid}/status`);
  if (!st.backgroundTurn && !st.hasActivePrompt) break;
  await sleep(250);
}
await sleep(1000);
await page.screenshot({ path: `${OUT}/${ARM}-3-settled.png` });
await browser.close();
log('done');
