// VERIFICATION RIG ONLY (PR #13174): render evidence cards (cards.json -> PNG) with the repo's Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire('/Users/wenshao/pr13174-rig/wt/package.json');
const { chromium } = require('playwright');
const dir = path.dirname(new URL(import.meta.url).pathname);
const cards = JSON.parse(readFileSync(path.join(dir, 'cards.json'), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const color = (line) => {
  const map = [['## ', '#79c0ff'], ['++ ', '#56d364'], ['-- ', '#f85149'], ['!! ', '#e3b341'], ['== ', '#8b949e']];
  for (const [p, c] of map) if (line.startsWith(p)) return `<span style="color:${c}">${esc((p === '## ' ? '' : '   ') + line.slice(3))}</span>`;
  return esc(line);
};
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
for (const card of cards) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#c9d1d9}
  #card{display:inline-block;padding:28px 34px;background:#0d1117;min-width:900px}
  h1{font-size:24px;margin:0 0 4px;color:#f0f6fc} .sub{font-size:14px;color:#8b949e;margin-bottom:16px}
  pre{font:13.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre;margin:0 0 14px;padding:14px 16px;background:#161b22;border:1px solid #30363d;border-radius:6px}
  .note{border-left:4px solid ${card.accent ?? '#e3b341'};padding:8px 14px;font-size:15px;color:#f0f6fc;background:#161b22;max-width:1300px}
  </style></head><body><div id="card"><h1>${esc(card.title)}</h1><div class="sub">${esc(card.subtitle)}</div>
  ${card.blocks.map((b) => `<pre>${b.map(color).join('\n')}</pre>`).join('')}
  <div class="note">${esc(card.note)}</div></div></body></html>`;
  await page.setContent(html);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  if (clipped) console.log(`WARN ${card.file}: ${clipped} pre block(s) clipped`);
  await page.locator('#card').screenshot({ path: path.join(dir, card.file) });
  console.log('wrote', card.file);
}
await browser.close();
