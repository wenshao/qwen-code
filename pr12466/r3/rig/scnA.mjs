// Scenario A: sender opens "View tool calls" on their own message (R2 blocking finding).
import { openShell, send, sleep, SHOTS } from './lib.mjs';
import fs from 'node:fs';
const port = Number(process.argv[2]); const tag = process.argv[3]; const mode = process.argv[4] || 'running';
const profile = `/private/var/tmp/pr12466/prof-${tag}-${mode}`; fs.rmSync(profile, { recursive: true, force: true });
let { ctx, page, requests, errors } = await openShell(port, { profile });
const out = { tag, mode, phases: {} };
const state = async (label) => {
  const s = await page.evaluate(() => {
    const panel = document.querySelector('section[aria-label="Tool calls"]');
    const rows = [...document.querySelectorAll('ul[data-web-shell-turn-calls] > li')].map((li) => li.innerText.replace(/\s+/g, ' ').slice(0, 120));
    const combo = panel?.querySelector('[role="combobox"][aria-label="Prompt"]');
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/panel|artifact|dock|tab/i.test(k)) ls[k] = localStorage.getItem(k); }
    return { panel: !!panel, rows, combo: combo?.innerText, notice: panel?.querySelector('[role=alert],[role=status]')?.innerText, ls };
  });
  s.toolCallsReqs = requests.filter((r) => r.url.includes('/tool-calls'));
  out.phases[label] = s; return s;
};
await send(page, `SCN:slow sender-${mode}`);
await sleep(mode === 'running' ? 1500 : mode === 'instant' ? 0 : 9500);
const btn = page.getByRole('button', { name: 'View tool calls' }).last();
await btn.hover(); await btn.click();
await sleep(800);
await state('opened');
await page.screenshot({ path: `${SHOTS}/A-${tag}-${mode}-1-opened.png` });
// open selector to see check mark
const combo = page.locator('section[aria-label="Tool calls"] [role="combobox"][aria-label="Prompt"]');
await combo.click(); await sleep(500);
out.selectorOptions = await page.$$eval('[role="listbox"] [role="option"]', (os) => os.map((o) => ({ text: o.innerText.replace(/\s+/g, ' ').slice(0, 60), selected: o.getAttribute('aria-selected') })));
await page.screenshot({ path: `${SHOTS}/A-${tag}-${mode}-2-selector.png` });
await page.keyboard.press('Escape'); await sleep(300);
await page.getByText('slow done').first().waitFor({ timeout: 30000 });
await sleep(2500);
const reqBeforeSettle = out.phases.opened.toolCallsReqs.length;
await state('settled');
out.readsAfterSettle = out.phases.settled.toolCallsReqs.filter((r) => r.method).length;
await page.screenshot({ path: `${SHOTS}/A-${tag}-${mode}-3-settled.png` });
await page.goto(page.url().split('?')[0].split('#')[0] + '?language=en&token=tok12466'); await page.waitForSelector('.cm-content', { timeout: 60000 }); await sleep(4000);
await state('reloaded');
await page.screenshot({ path: `${SHOTS}/A-${tag}-${mode}-4-reloaded.png` });
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${SHOTS}/A-${tag}-${mode}.json`, JSON.stringify({ ...out, requests }, null, 1));
await ctx.close();
