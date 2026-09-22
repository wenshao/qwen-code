const L = require('./lib.cjs');
(async () => {
  const [browserName, base, mode] = process.argv.slice(2);
  const { browser, page, wire } = await L.launch(browserName);
  await L.openTrajectory(page, base, '4fd9d932-c1bf-4c2c-b440-6ccff666cac7');
  const st = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="trajectory-load-older"]');
    const cs = getComputedStyle(b); const bar = b.parentElement; const bs = getComputedStyle(bar);
    return { button: { height: b.getBoundingClientRect().height, lineHeight: cs.lineHeight, fontSize: cs.fontSize, padding: cs.padding, border: cs.borderTopWidth, boxSizing: cs.boxSizing, fontFamily: cs.fontFamily.slice(0, 60) }, bar: { height: bar.getBoundingClientRect().height, minHeight: bs.minHeight, height_css: bs.height, padding: bs.padding, boxSizing: bs.boxSizing }, rootLineHeight: getComputedStyle(document.documentElement).lineHeight, bodyLineHeight: getComputedStyle(document.body).lineHeight };
  });
  console.log(JSON.stringify(st));
  if (mode === 'dblclick') {
    const n = wire.length;
    await page.getByTestId('trajectory-load-older').dblclick();
    await page.waitForTimeout(2500);
    console.log(JSON.stringify({ transcriptReadsFromDoubleClick: wire.length - n, rows: (await L.gridState(page)).rowcount }));
  }
  await browser.close();
})();
