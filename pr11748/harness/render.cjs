const { chromium } = require('/root/git/pr11748-harness/head/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ viewport: { width: 1464, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
  for (const n of ['01-decrqm-real-stack', '02-old-daemon', '03-regression-test-guard']) {
    await p.goto(`file:///root/git/pr11748-harness/figs/${n}.html`);
    await p.locator('#fig').screenshot({ path: `/root/git/pr11748-harness/figs/${n}.png` });
    console.log('rendered', n);
  }
  await b.close();
})();
