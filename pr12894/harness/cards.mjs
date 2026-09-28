// Render evidence cards (HTML -> PNG) with the repo's Playwright.
// usage: node cards.mjs <cards.json> <outDir>
// Line prefixes inside `lines`: "## " heading, "++ " green, "-- " red, "!! " amber, "== " grey, ">> " blue.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(`${process.env.HOME}/git/qwen-code-pr12894-cand4/package.json`);
const { chromium } = require('playwright');
const [specFile, outDir] = process.argv.slice(2);
const cards = JSON.parse(fs.readFileSync(specFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const COLORS = { '## ': '#79c0ff', '++ ': '#3fb950', '-- ': '#f85149', '!! ': '#d29922', '== ': '#8b949e', '>> ': '#a5d6ff' };
function line(l) {
  for (const [p, c] of Object.entries(COLORS)) {
    if (l.startsWith(p)) {
      const body = esc(l.slice(3));
      return p === '## ' ? `<div class="h">${body}</div>` : `<div style="color:${c}">${body || '&nbsp;'}</div>`;
    }
  }
  return `<div>${esc(l) || '&nbsp;'}</div>`;
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
for (const card of cards) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
    #card{display:inline-block;padding:26px 30px 24px;background:#0d1117;color:#c9d1d9;min-width:1100px;max-width:1440px}
    .t{font-size:22px;font-weight:650;color:#f0f6fc;margin-bottom:4px}
    .s{font-size:14px;color:#8b949e;margin-bottom:16px}
    .p{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px;line-height:1.5;white-space:pre;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px;overflow:hidden}
    .h{color:#79c0ff;font-weight:650;margin-top:6px}
    .n{margin-top:14px;border-left:4px solid ${card.noteColor ?? '#d29922'};padding:8px 14px;background:#161b22;font-size:14.5px;line-height:1.5;color:#e6edf3;max-width:1380px}
  </style></head><body><div id="card"><div class="t">${esc(card.title)}</div><div class="s">${esc(card.subtitle ?? '')}</div>
  <div class="p">${card.lines.map(line).join('')}</div>${card.note ? `<div class="n">${esc(card.note)}</div>` : ''}</div></body></html>`;
  await page.setContent(html);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.p')].some((p) => p.scrollWidth > p.clientWidth));
  const file = path.join(outDir, `${card.name}.png`);
  await page.locator('#card').screenshot({ path: file });
  console.log(`${file}${clipped ? '  !! CLIPPED (text wider than box)' : ''}`);
}
await browser.close();
