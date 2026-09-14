// usage: node shots.mjs --port P --token T --out DIR --label X --sessions A=<id>,B=<id> [--wait 4000]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_ROOT + '/package.json');
const { chromium } = require('playwright');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']); return acc; }, []));
const PORT = args.port, TOKEN = args.token, OUT = args.out, LABEL = args.label, WAIT = Number(args.wait || 4000);
fs.mkdirSync(OUT, { recursive: true });
const sessions = args.sessions.split(',').map((kv) => kv.split('='));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: 'dark' });
for (const [name, id] of sessions) {
  const page = await ctx.newPage();
  const url = `http://127.0.0.1:${PORT}/session/${id}?token=${TOKEN}&lang=en`;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(WAIT);
  await page.mouse.move(4, 4);
  const file = path.join(OUT, `${LABEL}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600);
  console.log(`${name} -> ${file}\n  url=${url}\n  text=${text}\n  errors=${errors.length}`);
  await page.close();
}
await browser.close();
