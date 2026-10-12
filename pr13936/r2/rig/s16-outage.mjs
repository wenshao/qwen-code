// S16: read outage while the panel is open. The gateway answers /tasks/query with 503 for 30 s.
// Counts how often the error alert (role=alert) and "Loading…" (role=status) are inserted, whether the
// cached task rows stay visible, and that the panel recovers once reads succeed again.
// usage: ARM=merge|cand node s16-outage.mjs <db> [list|detail]
import { chromium, openPage, launchChild, sleep, out, gw } from './lib.mjs';
const [db = 'db1', view = 'list'] = process.argv.slice(2);
const arm = process.env.ARM ?? 'merge';
await gw('/nodelay');
const { sid } = await launchChild(db, 'ou');
const browser = await chromium.launch();
const { page, errors } = await openPage(browser, { sid });
await page.getByRole('button', { name: 'Child Agent tasks' }).click();
const panel = page.locator('[data-managed-task-panel]');
await panel.getByRole('button', { name: /Child Agent · / }).first().waitFor({ timeout: 20000 });
if (view === 'detail') {
  await panel.getByRole('button', { name: /Child Agent · / }).first().click();
  await panel.getByText('State history').waitFor();
}
await sleep(2000);
await page.evaluate(() => {
  const w = window; w.__c = { alert: 0, loading: 0, status: 0, rowsGone: 0 };
  const p = document.querySelector('[data-managed-task-panel]');
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const role = n.getAttribute('role');
      if (role === 'alert') w.__c.alert++;
      if (role === 'status') { w.__c.status++; if (/Loading/.test(n.textContent)) w.__c.loading++; }
    }
  }).observe(p, { subtree: true, childList: true });
  w.__rows = setInterval(() => { if (!/Child Agent · |State history/.test(p.innerText)) w.__c.rowsGone++; }, 100);
});
await gw('/fail?path=/tasks/query&status=503');
await sleep(30000);
const during = await page.evaluate(() => ({ ...window.__c }));
await page.screenshot({ path: `shots/S16-${arm}-${view}-outage.png` });
const alertText = await panel.locator('[role="alert"]').allInnerTexts().catch(() => []);
await gw('/nodelay');
await sleep(5000);
const recovered = { alertsLeft: await panel.locator('[role="alert"]').count(), text: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 160) };
out('S16.jsonl', { tag: 'S16', arm, view, sid, windowSec: 30, during, alertText, recovered, errors: errors.filter((e) => !/503/.test(e)).slice(0, 3) });
await browser.close();
process.exit(0);
