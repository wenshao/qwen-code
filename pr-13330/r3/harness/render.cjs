// usage: node render.cjs <in.html> <out.png>
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(process.env.PW_ROOT + '/package.json');
const { chromium } = req('playwright');
(async () => {
  const [input, output] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2200, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.resolve(input));
  const card = page.locator('.card');
  let box = await card.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width + 60), height: Math.ceil(box.height + 60) });
  const clipped = await page.evaluate(() => [...document.querySelectorAll('td,th,pre')].filter(e => e.scrollWidth > e.clientWidth + 1).length);
  await card.screenshot({ path: output });
  box = await card.boundingBox();
  console.log(output, Math.round(box.width), 'x', Math.round(box.height), 'clipped_cells=' + clipped);
  await browser.close();
})();
