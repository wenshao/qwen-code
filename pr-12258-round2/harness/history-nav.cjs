const pw = require('playwright'); const fs = require('fs');
const [BROWSER, DP, SID, OUT] = process.argv.slice(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function state(page) {
  const cards = page.locator('[data-testid="mcp-app"]'); const n = await cards.count(); const r = [];
  for (let i = 0; i < n; i++) { const el = await cards.nth(i).locator('iframe').elementHandle().catch(() => null); const f = el ? await el.contentFrame() : null;
    const inner = f?.childFrames()[0]; let ready = false; if (inner) ready = await inner.evaluate(() => !!window.__ready).catch(() => false);
    r.push({ proxyUrl: f?.url()?.replace(/^http:\/\/([0-9a-f]{8})[^.]*/, 'http://$1…'), inner: !!inner, ready }); }
  return r;
}
(async () => {
  const b = await pw[BROWSER].launch(); const page = await (await b.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  const sb = []; page.on('response', r => { if (r.url().includes('mcp-app-sandbox')) sb.push(`${r.status()} ${r.url().replace(/\?.*/, '').replace(/^http:\/\/([0-9a-f]{8})[^.]*/, 'http://$1…')}`); });
  await page.goto(`http://127.0.0.1:${DP}/session/${SID}?token=tok-head`);
  await page.locator('[data-testid="mcp-app"]').first().waitFor({ timeout: 60000 }); await sleep(8000);
  const s1 = await state(page); const sb1 = sb.splice(0);
  await page.goto('about:blank'); await sleep(500);
  await page.goBack(); await page.locator('[data-testid="mcp-app"]').first().waitFor({ timeout: 60000 }); await sleep(10000);
  const s2 = await state(page); const sb2 = sb.splice(0);
  await page.reload(); await page.locator('[data-testid="mcp-app"]').first().waitFor({ timeout: 60000 }); await sleep(10000);
  const s3 = await state(page); const sb3 = sb.splice(0);
  const res = { browser: BROWSER, initial: { apps: s1, sandboxResponses: sb1 }, afterBack: { apps: s2, sandboxResponses: sb2 }, afterReload: { apps: s3, sandboxResponses: sb3 } };
  console.log(JSON.stringify(res, null, 1)); fs.writeFileSync(OUT + '.json', JSON.stringify(res, null, 1));
  await page.locator('[data-testid="mcp-app"]').first().screenshot({ path: OUT + '.png' }).catch(() => {});
  await b.close();
})().catch(e => { console.log('FATAL', String(e).slice(0, 600)); process.exit(1); });
