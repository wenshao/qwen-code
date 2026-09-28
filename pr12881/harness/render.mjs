// Renders evidence cards (cards.json) to PNG with Playwright.
// Line prefixes: "## " heading, "++ " pass (green), "-- " fail (red),
// "!! " warning (amber), "== " muted; anything else plain.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(here, '..', 'wt-base', 'package.json'));
const { chromium } = require('playwright');
const cards = JSON.parse(fs.readFileSync(path.join(here, 'cards.json'), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const line = (l) => {
  const map = { '## ': 'h', '++ ': 'ok', '-- ': 'bad', '!! ': 'warn', '== ': 'mute' };
  const k = Object.keys(map).find((p) => l.startsWith(p));
  return k ? `<span class="${map[k]}">${esc(l.slice(3))}</span>` : esc(l);
};
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{display:inline-block;padding:28px 32px;background:#0d1117;color:#e6edf3;min-width:900px}
h1{font-size:24px;margin:0 0 4px}.sub{box-sizing:border-box;width:0;min-width:100%;color:#8b949e;font-size:14px;margin:0 0 18px}
.cols{display:flex;gap:18px;align-items:stretch}.col{flex:1 0 auto;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px}
.col h2{font-size:15px;margin:0 0 10px;color:#79c0ff}
pre{margin:0;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden}
.h{color:#79c0ff;font-weight:600}.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.mute{color:#8b949e}
.note{box-sizing:border-box;width:0;min-width:100%;margin-top:16px;border-left:4px solid #d29922;padding:8px 14px;background:#161b22;font-size:14px;line-height:1.5}
.note.good{border-color:#3fb950}`;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2000, height: 1000 } });
for (const c of cards) {
  const cols = c.columns
    .map((col) => `<div class="col">${col.head ? `<h2>${esc(col.head)}</h2>` : ''}<pre>${col.lines.map(line).join('\n')}</pre></div>`)
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(c.title)}</h1><p class="sub">${esc(c.subtitle ?? '')}</p><div class="cols">${cols}</div>${c.note ? `<div class="note ${c.good ? 'good' : ''}">${esc(c.note)}</div>` : ''}</div>`;
  await page.setContent(html);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await page.locator('#card').screenshot({ path: path.join(here, c.file) });
  console.log(`${c.file}${clipped ? `  !! ${clipped} pre block(s) clipped` : ''}`);
}
await browser.close();
