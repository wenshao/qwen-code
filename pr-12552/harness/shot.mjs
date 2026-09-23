// usage: node shot.mjs in.html out.png
import { chromium } from '/root/verify/pr12522/node_modules/playwright/index.mjs';
const [,, inp, out] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 400 }, deviceScaleFactor: 2 });
await p.goto('file://' + inp);
await p.locator('body > main').screenshot({ path: out });
await b.close();
