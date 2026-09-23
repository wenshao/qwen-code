const { chromium } = require('playwright');
const LONG = require('./seed-long.json').sessionId;
const BASE = 'http://127.0.0.1:14234';
const btn = (p) => p.getByRole('button', { name: /^Search this conversation$/ });
const state = (p) => p.evaluate(() => ({
  url: location.pathname.slice(0, 20), viewport: document.querySelector('[data-history-viewport]')?.getAttribute('data-history-viewport'),
  rail: document.querySelectorAll('[data-global-turn-navigation]').length,
  search: document.querySelectorAll('button[aria-label="Search this conversation"]').length,
  turn3: /Answer #3: common-token/.test(document.querySelector('[data-web-shell-message-list]')?.textContent ?? ''),
  flash: document.querySelector('[class*="flash"]')?.textContent?.slice(0, 30) ?? null,
}));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const log = []; const t0 = Date.now();
  p.on('request', (r) => { const u = new URL(r.url()); if (/events|transcript|turn-index|load$/.test(u.pathname)) log.push(`${((Date.now()-t0)/1000).toFixed(1)} ${u.pathname.split('/').pop()}${u.searchParams.get('atRecordId') ? ' at=' + u.searchParams.get('atRecordId').slice(0,8) : ''}`); });
  await p.goto(`${BASE}/session/${LONG}?token=verify-token-12234`);
  await p.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(2500);
  let armed = false, held = 0;
  await p.route(/\/transcript(\?|$)/, async (route) => { if (!armed) return route.continue(); held++; await new Promise((r) => setTimeout(r, 4000)); route.continue().catch(() => {}); });
  await btn(p).click();
  await p.locator('[data-conversation-search] input').fill('zebra-quartz-7731');
  await p.waitForTimeout(400);
  await p.waitForFunction(() => { const el = document.querySelector('[data-conversation-search] [role=status]'); return el && !/Searching/.test(el.textContent ?? ''); }, undefined, { timeout: 60000 });
  armed = true;
  const mark = log.length;
  await p.locator('[data-conversation-search]').getByRole('option').first().click();
  await p.waitForTimeout(500);
  await ctx.setOffline(true);
  await p.waitForTimeout(5000);
  await ctx.setOffline(false);
  armed = false;
  for (const s of [3, 8, 15, 25]) { await p.waitForTimeout(s === 3 ? 3000 : (s === 8 ? 5000 : s === 15 ? 7000 : 10000)); console.log(`online+${s}s`, JSON.stringify(await state(p))); }
  console.log('held', held, '\n' + log.slice(mark).join('\n'));
  await p.screenshot({ path: __dirname + '/shots/r3-offline-mid-nav.png' });
  // a fresh navigation after the blip
  const dlg = p.locator('[data-conversation-search]');
  console.log('dialog', JSON.stringify({ text: (await dlg.textContent().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400), alerts: await dlg.locator('[role=alert]').allTextContents(), input: await dlg.locator('input').inputValue().catch(() => null), selected: await dlg.locator('[aria-selected=true]').count(), busy: await dlg.locator('[aria-busy=true]').count() }));
  await dlg.screenshot({ path: __dirname + '/shots/r3-offline-dialog.png' }).catch(() => {});
  // retry: click the same hit again now that we are online
  const t1 = Date.now();
  await dlg.getByRole('option').first().click().catch((e) => console.log('click err', e.message.slice(0, 80)));
  await dlg.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await p.locator('[class*="flash"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  console.log('retry-same-hit', Date.now() - t1, 'ms', JSON.stringify(await state(p)), 'dialogStill', await dlg.count());
  console.log('a11y', JSON.stringify(await p.evaluate(() => { const b = document.querySelector('button[aria-label="Search this conversation"]'); const r = b?.getBoundingClientRect(); return { rect: r && [r.x, r.y, r.width, r.height], inert: !!b?.closest('[inert]'), ariaHidden: !!b?.closest('[aria-hidden=true]'), hiddenAttr: !!b?.closest('[hidden]'), dialog: !!document.querySelector('[data-conversation-search]'), active: document.activeElement?.tagName }; })), 'roleCount', await btn(p).count());
  if (await btn(p).count()) {
    await btn(p).click(); await p.locator('[data-conversation-search] input').fill('zebra-quartz-7731'); await p.waitForTimeout(400);
    await p.waitForFunction(() => { const el = document.querySelector('[data-conversation-search] [role=status]'); return el && !/Searching/.test(el.textContent ?? ''); }, undefined, { timeout: 60000 });
    await p.locator('[data-conversation-search]').getByRole('option').first().click();
    await p.locator('[class*="flash"]').first().waitFor({ timeout: 20000 }).catch(() => {});
    console.log('renavigate', JSON.stringify(await state(p)));
  }
  console.log('errors', JSON.stringify(errors));
  await b.close();
})();
