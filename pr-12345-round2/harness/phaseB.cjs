const L = require('./lib.cjs');
const ARM = process.argv[2];
const q = 'token=t12345' + (ARM === 'D' ? '&allowAdd=false&allowDelete=false' : '');
const res = []; function rec(step, o) { res.push({ step, ...o }); console.log(ARM, step, JSON.stringify(o)); }
(async () => {
  const b = await L.chromium.launch();
  const { page, wire } = await L.open(b, q);
  await L.submit(page, `phaseB ${ARM}`);
  await page.getByText(/ACK from fake-a/).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await L.submit(page, '/settings');
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: /^Model/ }).click();
  const mm = page.getByTestId('model-management');
  await mm.getByText('Fake Model B').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const buttons = (await mm.getByRole('button').allInnerTexts()).map(s => s.trim());
  const aria = await mm.getByRole('button').evaluateAll(els => els.map(e => e.getAttribute('aria-label') || e.textContent.trim()));
  rec('settings/model buttons', { add: await page.getByRole('button', { name: '+ Add Model', exact: true }).count(), deleteBtns: aria.filter(a => /^Delete /.test(a)), all: aria });
  await mm.screenshot({ path: `${L.H}/out/B-${ARM}-model-section.png` });
  L.fs.writeFileSync(`${L.H}/out/phaseB-${ARM}.json`, JSON.stringify(res, null, 2));
  await page.screenshot({ path: `${L.H}/out/B-${ARM}-settings-full.png` });
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
