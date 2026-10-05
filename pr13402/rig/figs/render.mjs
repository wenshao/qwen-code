// Renders the PR #13402 evidence cards to PNG with the worktree's Playwright.
// Usage: node render.mjs <card.html>... (writes <card>.png next to each)
import { createRequire } from 'node:module';
import path from 'node:path';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad';
const require = createRequire(`${S}/wt-merge/package.json`);
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
for (const file of process.argv.slice(2)) {
  await page.goto(`file://${path.resolve(file)}`);
  await page.waitForLoadState('load');
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('pre, td, th')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 60)));
  if (clipped.length) console.log(`WARN ${file}: ${clipped.length} clipped cells`, clipped.slice(0, 3));
  const out = file.replace(/\.html$/, '.png');
  await page.locator('#card').screenshot({ path: out });
  console.log(`wrote ${out}`);
}
await browser.close();
