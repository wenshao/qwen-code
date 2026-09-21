const { chromium } = require('playwright');
const fs = require('node:fs');
const LONG = require('./seed-long.json').sessionId;
const BASE = 'http://127.0.0.1:14235';
const results = [];
const check = (id, name, pass, detail) => { results.push({ id, name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/session/${LONG}?token=verify-token-12234`);
  await page.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const btn = page.getByRole('button', { name: /^Search this conversation$/ });
  const rail = await page.locator('[data-global-turn-navigation]').count();
  const n = await btn.count();
  check('L1', 'legacy daemon: page loads, no uncaught errors', errors.length === 0, errors);
  check('L2', 'legacy daemon: rail/entry state recorded', true, { rail, searchEntry: n });
  if (n) {
    await btn.click();
    const dialog = page.locator('[data-conversation-search]');
    await dialog.locator('input').fill('common-token');
    await page.waitForTimeout(1200);
    const notice = await dialog.getByText(/loaded messages|已加载/).count();
    const options = await dialog.getByRole('option').count();
    check('L3', 'legacy daemon: loaded-only notice is shown', notice > 0, { notice });
    check('L4', 'legacy daemon: results come from loaded messages only (no persisted scan)', options > 0 && options < 100, { options });
    await dialog.locator('input').fill('zebra-quartz-7731');
    await page.waitForTimeout(1200);
    check('L5', 'legacy daemon: deep-history needle is NOT found, with the notice still explaining why', (await dialog.getByRole('option').count()) === 0, { status: await dialog.locator('[role=status]').textContent() });
    await page.screenshot({ path: __dirname + '/shots/r2-14-legacy-loaded-only.png' });
  }
  const stats = await (await fetch(BASE + '/__stats')).json();
  check('L0', 'proxy really stripped the capability', stats.stripped > 0, stats);
  await browser.close();
  fs.writeFileSync(__dirname + '/results-legacy.json', JSON.stringify(results, null, 1));
})();
