// HTML evidence cards -> PNG via the repo's Playwright (element screenshot, 2x).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/git/pr13498-head/package.json');
const { chromium } = require('playwright');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// line prefixes: "## " heading, "++ " green, "-- " red, "!! " amber, "== " grey
const fmt = (text) => text.split('\n').map((l) => {
  const m = /^(## |\+\+ |-- |!! |== )/.exec(l); const body = esc(m ? l.slice(3) : l);
  const cls = m ? { '## ': 'h', '++ ': 'g', '-- ': 'r', '!! ': 'a', '== ': 'm' }[m[1]] : '';
  return cls ? `<span class="${cls}">${body}</span>` : body;
}).join('\n');
const page = (c) => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:1100px}
h1{font-size:24px;margin:0 0 4px} .sub{color:#8b949e;font-size:14px;margin-bottom:18px}
pre{font:14px/1.5 ui-monospace,Menlo,monospace;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 18px;margin:0 0 14px;white-space:pre;overflow:hidden}
.h{color:#79c0ff;font-weight:600}.g{color:#3fb950}.r{color:#f85149}.a{color:#d29922}.m{color:#8b949e}
.note{border-left:4px solid #d29922;padding:6px 14px;color:#e6edf3;font-size:15px;background:#161b22}
.note.ok{border-color:#3fb950}</style><div id="card"><h1>${esc(c.title)}</h1><div class="sub">${esc(c.sub)}</div>
${c.blocks.map((b) => `<pre>${fmt(b)}</pre>`).join('')}<div class="note ${c.ok ? 'ok' : ''}">${esc(c.note)}</div></div>`;
const cards = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
for (const c of cards) {
  const p = await ctx.newPage();
  await p.setContent(page(c));
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre')].filter((e) => e.scrollWidth > e.clientWidth).length);
  await p.locator('#card').screenshot({ path: c.file });
  console.log(c.file, clipped ? `CLIPPED ${clipped}` : 'ok');
  await p.close();
}
await browser.close();
