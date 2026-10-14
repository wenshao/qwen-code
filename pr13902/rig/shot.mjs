// Web Shell screenshot + DOM oracle against the daemon's own bundled Web Shell.
// usage: PW_ROOT=<dir with node_modules/playwright> node shot.mjs --port P --token T
//          --session ID --out file.png [--wait 5000] [--expect "a||b"] [--absent "c||d"]
//          [--json out.json] [--full] [--width 1440 --height 900]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_ROOT + '/package.json');
const { chromium } = require('playwright');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']); return acc; }, []));
const W = Number(args.width || 1440), H = Number(args.height || 900);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const url = `http://127.0.0.1:${args.port}/session/${args.session}?token=${args.token}&lang=en`;
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(Number(args.wait || 5000));
if (args.release) { fs.writeFileSync(args.release, 'go'); await page.waitForTimeout(Number(args.after || 8000)); }
if (args.click) {
  for (const sel of String(args.click).split('||')) {
    const loc = page.getByText(sel, { exact: false }).first();
    if (await loc.count()) { await loc.click().catch(() => {}); await page.waitForTimeout(800); }
  }
}
await page.mouse.move(2, 2);
const text = await page.evaluate(() => document.body.innerText);
const expect = (args.expect ? String(args.expect).split('||') : []).map((s) => ({ s, found: text.includes(s) }));
const absent = (args.absent ? String(args.absent).split('||') : []).map((s) => ({ s, found: text.includes(s) }));
await page.screenshot({ path: args.out, fullPage: args.full === 'true' });
const res = { url: url.replace(args.token, '<token>'), out: args.out, expect, absent, pageErrors: errors.length, textSample: text.replace(/\s+/g, ' ').slice(0, 1500) };
if (args.json) fs.writeFileSync(args.json, JSON.stringify(res, null, 2));
console.log(JSON.stringify({ out: res.out, expect, absent, pageErrors: errors.length }));
await browser.close();
