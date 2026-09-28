// usage: node shot.mjs <url> <out.png> [width] [height] [waitText]
import { createRequire } from 'node:module';
const require = createRequire('/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad/wt-pr/packages/web-shell/package.json');
const { chromium } = require('@playwright/test');
const [url, outFile, w = '1360', h = '860', waitText] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
page.on('response', (r) => { if (r.url().includes('/api/agent/')) logs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto(url, { waitUntil: 'load' });
if (waitText) await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 20000 }).catch((e) => logs.push('waitText failed: ' + e.message.slice(0, 120)));
await page.waitForTimeout(1500);
await page.screenshot({ path: outFile });
console.log(logs.slice(-15).join('\n'));
await browser.close();
