// Place a REAL Live Voice call from the Web Shell in Chromium (fake mic) against the daemon,
// wait for the scripted realtime turns, stop the call, and screenshot the sidebar.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:41441';
const OUT = process.env.OUT || '/root/verify/pr12441/shots';
const TAG = process.env.TAG || 'call';
const RT_LOG = '/root/verify/pr12441/rig/fake-realtime.log';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}/?token=pr12441-token`);
  await page.getByRole('button', { name: 'Open Live Voice' }).first().waitFor({ timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: 'Open Live Voice' }).first().click();
  await page.getByRole('button', { name: 'Talk in this browser' }).click();
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/${TAG}-01-dialog.png` });
  const before = fs.readFileSync(RT_LOG, 'utf8').length;
  await page.getByRole('button', { name: 'New conversation' }).click();
  // wait for both scripted turns to finish on the fake provider
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const tail = fs.readFileSync(RT_LOG, 'utf8').slice(before);
    if ((tail.match(/>> response\.done/g) || []).length >= 2) break;
    await sleep(500);
  }
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/${TAG}-02-in-call.png` });
  await page.getByRole('button', { name: 'Stop Live' }).click();
  await sleep(3000);
  await page.keyboard.press('Escape');
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/${TAG}-03-after-stop.png` });
  fs.writeFileSync(`${OUT}/${TAG}-console.log`, consoleLines.join('\n'));
  console.log('realtime log tail:\n' + fs.readFileSync(RT_LOG, 'utf8').slice(before).split('\n').slice(-40).join('\n'));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
