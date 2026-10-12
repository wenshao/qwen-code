// S14: with the panel open on a running task, how often does "Loading…" (role=status) appear and the
// Refresh button disable? Counted by a MutationObserver over 30 s. usage: node s14-flicker.mjs <db> [arm]
import { chromium, openPage, launchChild, sleep, out } from './lib.mjs';
const [db = 'db1', arm = 'merge'] = process.argv.slice(2);
const { sid } = await launchChild(db, 'fl');
const browser = await chromium.launch();
const { page, errors } = await openPage(browser, { sid, arm });
await page.getByRole('button', { name: 'Child Agent tasks' }).click();
const panel = page.locator('[data-managed-task-panel]');
await panel.getByRole('button', { name: /Child Agent · / }).first().click();
await panel.getByText('State history').waitFor();
await sleep(2000);
await page.evaluate(() => {
  const w = window; w.__loading = 0; w.__refreshDisabled = 0; w.__statusInserts = 0;
  const p = document.querySelector('[data-managed-task-panel]');
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.getAttribute('role') === 'status') { w.__statusInserts++; if (n.textContent.includes('Loading')) w.__loading++; }
      }
      if (m.type === 'attributes' && m.attributeName === 'disabled' && m.target.textContent === 'Refresh' && m.target.disabled) w.__refreshDisabled++;
    }
  }).observe(p, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
});
await sleep(30000);
const r = await page.evaluate(() => ({ loadingInserts: window.__loading, statusInserts: window.__statusInserts, refreshDisabledToggles: window.__refreshDisabled }));
out('S14.jsonl', { tag: 'S14', arm, sid, windowSec: 30, ...r, errors });
await browser.close();
process.exit(0);
