// Renders evidence cards (cards/*.json) to PNG with Playwright; reports clipped <pre> lines.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(process.env.PW_ROOT + '/package.json');
const { chromium } = require('playwright');
const dir = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(dir, 'png');
fs.mkdirSync(out, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Line prefixes pick a colour: "## " heading, "++ " green, "-- " red, "!! " amber, "== " grey.
function colour(line) {
  const map = { '## ': 'h', '++ ': 'g', '-- ': 'r', '!! ': 'a', '== ': 'm' };
  const key = line.slice(0, 3);
  if (map[key]) return `<span class="${map[key]}">${esc(line.slice(3))}</span>`;
  return esc(line);
}

function html(card) {
  const blocks = card.blocks
    .map((b) => {
      if (b.pre) return `<div class="lbl">${esc(b.label || '')}</div><pre>${b.pre.split('\n').map(colour).join('\n')}</pre>`;
      if (b.table) {
        const [head, ...rows] = b.table;
        return `<div class="lbl">${esc(b.label || '')}</div><table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${String(c).split("\n").map(colour).join("\n")}</td>`).join('')}</tr>`)
          .join('')}</table>`;
      }
      if (b.note) return `<div class="note">${esc(b.note)}</div>`;
      return '';
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
  #card{display:inline-block;padding:28px 32px;background:#0d1117;max-width:1500px}
  h1{font-size:24px;margin:0 0 4px 0;color:#f0f6fc}
  .sub{font-size:14px;color:#8b949e;margin-bottom:18px}
  .lbl{font-size:13px;color:#8b949e;margin:14px 0 6px 0}
  pre{margin:0;padding:12px 14px;background:#161b22;border:1px solid #30363d;border-radius:6px;font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre;overflow:hidden}
  table{border-collapse:collapse;font:13px/1.45 ui-monospace,Menlo,monospace}
  th{background:#161b22;color:#8b949e;text-align:left;font-weight:600}
  th,td{border:1px solid #30363d;padding:5px 10px;vertical-align:top;white-space:pre}
  .h{color:#79c0ff;font-weight:600}.g{color:#3fb950}.r{color:#f85149}.a{color:#d29922}.m{color:#8b949e}
  .note{margin-top:16px;padding:10px 14px;border-left:3px solid #d29922;background:#161b22;font-size:14px;line-height:1.5;max-width:1400px}
  </style></head><body><div id="card"><h1>${esc(card.title)}</h1><div class="sub">${esc(card.subtitle)}</div>${blocks}</div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
for (const file of fs.readdirSync(path.join(dir, 'cards')).filter((f) => f.endsWith('.json')).sort()) {
  const card = JSON.parse(fs.readFileSync(path.join(dir, 'cards', file), 'utf8'));
  await page.setContent(html(card));
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  const png = path.join(out, file.replace(/\.json$/, '.png'));
  await page.locator('#card').screenshot({ path: png });
  console.log(`${path.basename(png)} clipped_pre=${clipped}`);
}
await browser.close();
