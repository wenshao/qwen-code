const L = require('./lib.cjs');
const ARM = process.argv[2]; // D or C
const q = 'token=t12345' + (ARM === 'D' ? '&allowAdd=false&allowDelete=false' : '');
const res = { arm: ARM, steps: [] };
function rec(step, o) { res.steps.push({ step, ...o }); console.log(ARM, step, JSON.stringify(o)); }
(async () => {
  const b = await L.chromium.launch();
  const { page, wire } = await L.open(b, q);
  // 1. /auth on the welcome composer (no session, no command snapshot)
  let t0 = Date.now(), f0 = L.fakeLog().length;
  await L.submit(page, '/auth');
  await page.waitForTimeout(3000);
  const authDialog = await page.getByText(/Select Authentication|Authentication Method|Choose.*auth|Connect a provider|provider/i).count();
  rec('welcome /auth', { toasts: await L.toastText(page), sessionPosts: L.sessionPosts(wire, t0).length, promptPosts: L.promptPosts(wire, t0).map(w => w.body), fakeModelCalls: L.fakeLog().length - f0, dialogTextHits: authDialog, dialogs: await page.getByRole('dialog').count() });
  await page.screenshot({ path: `${L.H}/out/M-${ARM}-01-welcome-auth.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  // 2. ordinary prompt creates a real session
  t0 = Date.now(); f0 = L.fakeLog().length;
  await L.submit(page, `hello from arm ${ARM}`);
  await page.getByText(/ACK from fake-a/).first().waitFor({ timeout: 60000 });
  rec('hello', { sessionPosts: L.sessionPosts(wire, t0).length, promptPosts: L.promptPosts(wire, t0).length, fake: L.fakeLog().slice(f0).map(e => e.model + ':' + e.lastUser.slice(-40)) });
  await page.waitForTimeout(2000);
  // 3. setup commands inside a live session (command snapshot loaded)
  for (const cmd of ['/auth', '/login', '/connect', '/  auth', '/auth openai', '/AUTH']) {
    t0 = Date.now(); f0 = L.fakeLog().length;
    await L.submit(page, cmd);
    await page.waitForTimeout(3500);
    rec('session ' + JSON.stringify(cmd), { toasts: await L.toastText(page), promptPosts: L.promptPosts(wire, t0).map(w => w.body), fakeModelCalls: L.fakeLog().length - f0, fakeLast: L.fakeLog().slice(f0).map(e => e.lastUser.slice(-60)), dialogs: await page.getByRole('dialog').count() });
    await page.screenshot({ path: `${L.H}/out/M-${ARM}-03-${cmd.replace(/[^a-z]/gi, '_')}.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const dlg = page.getByRole('dialog'); if (await dlg.count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  }
  // 4. ordinary chat still usable after refusals
  t0 = Date.now(); f0 = L.fakeLog().length;
  await L.submit(page, `still usable ${ARM}`);
  await page.waitForTimeout(5000);
  rec('after refusals', { promptPosts: L.promptPosts(wire, t0).length, fake: L.fakeLog().slice(f0).map(e => e.model + ':' + e.lastUser.slice(-40)) });
  L.fs.writeFileSync(`${L.H}/out/phaseA-${ARM}-mutant.json`, JSON.stringify(res, null, 2));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
