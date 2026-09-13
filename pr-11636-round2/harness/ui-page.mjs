// ARM=head|pre node ui-page.mjs <sid> <historyPageSize> <tag>
// Open a session whose first history page is bounded (real daemon pagination,
// the client's own historyPageSize shrunk on the wire) so the completion
// record that supplies the marker's task descriptor falls outside the page.
import pw from '../wtHEAD/node_modules/playwright/index.js';
import * as O from './obs.mjs';
import * as U from './ui.mjs';
const sid = process.argv[2];
const pageSize = Number(process.argv[3] || 3);
const tag = process.argv[4] || `page${pageSize}`;
const label = `${O.ARM}-${tag}`;
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('qwen-code-web-shell-sidebar-width', '320'); } catch {} });
const page = await ctx.newPage();
const errors = []; const loads = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.route('**/load', async (route) => {
  const req = route.request();
  if (req.method() !== 'POST') return route.continue();
  let body = {};
  try { body = JSON.parse(req.postData() || '{}'); } catch {}
  const before = body.historyPageSize;
  body.historyPageSize = pageSize;
  loads.push({ before, after: pageSize });
  await route.continue({ postData: JSON.stringify(body) });
});
await page.goto(`${O.BASE}/session/${sid}#token=${O.TOKEN}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content', { timeout: 30000 });
await page.waitForTimeout(6000);
const deep = await page.evaluate(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const counts = {};
  for (const b of q('button')) { const n = (b.innerText || b.getAttribute('aria-label') || '').trim(); if (n) counts[n] = (counts[n] || 0) + 1; }
  return { buttons: counts, markers: q('[data-background-turn-start]').map((el) => el.innerText.replace(/\s+/g, ' ').trim()), bodyText: document.body.innerText };
});
const facts = await U.facts(page, sid, []);
const shot = await U.shot(page, label, { fullPage: true });
O.save(`${U.SHOTS}/../runs/${label}.json`, { arm: O.ARM, sid, pageSize, loads, facts, deep, errors, shot });
console.log(label, JSON.stringify({ loads, markers: deep.markers, userRows: facts.userRows, expandSteps: facts.expandSteps, collapseSteps: facts.collapseSteps, errors }));
const t = deep.bodyText; const i = t.indexOf('Archived');
console.log('--- transcript ---\n' + t.slice(i + 8, i + 900));
await browser.close(); process.exit(0);
