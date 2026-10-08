// Renders evidence cards (cards.json) to PNG via the repo's Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(process.argv[2] + '/package.json');
const { chromium } = require('playwright');
const cards = JSON.parse(readFileSync(path.join(here, 'cards.json'), 'utf8'));

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Cell markup: leading tag picks a colour — "ok:", "bad:", "warn:", "dim:".
const cell = (v) => {
  const m = /^(ok|bad|warn|dim):\s?([\s\S]*)$/.exec(String(v));
  const cls = m ? m[1] : '';
  const text = m ? m[2] : String(v);
  // A later line may switch colour with its own "warn: " / "bad: " prefix.
  // The switch is sticky: unprefixed continuation lines keep the last colour.
  let cur = cls;
  const lines = text.split('\n').map((l) => {
    const lm = /^(ok|bad|warn|dim):\s?(.*)$/.exec(l);
    if (lm) cur = lm[1];
    return `<span class="${cur}">${esc(lm ? lm[2] : l)}</span>`;
  });
  return `<td class="${cls}">${lines.join('<br>')}</td>`;
};

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
#card{display:inline-block;padding:28px 32px;background:#0d1117;color:#c9d1d9;min-width:1100px;max-width:1500px}
h1{font-size:24px;margin:0 0 6px;color:#f0f6fc}
.sub{font-size:14px;color:#8b949e;margin-bottom:18px}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th{text-align:left;color:#8b949e;font-weight:600;border-bottom:1px solid #30363d;padding:8px 10px}
td{border-bottom:1px solid #21262d;padding:8px 10px;vertical-align:top;font-family:ui-monospace,Menlo,monospace;font-size:13.5px;line-height:1.45}
td:first-child{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14.5px;color:#e6edf3;width:28%}
td.ok,span.ok{color:#3fb950} td.bad,span.bad{color:#f85149} td.warn,span.warn{color:#d29922} td.dim,span.dim{color:#8b949e}
.note{margin-top:16px;border-left:4px solid #388bfd;padding:8px 14px;font-size:14px;color:#c9d1d9;background:#161b22}
.note.warn{border-left-color:#d29922}
pre{background:#161b22;border:1px solid #30363d;padding:12px 14px;font-size:13px;line-height:1.5;color:#c9d1d9;white-space:pre;margin:12px 0 0}
`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const c of cards) {
  const head = `<tr>${c.columns.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const rows = c.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('');
  const notes = (c.notes ?? [])
    .map((n) => `<div class="note ${n.kind ?? ''}">${esc(n.text)}</div>`)
    .join('');
  const pre = c.pre ? `<pre>${esc(c.pre)}</pre>` : '';
  const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(c.title)}</h1><div class="sub">${esc(c.subtitle)}</div><table>${head}${rows}</table>${pre}${notes}</div>`;
  await page.setContent(html);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length,
  );
  if (clipped) console.error(`${c.file}: ${clipped} pre block(s) overflow`);
  const out = path.join(here, c.file);
  await page.locator('#card').screenshot({ path: out });
  writeFileSync(out + '.html', html);
  console.log(`wrote ${out}`);
}
await browser.close();
