// VERIFICATION ONLY (PR #13163 R9): render evidence HTML pages to PNG (one fresh page per figure).
// usage: node render.cjs <out-dir> <page.html>...
const path = require('node:path');
const { chromium } = require('/root/verify/pr13163-r9/h9/node_modules/playwright-core');
(async () => {
  const [outDir, ...pages] = process.argv.slice(2);
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  for (const file of pages) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    await page.goto('file://' + path.resolve(file));
    const wrap = page.locator('.wrap');
    let box = await wrap.boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width + 40), height: Math.ceil(box.height + 40) });
    box = await wrap.boundingBox();
    const out = path.join(outDir, path.basename(file).replace(/\.html$/, '.png'));
    await page.screenshot({ path: out, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    console.log(out, Math.round(box.width), 'x', Math.round(box.height));
    await page.close();
  }
  await browser.close();
})();
