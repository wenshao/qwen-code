// usage: node render-cards.mjs <cards.json> <outDir> <worktree-with-playwright>
// Each card: { file, title, subtitle, sections: [{ heading, lines: [..] }], note }
// Line prefixes colour the whole line: "++ " green, "-- " red, "!! " amber,
// "## " blue, "== " grey; the prefix itself is dropped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [, , specPath, outDir, tree] = process.argv;
const require = createRequire(join(tree, 'package.json'));
const { chromium } = require('playwright');
const cards = JSON.parse(readFileSync(specPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colours = { '++': '#3fb950', '--': '#f85149', '!!': '#d29922', '##': '#58a6ff', '==': '#8b949e' };
const line = (raw) => {
  const p = raw.slice(0, 2);
  if (colours[p] && raw[2] === ' ')
    return `<span style="color:${colours[p]}">${esc(raw.slice(3))}</span>`;
  return esc(raw);
};

const cellHtml = (cell) =>
  String(cell)
    .split('\n')
    .map((part) => line(part))
    .join('<br>');
const html = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;}
#card{display:inline-block;padding:28px 32px;background:#0d1117;color:#c9d1d9;min-width:900px;}
h1{font-size:24px;margin:0 0 6px;color:#f0f6fc}
.sub{font-size:14px;color:#8b949e;margin-bottom:18px}
h2{font-size:15px;margin:16px 0 6px;color:#58a6ff;font-weight:600}
pre{margin:0;padding:12px 14px;background:#161b22;border:1px solid #30363d;border-radius:6px;
font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden}
table{border-collapse:collapse;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;background:#161b22;border:1px solid #30363d}
th{text-align:left;padding:7px 12px;border-bottom:1px solid #30363d;color:#f0f6fc;background:#1c2128;font-weight:600}
td{padding:6px 12px;border-bottom:1px solid #21262d;vertical-align:top;white-space:nowrap}
td.k{color:#c9d1d9}
.note{margin-top:16px;padding:10px 14px;border-left:4px solid #d29922;background:#1c1f26;font-size:14px;line-height:1.5;max-width:1300px}
</style></head><body><div id="card">
<h1>${esc(c.title)}</h1><div class="sub">${esc(c.subtitle ?? '')}</div>
${c.sections
  .map((s) =>
    s.table
      ? `<h2>${esc(s.heading)}</h2><table><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${s.table.rows
          .map((r) => `<tr>${r.map((cell, i) => `<td${i === 0 ? ' class="k"' : ''}>${cellHtml(cell)}</td>`).join('')}</tr>`)
          .join('')}</table>`
      : `<h2>${esc(s.heading)}</h2><pre>${s.lines.map(line).join('\n')}</pre>`,
  )
  .join('\n')}
${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const c of cards) {
  const file = join(outDir, c.file.replace(/\.png$/, '.html'));
  writeFileSync(file, html(c));
  await page.goto('file://' + file);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length,
  );
  await page.locator('#card').screenshot({ path: join(outDir, c.file) });
  console.log(c.file, clipped ? `WARNING ${clipped} clipped pre` : 'ok');
}
await browser.close();
