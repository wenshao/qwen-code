// Prompt selector on the 4,227-turn real session: cost of opening, DOM/heap,
// keyboard Home/End on-demand paging, choosing the first prompt by keyboard.
const { launch, openSession } = require('./lib.cjs');
(async () => {
  const [base, sid, tag] = process.argv.slice(2);
  const { browser, page, wire, errors } = await launch({});
  await openSession(page, base, sid);
  const panel = page.getByRole('region', { name: 'Tool calls' });
  const ti = () => wire.filter(w => w.path === '/turn-index');
  const tc = () => wire.filter(w => w.path === '/tool-calls');
  await page.getByRole('button', { name: 'View tool calls' }).last().click();
  await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(2500);
  const ti0 = ti().length, tc0 = tc().length;
  const t0 = Date.now();
  await panel.getByRole('combobox', { name: 'Prompt' }).click();
  await page.getByRole('option').first().waitFor({ timeout: 120000 });
  let n = 0, same = 0;
  while (same < 4) { await page.waitForTimeout(250); const m = await page.getByRole('option').count(); same = m === n ? same + 1 : 0; n = m; }
  const openMs = Date.now() - t0 - 1000;
  await page.evaluate(() => window.gc && window.gc());
  const dom = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
  const setsize = await page.getByRole('option').first().getAttribute('aria-setsize');
  const tiOpen = ti().length - ti0;
  await page.screenshot({ path: `shots-r2/listbox-${tag}-open.png`, clip: { x: 1060, y: 0, width: 500, height: 420 } });
  // Home: jump to the first prompt (a page that was never loaded).
  const ti1 = ti().length; const t1 = Date.now();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => { const o = document.querySelector('[role=option][aria-posinset="1"]'); return o && !/Loading/.test(o.textContent); }, null, { timeout: 30000 }).catch(() => {});
  const homeMs = Date.now() - t1;
  const firstLabel = await page.locator('[role=option][aria-posinset="1"]').innerText().catch(() => null);
  const tiHome = ti().slice(ti1).map(w => w.search);
  await page.screenshot({ path: `shots-r2/listbox-${tag}-home.png`, clip: { x: 1060, y: 0, width: 500, height: 420 } });
  const optsAtHome = await page.getByRole('option').count();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  const chosen = { trigger: await panel.getByRole('combobox', { name: 'Prompt' }).innerText(), rows: await panel.locator('[data-web-shell-turn-calls] > li').count(), toolCallReads: tc().slice(tc0).map(w => ({ status: w.status, events: w.events })) };
  await page.screenshot({ path: `shots-r2/listbox-${tag}-chosen.png`, clip: { x: 1060, y: 0, width: 500, height: 520 } });
  console.log(JSON.stringify({ options: n, setsize, openToStableMs: openMs, turnIndexRequestsOnOpen: tiOpen, dom, homeMs, firstLabel, tiHome, optsAtHome, chosen, errors }));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
