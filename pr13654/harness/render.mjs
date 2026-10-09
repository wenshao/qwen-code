// Render evidence cards (cards/*.txt) to PNG with Playwright.
// Card format: line 1 = title, line 2 = subtitle, then body lines.
// Body prefixes: "## " section heading, "++ " green, "-- " red, "!! " amber, "== " muted, ">> " note box.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13654/package.json');
const { chromium } = require('playwright');

const dir = path.dirname(new URL(import.meta.url).pathname);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function html(text) {
  const [title, subtitle, ...body] = text.replace(/\n+$/, '').split('\n');
  const rows = body.map((l) => {
    if (l.startsWith('## ')) return `<div class="h">${esc(l.slice(3))}</div>`;
    if (l.startsWith('>> ')) return `<div class="note">${esc(l.slice(3))}</div>`;
    const cls = l.startsWith('++ ') ? 'g' : l.startsWith('-- ') ? 'r' : l.startsWith('!! ') ? 'a' : l.startsWith('== ') ? 'm' : '';
    const t = cls ? l.slice(3) : l;
    return `<pre class="${cls}">${esc(t) || ' '}</pre>`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117}
  #card{display:inline-block;padding:28px 34px 30px;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;min-width:1180px}
  .t{font-size:24px;font-weight:600;margin:0 0 4px}
  .s{color:#8b949e;margin:0 0 18px;font-size:14px}
  .h{color:#58a6ff;font-weight:600;margin:16px 0 6px;font-size:16px}
  pre{margin:0;font:13.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;color:#c9d1d9}
  pre.g{color:#3fb950} pre.r{color:#f85149} pre.a{color:#d29922} pre.m{color:#8b949e}
  .note{margin:14px 0 2px;padding:8px 12px;border-left:3px solid #d29922;background:#161b22;color:#e6edf3;font-size:14px}
  </style><div id="card"><div class="t">${esc(title)}</div><div class="s">${esc(subtitle)}</div>${rows}</div>`;
}
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const f of process.argv.slice(2)) {
  const src = path.resolve(f);
  const out = src.replace(/\.txt$/, '.png');
  await page.setContent(html(fs.readFileSync(src, 'utf8')));
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await page.locator('#card').screenshot({ path: out });
  console.log(`${path.basename(out)} clipped-lines=${clipped}`);
}
await browser.close();
