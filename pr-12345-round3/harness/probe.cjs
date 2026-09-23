const L = require('./lib.cjs');
const ARM = process.argv[2]; const BASE = process.argv[3];
const out = { arm: ARM, steps: [] };
function rec(step, o) { out.steps.push({ step, ...o }); console.log(ARM, step, JSON.stringify(o)); }
async function menuItems(page) {
  return (await page.locator('[role="listbox"] [role="option"], [role="option"]').allInnerTexts().catch(() => [])).map(s => s.split('\n')[0].trim());
}
async function tryCmd(page, wire, editor, submitBtn, cmd, shot) {
  const t0 = Date.now(), f0 = L.fakeLog().length;
  await L.typeIn(page, editor, cmd);
  await page.keyboard.press('Escape');
  await submitBtn.click();
  await page.waitForTimeout(700);
  const toasts = await L.toastText(page);
  if (shot) await page.screenshot({ path: `${L.H}/out/${ARM}-${shot}.png` });
  await page.waitForTimeout(3000);
  const r = { toasts, promptPosts: L.promptPosts(wire, t0).map(w => w.u.replace(/[0-9a-f-]{36}/g, '<sid>') + ' ' + w.body.slice(0, 80)), fakeModelCalls: L.fakeLog().slice(f0).map(e => e.lastUser.slice(-60)), editorAfter: (await editor.innerText()).trim() };
  rec(cmd, r);
  return r;
}
(async () => {
  const b = await L.chromium.launch();
  // --- split view with two real sessions
  const s = [];
  for (let i = 0; i < 2; i++) { const r = await L.api('POST', '/session', { cwd: L.H + '/ws', sessionScope: 'thread' }); s.push(r.body.sessionId || r.body.id); }
  rec('sessions', { s });
  const { page, wire } = await L.open(b, BASE, `token=${L.TOKEN}&allowAdd=false&allowDelete=false&split=${s.join(',')}`);
  await page.waitForTimeout(2500);
  const editors = page.locator('[data-web-shell-composer-editor] .cm-content');
  const submits = page.locator('[data-web-shell-composer-submit]');
  rec('split composers', { editors: await editors.count() });
  const ed = editors.first();
  await L.typeIn(page, ed, '/');
  await page.waitForTimeout(800);
  const all = await menuItems(page);
  await L.typeIn(page, ed, '/au');
  await page.waitForTimeout(800);
  const au = await menuItems(page);
  await page.screenshot({ path: `${L.H}/out/${ARM}-split-menu-au.png` });
  rec('split pane menu', { total: all.length, hasAuth: all.some(x => /^\/?auth\b/.test(x)), afterAu: au });
  await page.keyboard.press('Escape');
  for (const [cmd, shot] of [['/auth', 'split-auth'], ['/connect', null], ['/login from-pane', 'split-login']]) await tryCmd(page, wire, ed, submits.first(), cmd, shot);
  await ctxClose(page);
  // --- main composer + side task
  const m = await L.open(b, BASE, `token=${L.TOKEN}&allowAdd=false&allowDelete=false`);
  const med = m.page.locator('[data-web-shell-composer-editor] .cm-content').first();
  const msub = m.page.locator('[data-web-shell-composer-submit]').first();
  await L.typeIn(m.page, med, `hello ${ARM}`); await msub.click();
  await m.page.getByText(/ACK from fake-a/).first().waitFor({ timeout: 60000 });
  await m.page.waitForTimeout(2000);
  await L.typeIn(m.page, med, '/au'); await m.page.waitForTimeout(800);
  rec('main menu', { afterAu: await menuItems(m.page) });
  await m.page.keyboard.press('Escape');
  for (const cmd of ['/auth', '/connect']) await tryCmd(m.page, m.wire, med, msub, cmd, null);
  await tryCmd(m.page, m.wire, med, msub, '/btw side /auth', 'btw-side-auth');
  rec('side panels after /btw side /auth', { composers: await m.page.locator('[data-web-shell-composer-editor] .cm-content').count() });
  await b.close();
  L.fs.writeFileSync(`${L.H}/out/probe-${ARM}.json`, JSON.stringify(out, null, 2));
})().catch(e => { console.error('FAIL', e); process.exit(1); });
async function ctxClose(page) { await page.context().close(); }
