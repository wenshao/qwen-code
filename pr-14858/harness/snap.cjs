// usage: node snap.cjs <url> <out.png> <lang> [waitText]
const { chromium } = require('/root/verify/pr14858/wt-head/node_modules/playwright');
const fs = require('node:fs');
const [url, out, lang, waitText] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((l) => localStorage.setItem('qwen-code-web-shell-language', l), lang);
  const p = await ctx.newPage();
  await p.goto(url);
  if (waitText) await p.getByText(waitText).first().waitFor({ timeout: 60000 }).catch(() => console.log('waitText not found'));
  await p.waitForTimeout(6000);
  await p.screenshot({ path: out });
  const main = await p.locator('main').first().innerText().catch(() => p.locator('body').innerText());
  fs.writeFileSync(out.replace(/\.png$/, '.txt'), main);
  console.log(main.slice(0, 1500));
  await b.close();
})();
