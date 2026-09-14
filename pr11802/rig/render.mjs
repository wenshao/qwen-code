// usage: PW_ROOT=<wt> node render.mjs <in.html> <out.png> [width]
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_ROOT + '/package.json');
const { chromium } = require('playwright');
const [inp, out, w] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: Number(w || 1200), height: 600 }, deviceScaleFactor: 2 });
await page.goto('file://' + inp, { waitUntil: 'load' });
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('rendered', out);
