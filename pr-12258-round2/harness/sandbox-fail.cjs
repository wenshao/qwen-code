const { chromium } = require('playwright'); const fs = require('fs');
const [DP, SID, OUT, MODE] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 }); const page = await ctx.newPage();
  const target = MODE === '404' ? `http://00000000-0000-4000-8000-000000000000.localhost:${process.env.SPORT}/mcp-app-sandbox` : 'http://sandbox.invalid/mcp-app-sandbox';
  await ctx.route(new RegExp(`^http://localhost:${DP}/mcp-app-sandbox`), r => r.fulfill({ status: 302, headers: { location: target, 'cache-control': 'no-store' } }));
  await page.goto(`http://127.0.0.1:${DP}/session/${SID}?token=tok-head`);
  const card = page.locator('[data-testid="mcp-app"]').first(); await card.waitFor({ timeout: 60000 });
  await page.waitForTimeout(12000);
  const res = { mode: MODE, cards: await page.locator('[data-testid="mcp-app"]').count(), cardText: (await card.innerText()).trim(), iframeVisible: await card.locator('iframe').isVisible().catch(() => false), iframeBox: await card.locator('iframe').boundingBox().catch(() => null), fallbackShown: /Dashboard ready/.test(await card.innerText()) };
  console.log(JSON.stringify(res)); fs.writeFileSync(OUT + '.json', JSON.stringify(res, null, 1));
  await card.screenshot({ path: OUT + '.png' }); await b.close();
})();
