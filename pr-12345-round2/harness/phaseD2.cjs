const L = require('./lib.cjs');
(async () => {
  const b = await L.chromium.launch();
  const { page } = await L.open(b, 'token=t12345&allowAdd=false&allowDelete=false');
  const f0 = L.fakeLog().length;
  await L.submit(page, 'after restart');
  await page.waitForTimeout(8000);
  console.log(JSON.stringify(L.fakeLog().slice(f0).map(e => ({ url: e.url, model: e.model }))));
  await page.screenshot({ path: `${L.H}/out/D-D-after-restart.png` });
  await b.close();
})();
