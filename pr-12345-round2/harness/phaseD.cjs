const L = require('./lib.cjs');
(async () => {
  const b = await L.chromium.launch();
  const { page, wire } = await L.open(b, 'token=t12345&allowAdd=false&allowDelete=false');
  await L.submit(page, 'phaseD start');
  await page.getByText(/ACK from/).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  for (const c of ['/config model.name=unlisted-model', '/config model.baseUrl=http://127.0.0.1:18345/injected/v1', '/config security.auth.baseUrl=http://127.0.0.1:18345/injected/v1']) {
    await L.submit(page, c); await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: `${L.H}/out/D-D-config-injection.png` });
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
