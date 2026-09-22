const L = require('./lib.cjs');
(async () => {
  const { browser, page } = await L.launch('chromium');
  await L.openTrajectory(page, 'http://127.0.0.1:17434', process.argv[2]);
  const headers = () => page.evaluate(() => { const el = document.querySelector('[data-testid="trajectory-rows"]'); el.scrollTop = 0; return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r([...el.querySelectorAll('[data-testid="trajectory-turn"]')].slice(0, 3).map(h => h.textContent))))); });
  const dupes = () => page.evaluate(() => { const el = document.querySelector('[data-testid="trajectory-rows"]'); return el.getAttribute('aria-rowcount'); });
  console.log('page1 top headers', JSON.stringify(await headers()));
  for (let i = 0; i < 2; i++) { const n = Number(await dupes()); await page.getByTestId('trajectory-load-older').click(); await L.waitPageLanded(page, n); console.log(`after page ${i + 2} top headers`, JSON.stringify(await headers()), 'rows', await dupes()); }
  const body = await page.evaluate(() => document.querySelector('[data-testid="trajectory-panel"]').textContent);
  console.log('mentions continued anywhere in mounted rows:', /continued/i.test(body));
  await browser.close();
})();
