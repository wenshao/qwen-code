import { openShell, sleep, SHOTS } from './lib.mjs';
import fs from 'node:fs';
const { ctx, page, requests, errors } = await openShell(4661, { height: 1000 });
const out = {};
const panelState = () => page.evaluate(() => {
  const panel = document.querySelector('section[aria-label="Tool calls"]');
  return { rows: [...document.querySelectorAll('ul[data-web-shell-turn-calls] > li')].map((li) => li.innerText.replace(/\s+/g, ' ').slice(0, 100)),
    elapsed: [...(panel?.querySelectorAll('[aria-label^="Elapsed"]') ?? [])].map((e) => e.getAttribute('aria-label')),
    combo: panel?.querySelector('[aria-label="Prompt"]')?.innerText, summary: panel?.innerText.split('\n').slice(0, 4).join(' | ') };
});
const rows = page.locator('[class*=sessionRow]');
await rows.filter({ hasText: 'SCN:parallel multi-head' }).first().click();
await page.getByText('parallel done').first().waitFor({ timeout: 60000 }); await sleep(1500);
out.messageAreaTools = await page.$$eval('[data-web-shell-message-list] *', () => null).catch(() => null);
await page.getByRole('button', { name: 'View tool calls' }).first().click(); await sleep(2500);
out.parallel = await panelState();
// hover the elapsed badges for recorded start/end tooltips
out.tooltips = [];
const badges = page.locator('section[aria-label="Tool calls"] [aria-label^="Elapsed"]');
for (let i = 0; i < await badges.count(); i++) { await badges.nth(i).hover(); await sleep(700); out.tooltips.push(await page.$$eval('[role=tooltip]', (ts) => ts.map((t) => t.innerText.replace(/\s+/g, ' ')).join(' / '))); }
await badges.nth(1).hover(); await sleep(700);
await page.screenshot({ path: `${SHOTS}/C-parallel-tooltip.png` });
// expand row 2
await page.locator('ul[data-web-shell-turn-calls] > li').nth(1).locator('button').first().click(); await sleep(1200);
await page.mouse.move(10, 10); await sleep(400);
await page.screenshot({ path: `${SHOTS}/C-parallel-expanded.png` });
// switch to 2nd prompt (fail) through selector
await page.locator('section[aria-label="Tool calls"] [aria-label="Prompt"]').click(); await sleep(800);
out.options = await page.$$eval('[role=listbox] [role=option]', (os) => os.map((o) => o.innerText.replace(/\s+/g, ' ') + (o.getAttribute('aria-selected') === 'true' ? ' ✓' : '')));
await page.locator('[role=listbox] [role=option]').nth(1).click(); await sleep(2500);
out.fail = await panelState();
await page.screenshot({ path: `${SHOTS}/C-fail.png` });
// denied session (history)
await rows.filter({ hasText: 'SCN:approve wire-head' }).first().click();
await sleep(5000);
out.deniedMessageArea = await page.evaluate(() => document.querySelector('[data-web-shell-message-list]')?.innerText.replace(/\s+/g, ' ').slice(0, 400));
await page.getByRole('button', { name: 'View tool calls' }).first().click(); await sleep(2500);
out.denied = await panelState();
await page.screenshot({ path: `${SHOTS}/C-denied.png` });
out.errors = errors; out.reqs = requests.filter((r) => r.url.includes('tool-calls')).length;
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${SHOTS}/C.json`, JSON.stringify(out, null, 1));
await ctx.close();
