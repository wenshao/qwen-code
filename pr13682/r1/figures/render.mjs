// Render each HTML card to PNG (element screenshot of .card).
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_ROOT ?? process.cwd() + '/package.json');
const { chromium } = require('playwright');
const dir = process.argv[2];
const files = process.argv.slice(3);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1460, height: 900 }, deviceScaleFactor: 1.5 });
for (const f of files) {
  await page.goto(`file://${dir}/${f}.html`);
  await page.waitForTimeout(300);
  await page.locator('.card').screenshot({ path: `${dir}/${f}.png` });
  console.log('rendered', f);
}
await browser.close();
