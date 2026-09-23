// Select a search hit whose assistant text lives inside a collapsed
// "Processed … · N tool calls" group (pre-tool text). Is the target revealed?
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:24235';
const TOKEN = 'verify-token-12234';
const SID = require('./out-realmodel/steps.json').sessionId;
const OUT = __dirname + '/shots';
const needle = process.env.NEEDLE ?? 'PRE-FIG-1';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/session/${SID}?token=${TOKEN}&language=en`);
  await page.locator('[data-web-shell-composer-editor] .cm-content').waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  const visibleText = async (s) => page.evaluate((s) => {
    const list = document.querySelector('[data-web-shell-message-list]');
    const w = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
    let n; const out = [];
    while ((n = w.nextNode())) {
      if (!n.textContent.includes(s)) continue;
      const el = n.parentElement; const r = el.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.push({ inViewport: r.bottom > lr.top && r.top < lr.bottom && r.height > 0, h: Math.round(r.height), display: cs.display, vis: cs.visibility, text: n.textContent.slice(0, 60) });
    }
    return out;
  }, s);
  console.log('before, text nodes containing needle:', JSON.stringify(await visibleText(needle + ':')));
  await page.getByRole('button', { name: /^Search this conversation$/ }).click();
  const dialog = page.locator('[data-conversation-search]');
  await dialog.locator('input').fill(needle);
  await page.waitForTimeout(1500);
  const rows = (await dialog.getByRole('option').allTextContents()).map((t) => t.replace(/\s+/g, ' ').slice(0, 80));
  console.log('rows', JSON.stringify(rows));
  const idx = rows.findIndex((r) => r.startsWith('Assistant'));
  await dialog.getByRole('option').nth(idx).click();
  await dialog.waitFor({ state: 'detached', timeout: 30000 }).catch(() => console.log('dialog did not close'));
  const alert = await dialog.locator('[role=alert]').allTextContents().catch(() => []);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/r3-collapsed-hit-${needle}.png` });
  const flashes = await page.locator('[class*="flash"]').evaluateAll((els) => els.map((e) => ({ text: e.textContent.replace(/\s+/g, ' ').slice(0, 100), h: Math.round(e.getBoundingClientRect().height), top: Math.round(e.getBoundingClientRect().top) })));
  console.log('alert', JSON.stringify(alert));
  console.log('flash elements', JSON.stringify(flashes));
  console.log('after, text nodes containing needle:', JSON.stringify(await visibleText(needle + ':')));
  await browser.close();
})().catch((e) => { console.error('ERR', e); process.exit(2); });
