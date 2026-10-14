// usage: PW_ROOT=... node render.mjs <html> <png>
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_ROOT + '/package.json');
const { chromium } = require('playwright');
const [src, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await p.goto('file://' + src);
await p.locator('.card').screenshot({ path: out });
await b.close();
console.log(out);
