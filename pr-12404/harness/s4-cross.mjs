// s4-cross.mjs <label> — open the "Review ..." session in whatever daemon/runtime is running; report tags.
import { launch, UI_URL, OUT, sleep, userTags, userBubbleTexts, save } from './ui.mjs';
const [label] = process.argv.slice(2);
const { browser, page, log } = await launch();
await page.goto(UI_URL); await sleep(4000);
if (await page.getByText('Show all').count()) { await page.getByText('Show all').first().click(); await sleep(1200); }
await page.locator('text=/^Review/').first().click(); await sleep(5000);
const tags = await userTags(page); const bubbles = await userBubbleTexts(page);
await page.screenshot({ path: `${OUT}/cross-${label}.png` });
console.log(`[${label}] tags=${tags.length}`, JSON.stringify(tags.map((t) => t.text)), 'bubble=', JSON.stringify(bubbles[0]));
console.log(`[${label}] pageerrors:`, log.filter((l) => l.startsWith('[pageerror]')).length, 'errorBoundary:', await page.getByText('Something went wrong').count());
save(`cross-${label}.json`, { tags, bubbles, log });
await browser.close();
