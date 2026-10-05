const { chromium } = require('playwright-core');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  for (const name of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    await page.goto('file://' + path.resolve('fig', name + '.html'));
    await page.waitForTimeout(200);
    let box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width + 40), height: Math.ceil(box.height + 40) });
    box = await page.locator('.wrap').boundingBox();
    await page.screenshot({ path: path.resolve('fig', name + '.png'), clip: box });
    console.log(name, Math.round(box.width), 'x', Math.round(box.height));
    await page.close();
  }
  await browser.close();
})();
