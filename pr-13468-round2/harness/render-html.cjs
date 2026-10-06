const { chromium } = require('playwright');
(async () => {
  const [inp, out] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1300, height: 800 }, deviceScaleFactor: 2 });
  await p.goto('file://' + inp);
  const box = await p.locator('.wrap').boundingBox();
  await p.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
  await p.locator('.wrap').screenshot({ path: out });
  console.log(out, Math.ceil(box.width), Math.ceil(box.height));
  await b.close();
})();
