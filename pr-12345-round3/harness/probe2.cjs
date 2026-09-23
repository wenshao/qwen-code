const L = require('./lib.cjs');
const ARM = process.argv[2]; const BASE = process.argv[3];
function rec(step, o) { console.log(ARM, step, JSON.stringify(o)); }
async function fresh(b, allowAdd, split) {
  const q = `token=${L.TOKEN}&allowAdd=${allowAdd}` + (split ? `&split=${split}` : '');
  const o = await L.open(b, BASE, q); await o.page.waitForTimeout(2000); return o;
}
async function one(b, allowAdd, cmd, where) {
  let o, ed, sub;
  if (where === 'split') {
    const s = [];
    for (let i = 0; i < 2; i++) s.push((await L.api('POST', '/session', { cwd: L.H + '/ws', sessionScope: 'thread' })).body.sessionId);
    o = await fresh(b, allowAdd, s.join(','));
    ed = o.page.locator('[data-web-shell-composer-editor] .cm-content').first(); sub = o.page.locator('[data-web-shell-composer-submit]').first();
  } else { // side task pane composer
    o = await fresh(b, allowAdd);
    const med = o.page.locator('[data-web-shell-composer-editor] .cm-content').first(), msub = o.page.locator('[data-web-shell-composer-submit]').first();
    await L.typeIn(o.page, med, `hello side ${ARM}`); await msub.click();
    await o.page.getByText(/ACK from fake-a/).first().waitFor({ timeout: 60000 }); await o.page.waitForTimeout(1500);
    await L.typeIn(o.page, med, '/btw side say hi'); await o.page.keyboard.press('Escape'); await msub.click();
    await o.page.waitForTimeout(6000);
    const n = await o.page.locator('[data-web-shell-composer-editor] .cm-content').count();
    ed = o.page.locator('[data-web-shell-composer-editor] .cm-content').nth(n - 1); sub = o.page.locator('[data-web-shell-composer-submit]').nth(n - 1);
    rec('side composers', { n });
  }
  // menu check in this pane
  await L.typeIn(o.page, ed, '/au'); await o.page.waitForTimeout(800);
  const menu = (await o.page.locator('[role="option"]').allInnerTexts()).map(s => s.split('\n')[0].trim());
  await o.page.keyboard.press('Escape');
  const t0 = Date.now(), f0 = L.fakeLog().length;
  await L.typeIn(o.page, ed, cmd); await o.page.keyboard.press('Escape'); await sub.click();
  await o.page.waitForTimeout(700);
  const toasts = await L.toastText(o.page);
  const shot = `${L.H}/out/p2-${ARM}-${where}-${allowAdd}-${cmd.replace(/[^a-z]/gi, '_')}.png`;
  await o.page.screenshot({ path: shot });
  await o.page.waitForTimeout(3500);
  rec(`${where} allowAdd=${allowAdd} ${cmd}`, { menuAu: menu, toasts, posts: L.promptPosts(o.wire, t0).map(w => JSON.parse(w.body).prompt?.[0]?.text), fake: L.fakeLog().slice(f0).map(e => e.lastUser.slice(-50)) });
  await o.ctx.close();
}
(async () => {
  const b = await L.chromium.launch();
  await one(b, false, '/login from-pane', 'split');
  await one(b, true, '/auth', 'split');
  await one(b, false, '/auth', 'side');
  await one(b, false, '/login side', 'side');
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
