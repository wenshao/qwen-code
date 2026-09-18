// Control arm: the same locator.type through a DIRECT CDP connection
// (Playwright straight to Chrome's own debugging port), no Qwen relay.
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/git/qwen-code-x3-scratch-pr11242-r5/packages/browser-use/');
const { chromium } = require('playwright-core');
const rows = [];
const t0 = () => Date.now();
const browser = await chromium.connectOverCDP('http://127.0.0.1:9412');
try {
  const context = browser.contexts()[0];
  const page = await context.newPage();
  let started = t0();
  await page.goto('https://www.saucedemo.com/', { waitUntil: 'domcontentloaded' });
  rows.push(['goto', 'ok', Date.now() - started]);
  started = t0();
  await page.evaluate(() => document.readyState);
  rows.push(['evaluate', 'ok', Date.now() - started]);
  started = t0();
  try {
    await page.getByPlaceholder('Username').pressSequentially('x', { timeout: 120_000 });
    rows.push(['type 1 key', 'ok', Date.now() - started]);
  } catch (error) {
    rows.push(['type 1 key', 'FAIL', Date.now() - started, String(error.message).slice(0, 80)]);
  }
  const perKey = [];
  for (const ch of 'secret_sauce') {
    const keyStart = t0();
    try {
      await page.getByPlaceholder('Password').pressSequentially(ch, { timeout: 120_000 });
      perKey.push(Date.now() - keyStart);
    } catch (error) {
      perKey.push('FAIL:' + (Date.now() - keyStart));
    }
  }
  rows.push(['per-key x12', 'ok', perKey]);
  started = t0();
  await page.getByPlaceholder('Username').fill('standard_user');
  rows.push(['fill', 'ok', Date.now() - started]);
  await page.close();
} finally {
  await browser.close().catch(() => undefined);
}
process.stdout.write(
  `load1=${os.loadavg()[0].toFixed(2)} ${JSON.stringify({ arm: 'control(direct CDP, no relay)', rows })}\n`,
);
