// Measure the prompt selector on a long real session.
const { launch, openSession } = require('./lib.cjs');
(async () => {
  const [base, sid] = process.argv.slice(2);
  const { browser, page, wire, errors } = await launch({});
  await openSession(page, base, sid);
  const panel = page.getByRole('region', { name: 'Tool calls' });
  await page.getByRole('button', { name: 'View tool calls' }).last().click();
  await panel.waitFor({ state: 'visible' }); await page.waitForTimeout(2000);
  const ti0 = wire.filter(w => w.path === '/turn-index').length;
  const t0 = Date.now();
  await panel.getByRole('combobox', { name: 'Prompt' }).click();
  await page.getByRole('option').first().waitFor({ timeout: 120000 });
  // wait until option count stabilises
  let n = 0, same = 0;
  while (same < 4) { await page.waitForTimeout(250); const m = await page.getByRole('option').count(); same = m === n ? same + 1 : 0; n = m; }
  const openMs = Date.now() - t0 - 1000;
  const dom = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
  const t1 = Date.now(); await page.keyboard.press('End'); await page.waitForTimeout(300); const endMs = Date.now() - t1;
  await page.screenshot({ path: 'shots/listbox-5000.png' });
  await page.keyboard.press('Escape');
  console.log(JSON.stringify({ options: n, openToStableMs: openMs, turnIndexRequestsOnOpen: wire.filter(w => w.path === '/turn-index').length - ti0, dom, errors }));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
