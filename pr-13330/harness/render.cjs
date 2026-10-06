// usage: NODE_PATH=/root/verify/pr13330/wt-pr/node_modules node render.cjs <in.html> <out.png>
const { chromium } = require('playwright-core');
const path = require('path');
(async () => {
  const [input, output] = process.argv.slice(2);
  const browser = await chromium.launch({
    executablePath:
      '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.resolve(input));
  await page.waitForLoadState('networkidle');
  const card = page.locator('.card');
  let box = await card.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width + 40), height: Math.ceil(box.height + 40) });
  box = await card.boundingBox();
  await card.screenshot({ path: output });
  console.log(output, Math.round(box.width), 'x', Math.round(box.height));
  await browser.close();
})();
