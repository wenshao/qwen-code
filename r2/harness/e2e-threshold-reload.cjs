const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:14234';
const TOKEN = 'verify-token-12234';
(async () => {
  const created = await fetch(`${BASE}/session`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ cwd: '/root/verify/pr12234-r2-harness/ws', sessionScope: 'thread' }) });
  const { sessionId } = await created.json();
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(`${BASE}/session/${sessionId}?token=${TOKEN}`);
  const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
  await editor.waitFor({ timeout: 30000 });
  const btn = page.getByRole('button', { name: /^Search this conversation$/ });
  for (let k = 1; k <= 4; k++) {
    await editor.click();
    await page.keyboard.type(`Question #${k}: tell me about topic-${k}`);
    await page.locator('[data-web-shell-composer-submit]').click();
    await page.getByText(`Answer #${k}:`, { exact: false }).first().waitFor({ timeout: 60000 });
  }
  await page.waitForTimeout(3000);
  const live = (await btn.count()) === 1 && (await btn.isVisible());
  await page.screenshot({ path: `${__dirname}/shots/r2-22-8-messages-typed-live.png` });
  await page.reload();
  await page.getByText('Answer #4:', { exact: false }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const reloaded = (await btn.count()) === 1 && (await btn.isVisible());
  await page.screenshot({ path: `${__dirname}/shots/r2-23-8-messages-after-reload.png` });
  const out = { sessionId, messages: 8, entryVisibleTypedLive: live, entryVisibleAfterReload: reloaded };
  console.log(JSON.stringify(out));
  fs.writeFileSync(__dirname + '/results-threshold-reload.json', JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
