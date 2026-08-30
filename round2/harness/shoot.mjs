import { chromium } from '/Users/wenshao/git/qwen-code/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2], outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 200 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  await page.goto('file://' + path.resolve(dir, f));
  await page.waitForTimeout(400);
  const out = path.join(outDir, f.replace(/\.html$/, '.png'));
  await page.screenshot({ path: out, fullPage: true });
  const dim = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  console.log('shot', path.basename(out), dim.join('x'));
}
await browser.close();
