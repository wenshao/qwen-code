// usage: node render.mjs <html> <png> [width]  — Playwright chromium, 2x, element screenshot; reports clipped <pre>/<td>
import { chromium } from '/Users/wenshao/pr13545-rig/src-head/node_modules/playwright/index.mjs';
const [html, png, width = '1600'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 400 }, deviceScaleFactor: 2 });
await page.goto(`file://${html}`);
await page.waitForTimeout(200);
const clipped = await page.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
await page.locator('#card').screenshot({ path: png });
await browser.close();
console.log('wrote', png, 'clipped', clipped);
