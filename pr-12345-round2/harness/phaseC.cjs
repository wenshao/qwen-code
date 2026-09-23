const L = require('./lib.cjs');
const settingsPath = L.H + '/qhome/settings.json';
const S = () => JSON.parse(L.fs.readFileSync(settingsPath, 'utf8'));
const res = []; function rec(step, o) { res.push({ step, ...o }); console.log('D', step, JSON.stringify(o)); }
(async () => {
  const b = await L.chromium.launch();
  const { page, wire } = await L.open(b, 'token=t12345&allowAdd=false&allowDelete=false');
  await L.submit(page, 'phaseC start');
  await page.getByText(/ACK from fake-a/).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  // Set current Fake Model B via settings
  await L.submit(page, '/settings');
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: /^Model/ }).click();
  const mm = page.getByTestId('model-management');
  await mm.getByText('Fake Model B').first().waitFor();
  let t0 = Date.now();
  await mm.getByRole('button', { name: 'Set current Fake Model B' }).click();
  await page.waitForTimeout(2500);
  rec('set current B', { wire: wire.filter(w => w.t >= t0).map(w => w.m + ' ' + w.u + ' ' + w.body.slice(0, 150)), modelName: S().model?.name });
  // Edit context window of Fake Model A
  t0 = Date.now();
  await mm.getByRole('button', { name: 'Edit context window Fake Model A' }).click();
  await page.waitForTimeout(800);
  const input = page.locator('input[type="number"], input[inputmode="numeric"]').first();
  let ctxOk = false;
  if (await input.count()) { await input.fill('65536'); await page.keyboard.press('Enter'); await page.waitForTimeout(2500); ctxOk = true; }
  const provA = (S().modelProviders?.openai || []).find(m => m.id === 'fake-a');
  rec('edit context window A', { inputFound: ctxOk, wire: wire.filter(w => w.t >= t0).map(w => w.m + ' ' + w.u + ' ' + w.body.slice(0, 200)), fakeA: provA });
  await mm.screenshot({ path: `${L.H}/out/C-D-after-edits.png` });
  await page.keyboard.press('Escape');
  // back to chat, check model used
  await page.getByTestId('panel-back').click().catch(() => {});
  await page.waitForTimeout(1000);
  let f0 = L.fakeLog().length;
  await L.submit(page, 'which model now');
  await page.waitForTimeout(6000);
  rec('prompt after switch', { fake: L.fakeLog().slice(f0).map(e => e.model + ':' + e.lastUser.slice(-30)) });
  // /model dialog: switch back to A
  t0 = Date.now();
  await L.submit(page, '/model');
  await page.waitForTimeout(1500);
  const dlg = page.getByRole('dialog');
  rec('/model dialog', { dialogs: await dlg.count(), text: (await dlg.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300), wire: wire.filter(w => w.t >= t0).map(w => w.m + ' ' + w.u) });
  await page.screenshot({ path: `${L.H}/out/C-D-model-dialog.png` });
  await dlg.getByText('Fake Model A').first().click().catch(e => console.log('noclick', e.message));
  await page.waitForTimeout(2000);
  f0 = L.fakeLog().length;
  await L.submit(page, 'model after /model');
  await page.waitForTimeout(6000);
  rec('prompt after /model', { fake: L.fakeLog().slice(f0).map(e => e.model + ':' + e.lastUser.slice(-30)) });
  // /config write of provider credentials (scope probe)
  const before = S().security?.auth;
  t0 = Date.now(); f0 = L.fakeLog().length;
  await L.submit(page, '/config security.auth.baseUrl=http://127.0.0.1:9/v1');
  await page.waitForTimeout(3000);
  await L.submit(page, '/config security.auth.apiKey=sk-injected-by-composer');
  await page.waitForTimeout(3000);
  rec('/config provider credentials', { before, after: S().security?.auth, promptPosts: L.promptPosts(wire, t0).map(w => w.body.slice(0, 120)), fakeModelCalls: L.fakeLog().length - f0 });
  await page.screenshot({ path: `${L.H}/out/C-D-config-write.png` });
  L.fs.writeFileSync(`${L.H}/out/phaseC-D.json`, JSON.stringify(res, null, 2));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
