// Render evidence cards to PNG with the repo's Playwright.
//   node render.mjs cards.json outDir
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [specFile, outDir] = process.argv.slice(2);
const require = createRequire(process.env.PW_ROOT + '/package.json');
const { chromium } = require('playwright');
const cards = JSON.parse(readFileSync(specFile, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cls = (line) =>
  line.startsWith('## ') ? 'h' : line.startsWith('++ ') ? 'ok' : line.startsWith('-- ') ? 'bad'
  : line.startsWith('!! ') ? 'warn' : line.startsWith('== ') ? 'dim' : '';
const strip = (line) => (/^(## |\+\+ |-- |!! |== )/.test(line) ? line.slice(3) : line);
const html = (c) => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
#card{display:inline-block;padding:28px 32px 26px;background:#0d1117;color:#c9d1d9;min-width:1100px;max-width:1500px}
h1{font-size:25px;margin:0 0 4px;color:#f0f6fc}.sub{color:#8b949e;font-size:15px;margin-bottom:16px}
pre{font:14.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre;margin:0;overflow:hidden;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px}
.h{color:#79c0ff;font-weight:700}.ok{color:#56d364}.bad{color:#ff7b72}.warn{color:#e3b341}.dim{color:#8b949e}
.note{margin-top:14px;border-left:4px solid ${'#e3b341'};padding:8px 14px;color:#e6edf3;font-size:15.5px;line-height:1.5;background:#161b22}
.note.red{border-color:#ff7b72}.note.green{border-color:#56d364}
</style><div id="card"><h1>${esc(c.title)}</h1><div class="sub">${esc(c.subtitle)}</div><pre>${c.lines
  .map((l) => `<span class="${cls(l)}">${esc(strip(l))}</span>`).join('\n')}</pre>${(c.notes ?? [])
  .map((n) => `<div class="note ${n.tone ?? ''}">${esc(n.text)}</div>`).join('')}</div>`;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const c of cards) {
  await page.setContent(html(c));
  const clipped = await page.evaluate(() => {
    const p = document.querySelector('pre');
    return p.scrollWidth > p.clientWidth + 1;
  });
  if (clipped) console.log(`WARNING ${c.file}: pre is clipped`);
  const out = path.join(outDir, c.file);
  await page.locator('#card').screenshot({ path: out });
  console.log('wrote', out);
}
await browser.close();
