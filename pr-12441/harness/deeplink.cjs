const { chromium } = require('playwright'); const fs = require('fs');
const BASE = 'http://127.0.0.1:41441'; const OUT = '/root/verify/pr12441/shots'; const TAG = process.env.TAG; const SID = process.env.SID;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const wire = []; const con = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.origin === BASE && /\/session\//.test(u.pathname)) wire.push(`${r.request().method()} ${u.pathname} -> ${r.status()}`); });
  page.on('console', (m) => { if (m.type() === 'error') con.push(m.text().slice(0, 160)); });
  await page.goto(`${BASE}/session/${SID}?context=live&token=pr12441-token`); await sleep(8000);
  const body = await page.locator('body').innerText();
  const r = { tag: TAG, url: page.url(), transcriptVisible: body.includes('What does this project do?'), loads: wire.filter((w) => w.includes('/load')), consoleErrors: con };
  await page.screenshot({ path: `${OUT}/${TAG}-h-deeplink-live-off.png` });
  console.log(JSON.stringify(r)); fs.writeFileSync(`${OUT}/${TAG}-deeplink.json`, JSON.stringify(r, null, 2)); await b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
