const L = require('./lib.cjs');
const res = []; function rec(step, o) { res.push({ step, ...o }); console.log(step, JSON.stringify(o)); }
const setPolicy = (page, p) => page.evaluate(p => window.dispatchEvent(new CustomEvent('model-management-change', { detail: p })), p);
(async () => {
  const b = await L.chromium.launch();
  if (process.argv[2] !== 'E2') {
  // E1: dynamic tightening while the /auth dialog is open (default host)
  {
    const { page, wire } = await L.open(b, 'token=t12345');
    await L.submit(page, 'phaseE start'); await page.getByText(/ACK from fake-a/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
    await L.submit(page, '/auth'); await page.waitForTimeout(1500);
    const before = await page.getByRole('dialog').count();
    await page.screenshot({ path: `${L.H}/out/E1-dialog-open.png` });
    await setPolicy(page, { allowAdd: false, allowDelete: true }); await page.waitForTimeout(1500);
    const after = await page.getByRole('dialog').count();
    await page.screenshot({ path: `${L.H}/out/E1-after-tighten.png` });
    const f0 = L.fakeLog().length, t0 = Date.now();
    await L.submit(page, 'chat after tightening'); await page.waitForTimeout(6000);
    const chat = L.fakeLog().slice(f0).map(e => e.lastUser.slice(-30));
    await L.submit(page, '/auth'); await page.waitForTimeout(1500);
    const refusedDialogs = await page.getByRole('dialog').count();
    const refusedToast = await L.toastText(page);
    await setPolicy(page, {}); await page.waitForTimeout(1500);
    const staleAfterReenable = await page.getByRole('dialog').count();
    await L.submit(page, '/auth'); await page.waitForTimeout(1500);
    const reopened = await page.getByRole('dialog').count();
    rec('E1 dynamic', { dialogBefore: before, dialogAfterTighten: after, chatReachedModel: chat, promptPosts: L.promptPosts(wire, t0).length, authWhileDisabled: { dialogs: refusedDialogs, toast: refusedToast }, staleDialogAfterReenable: staleAfterReenable, reopenedAfterReenable: reopened });
    await page.context().close();
  }
  }
  // E2: URL deep link to /settings (main's new URL navigation) with both controls off
  for (const arm of ['D', 'C']) {
    const q = 'token=t12345' + (arm === 'D' ? '&allowAdd=false&allowDelete=false' : '');
    const { page } = await L.open(b, q, '/agentic-code/settings', false).catch(async e => { console.log('open err', e.message); return {}; });
    if (!page) continue;
    await page.waitForTimeout(2000);
    const url = page.url();
    const nav = page.getByRole('navigation', { name: 'Settings' });
    const onSettings = await nav.count();
    if (onSettings) await nav.getByRole('button', { name: /^Model/ }).click();
    const mm = page.getByTestId('model-management');
    await mm.getByText('Fake Model B').first().waitFor({ timeout: 20000 }).catch(() => {});
    const aria = await mm.getByRole('button').evaluateAll(els => els.map(e => e.getAttribute('aria-label') || e.textContent.trim())).catch(() => []);
    rec('E2 deep link ' + arm, { url: url.replace(L.BASE, ''), settingsNav: onSettings, add: aria.filter(a => /Add Model/.test(a)).length, deletes: aria.filter(a => /^Delete /.test(a)).length, all: aria });
    await page.screenshot({ path: `${L.H}/out/E2-deeplink-${arm}.png` });
    await page.context().close();
  }
  L.fs.writeFileSync(`${L.H}/out/phaseE-${process.argv[2]||'all'}.json`, JSON.stringify(res, null, 2));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
