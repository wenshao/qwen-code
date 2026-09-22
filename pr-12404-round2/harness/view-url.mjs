// view-url.mjs <arm> <label> <url-file> — open a session by URL in a fresh browser, report top-level tags + click the file tag.
import fs from 'node:fs';
import { launch, TOKEN, OUT, sleep, userTags, userBubbleTexts, save } from './ui.mjs';
const [arm, label, from] = process.argv.slice(2);
const url = fs.readFileSync(`${OUT}/${from}`, 'utf8').trim().replace(/#.*$/, '');
const { browser, page, log } = await launch();
await page.goto(`${url}#token=${TOKEN}`); await sleep(6500);
const tags = await userTags(page);
await page.screenshot({ path: `${OUT}/${arm}-${label}.png` });
const fileTag = page.locator('[class*="messageTag"][role="button"]', { hasText: 'README.md' }).first();
let fileResponse = null, previewHasFixture = 0;
if (await fileTag.count()) {
  const w = page.waitForResponse((r) => /\/file\b/.test(new URL(r.url()).pathname), { timeout: 10000 }).catch(() => null);
  await fileTag.click(); const r = await w; fileResponse = r ? r.status() : null; await sleep(1500);
  previewHasFixture = await page.getByText('tag reload test fixture').count();
}
const res = { tags: tags.map((t) => ({ text: t.text, h: t.h, padR: t.padR, radius: t.radius })), bubbles: await userBubbleTexts(page), fileResponse, previewHasFixture, pageErrors: log.filter((l) => l.startsWith('[pageerror]') || /TypeError/.test(l)).length };
console.log(`[${arm}] ${label}:`, JSON.stringify(res));
save(`${arm}-${label}.json`, res);
await browser.close();
