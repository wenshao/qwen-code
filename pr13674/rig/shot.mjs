// Screenshot the merge-arm WebShell host page for one Session.
// usage: node shot.mjs <sessionId> <out.png> [lang]
import { chromium } from '/Users/wenshao/pr13674-rig/src-merge/node_modules/playwright/index.mjs';
const [sid, out, lang = 'en'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:5674/e2e/fixtures/rig-13674.html?session=${sid}&lang=${lang}`);
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea, [contenteditable="true"]')].map((e) => ({ tag: e.tagName, disabled: e.disabled ?? null, aria: e.getAttribute('aria-disabled'), ph: e.getAttribute('placeholder') }));
  const buttons = [...document.querySelectorAll('button')].map((b) => ({ t: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40), d: b.disabled })).filter((b) => b.t);
  return { ta, buttons, text: document.body.innerText.slice(0, 2500) };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: out, fullPage: false });
await browser.close();
