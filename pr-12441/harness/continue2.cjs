// Pre-existing-issue probe: press "Continue execution" on a freshly recorded Voice chat, then cold-reload.
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = 'http://127.0.0.1:41441'; const OUT = '/root/verify/pr12441/shots'; const TAG = process.env.TAG;
const LOG = '/root/verify/pr12441/rig/fake-openai.log'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPLY = 'Noted — I will remind you to add tests next time we talk.';
const BANNER = 'The previous request was interrupted before the response completed.';
(async () => {
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(`${BASE}/?token=pr12441-token`);
  const row = page.getByText('Voice chat', { exact: true }).first(); await row.waitFor({ timeout: 60000 }); await sleep(1200); await row.click();
  await page.getByText(REPLY).first().waitFor({ timeout: 15000 }); await sleep(1500);
  const state = async () => { const b = await page.locator('body').innerText(); return { replyShownAlone: b.split('\n').some((l) => l.trim() === REPLY), replyText: b.includes(REPLY), banner: b.includes(BANNER), modelText: (b.match(/Typed reply #\d+ from the fake model\./) || [null])[0] }; };
  const r = { url: page.url(), beforeContinue: await state() };
  const before = fs.readFileSync(LOG, 'utf8').length;
  await page.getByRole('button', { name: 'Continue execution' }).click();
  await sleep(6000); await page.mouse.move(1350, 880); await sleep(400);
  r.afterContinue = await state();
  r.modelRequests = fs.readFileSync(LOG, 'utf8').slice(before).trim().split('\n').filter(Boolean).length;
  await page.screenshot({ path: `${OUT}/${TAG}-f-continue-live.png` });
  await page.reload(); await sleep(7000); await page.mouse.move(1350, 880); await sleep(400);
  r.afterReload = await state();
  await page.screenshot({ path: `${OUT}/${TAG}-g-continue-reload.png` });
  console.log(JSON.stringify(r)); fs.writeFileSync(`${OUT}/${TAG}-continue2.json`, JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
