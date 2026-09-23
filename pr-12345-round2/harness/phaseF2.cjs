const L = require('./lib.cjs');
(async () => {
  const b = await L.chromium.launch();
  const { page, wire } = await L.open(b, 'token=t12345' + (process.argv[2]==='D' ? '&allowAdd=false&allowDelete=false' : ''));
  // capture the real daemon command snapshot entries for auth/login/connect
  let snap = null;
  page.on('response', async r => { if (/\/commands|\/session\/[^/]+(\/load)?$/.test(r.url()) ) { try { const j = await r.json(); const cmds = j.commands || j.availableCommands || j?.session?.commands; if (cmds) snap = cmds.filter(c => ['auth','login','connect'].includes(c.name) || (c.altNames||[]).some(a => ['login','connect'].includes(a))).map(c => ({ name: c.name, source: c.source, altNames: c.altNames })); } catch {} } });
  await L.submit(page, 'phaseF start'); await page.getByText(/ACK from fake-a/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(2500);
  for (const cmd of ['/auth', '/login']) {
    const t0 = Date.now(), f0 = L.fakeLog().length;
    await L.submit(page, cmd); await page.waitForTimeout(900); const early = await L.toastText(page); const dlg = await page.getByRole('dialog').count(); await page.waitForTimeout(5000);
    console.log(cmd, JSON.stringify({ promptPosts: L.promptPosts(wire, t0).length, toastsAt900ms: early, dialogs: dlg, fake: L.fakeLog().slice(f0).map(e => e.lastUser.slice(0, 80)).filter(s => /PROJECT|login/.test(s)) }));
    await page.screenshot({ path: `${L.H}/out/F-${process.argv[2]}-${cmd.slice(1)}.png` });
  }
  console.log('snapshot', JSON.stringify(snap));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
