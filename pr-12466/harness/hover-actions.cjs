// Crop the hovered user message with its action row (Copy / [tool calls] / Edit).
const { launch, openSession } = require('./lib.cjs');
(async () => {
  const [base, sid, label, out] = process.argv.slice(2);
  const { browser, page } = await launch({});
  await openSession(page, base, sid);
  const bubble = page.getByText(label, { exact: true }).first();
  await bubble.scrollIntoViewIfNeeded();
  await bubble.hover(); await page.waitForTimeout(600);
  const box = await bubble.boundingBox();
  const titles = await page.evaluate(() => [...document.querySelectorAll('button[title]')].map(b => b.title).filter(t => /Copy|tool calls|Edit/.test(t)));
  console.log(JSON.stringify([...new Set(titles)]));
  await page.screenshot({ path: out, clip: { x: box.x - 260, y: box.y - 16, width: box.width + 290, height: box.height + 64 } });
  await browser.close();
})();
