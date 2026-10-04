// Render HTML evidence cards to PNG with the repo's Playwright. usage: node render.mjs card1.html ...
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('/Users/wenshao/pr13350-rig/src-base/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
for (const file of process.argv.slice(2)) {
  await page.goto('file://' + path.resolve(file));
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre, td, .cell')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 80)));
  const out = file.replace(/\.html$/, '.png');
  await page.locator('#card').screenshot({ path: out });
  console.log(out, clipped.length ? `CLIPPED: ${JSON.stringify(clipped)}` : 'ok');
}
await browser.close();
