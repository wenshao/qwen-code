// Round 3: screenshot the h4 WebShell host page as one actor; optionally click Allow and capture the answer.
// usage: node shot-r3.mjs <sessionId> <actor> <out.png> [click] [lang]
import { chromium } from '/Users/wenshao/pr13674-rig/src-merge/node_modules/playwright/index.mjs';
const [sid, actor, out, click = '', lang = 'en'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const answers = [];
page.on('response', async (r) => {
  if (r.url().includes('/actions/respond')) answers.push({ status: r.status(), body: (await r.text().catch(() => '')).slice(0, 300) });
});
await page.goto(`http://127.0.0.1:5674/e2e/fixtures/rig-13674.html?session=${sid}&actor=${actor}&lang=${lang}`);
await page.waitForTimeout(7000);
const buttons = async () => page.evaluate(() => [...document.querySelectorAll('button')].map((b) => ({ t: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40), d: b.disabled })).filter((b) => b.t));
const before = await buttons();
if (click) {
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^(Yes, allow once|是，允许一次|允许一次)/.test((x.innerText || '').trim()));
    if (b) b.click();
    return b ? b.innerText.trim() : null;
  });
  console.error('clicked', clicked);
  await page.waitForTimeout(3500);
}
const notices = await page.evaluate(() => [...document.querySelectorAll('[role=alert],[role=status]')].map((e) => (e.innerText ?? e.textContent ?? '').trim()).filter(Boolean));
console.log(JSON.stringify({ actor, before, after: await buttons(), notices, answers }, null, 1));
await page.screenshot({ path: out, fullPage: false });
await browser.close();
