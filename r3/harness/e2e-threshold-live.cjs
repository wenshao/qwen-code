// Headline claim: "the icon is hidden at 10 messages and appears at 11".
// Exercise it the way a user actually does: a NEW session, every turn typed in this tab.
const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:14234';
const TOKEN = 'verify-token-12234';
(async () => {
  const created = await fetch(`${BASE}/session`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ cwd: '/private/var/tmp/pr12234-r3/ws', sessionScope: 'thread' }) });
  const { sessionId } = await created.json();
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(`${BASE}/session/${sessionId}?token=${TOKEN}`);
  const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
  await editor.waitFor({ timeout: 30000 });
  const btn = page.getByRole('button', { name: /^Search this conversation$/ });
  const rows = [];
  for (let k = 1; k <= 6; k++) {
    await editor.click();
    await page.keyboard.type(`Question #${k}: tell me about topic-${k}`);
    await page.locator('[data-web-shell-composer-submit]').click();
    await page.getByText(`Answer #${k}:`, { exact: false }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500); // let the probe settle
    const visible = (await btn.count()) === 1 && (await btn.isVisible());
    const domMessages = await page.evaluate(() => (document.querySelector('[data-web-shell-message-list]')?.textContent.match(/(Question|Answer) #\d+:/g) ?? []).length);
    rows.push({ turnsTyped: k, realMessages: 2 * k, domMessages, entryVisible: visible, expectedByClaim: 2 * k > 10 });
    console.log(JSON.stringify(rows.at(-1)));
    if (2 * k === 8 || 2 * k === 10) await page.screenshot({ path: `${__dirname}/shots/r3-live-session-${2 * k}-messages-${process.env.ARM ?? 'x'}.png` });
  }
  // same session, reloaded: every block now replayed from disk with record ids
  fs.writeFileSync(__dirname + `/results-threshold-live-${process.env.ARM ?? 'x'}.json`, JSON.stringify({ sessionId, rows }, null, 1));
  await browser.close();
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
