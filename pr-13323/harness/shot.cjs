// Screenshot a local HTML file's #fig element. Usage: node shot.cjs in.html out.png
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  await page.goto('file://' + process.argv[2]);
  await page.waitForTimeout(200);
  const b = await page.locator('#fig').boundingBox();
  await page.setViewportSize({ width: Math.ceil(b.x + b.width + 20), height: Math.ceil(b.y + b.height + 20) });
  const b2 = await page.locator('#fig').boundingBox();
  await page.screenshot({ path: process.argv[3], clip: b2 });
  await browser.close();
  console.log('wrote', process.argv[3], b2);
})();
