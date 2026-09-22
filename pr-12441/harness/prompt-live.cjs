// Open the Voice chat session, then send a typed message into it and wait for the model reply.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:41441';
const OUT = process.env.OUT || '/root/verify/pr12441/shots';
const TAG = process.env.TAG;
const MSG = process.env.MSG || 'Typed follow-up: which files are here?';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const wire = []; const consoleLines = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.origin === BASE && !u.pathname.startsWith('/assets')) wire.push({ t: Date.now(), m: r.request().method(), p: decodeURIComponent(u.pathname), s: r.status() }); });
  page.on('console', (m) => consoleLines.push({ t: Date.now(), type: m.type(), text: m.text().slice(0, 300) }));
  await page.goto(`${BASE}/?token=pr12441-token`);
  const row = page.getByText('Voice chat', { exact: true }).first();
  await row.waitFor({ timeout: 60000 }); await sleep(1200);
  await row.click();
  await page.getByText('Noted — I will remind you to add tests', { exact: false }).first().waitFor({ timeout: 15000 });
  await sleep(1500);
  const sendAt = Date.now();
  await page.locator('[data-web-shell-composer-editor] .cm-content').click();
  await page.keyboard.type(MSG);
  await page.locator('[data-web-shell-composer-submit]').click();
  let replied = false; const t0 = Date.now();
  while (Date.now() - t0 < 30000) { if ((await page.locator('body').innerText()).match(/Typed reply #\d+ from the fake model/)) { replied = true; break; } await sleep(300); }
  await sleep(2000);
  await page.mouse.move(1350, 880); await sleep(500);
  await page.screenshot({ path: `${OUT}/${TAG}-d-typed-turn.png` });
  const r = { tag: TAG, url: page.url(), replied,
    wireAfterSend: wire.filter((w) => w.t >= sendAt && !/\/live\/status|\/capabilities/.test(w.p)).map((w) => `${w.m} ${w.p} -> ${w.s}`),
    consoleAfterSend: consoleLines.filter((c) => c.t >= sendAt && ['error', 'warning'].includes(c.type)).map((c) => `[${c.type}] ${c.text}`) };
  fs.writeFileSync(`${OUT}/${TAG}-prompt.json`, JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
