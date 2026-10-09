import { chromium } from '/Users/wenshao/pr13674-rig/src-merge/node_modules/playwright/index.mjs';
const names = process.argv.slice(2);
const browser = await chromium.launch();
for (const n of names) {
  const page = await browser.newPage({ viewport: { width: 1420, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`file:///Users/wenshao/pr13674-rig/fig/cards/${n}.html`);
  await page.waitForTimeout(400);
  const el = await page.$('.card');
  await el.screenshot({ path: `/Users/wenshao/pr13674-rig/fig/${n}.png` });
  const box = await el.boundingBox();
  console.log(n, Math.round(box.width), Math.round(box.height));
  await page.close();
}
await browser.close();
