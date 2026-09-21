import { launch, BASE, TOKEN, OUT, sleep } from './ui.mjs';
const sid = process.argv[2];
const { browser, page } = await launch();
let n = 0;
page.on('request', (r) => { if (/\/transcript/.test(r.url())) { n++; console.log('transcript req', n, new URL(r.url()).search.replace(/cursor=[^&]+/, 'cursor=…').slice(0, 160)); } });
await page.goto(`${BASE}/session/${sid}#token=${TOKEN}`); await sleep(7000);
const main = page.getByText('Done. (mock reply)').first();
await main.hover();
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -2000); await sleep(1200); }
await sleep(3000);
console.log('user bubble visible after scrolling up:', await page.locator('[class*="chatBubble"]', { hasText: 'HUGECASE' }).count());
console.log('any "load older"/"earlier" control:', await page.getByText(/load (older|earlier|more)|earlier messages|show more/i).count());
await page.screenshot({ path: `${OUT}/pr-s5-hugecase-scrolled.png` });
await browser.close();
