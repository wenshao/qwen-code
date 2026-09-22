const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  const url = fs.readFileSync('/root/verify/pr12258-r2/out-big/session-url.txt', 'utf8').trim();
  await page.goto(url + '?token=tok-head'); await page.locator('[data-testid="mcp-app"]').first().waitFor({ timeout: 60000 });
  const warn = page.getByText(/exceeding the 1048576 byte host limit/).first();
  const before = await warn.isVisible().catch(() => false);
  if (!before) { await page.getByText('mcp__big__show_dashboard').first().click(); await page.waitForTimeout(1200); }
  const after = await warn.isVisible().catch(() => false);
  const txt = after ? await warn.innerText() : '';
  console.log(JSON.stringify({ before, after, txt }));
  const box = page.getByText('show big dashboard').first();
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/root/verify/pr12258-r2/out-big/big-default-expanded.png' });
  await b.close();
})();
