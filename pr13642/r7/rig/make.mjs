import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/Users/wenshao/git/qwen-code-x3/package.json');
const { chromium } = require('playwright');
const dir = process.argv[2];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function render(lines) {
  return lines.map((l) => {
    const tag = l.slice(0, 3);
    const body = esc(l.slice(3));
    const cls = { '## ': 'h', '++ ': 'ok', '-- ': 'bad', '!! ': 'warn', '== ': 'dim', '>> ': 'key', '   ': '' }[tag];
    if (cls === undefined) return esc(l);
    if (cls === 'h') return `<span class="h">${body}</span>`;
    return cls ? `<span class="${cls}">${body}</span>` : body;
  }).join('\n');
}
function page(title, subtitle, blocks, note) {
  const body = blocks.map((b) => `${b.label ? `<div class="label">${esc(b.label)}</div>` : ''}<pre>${render(b.lines)}</pre>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
  #card{width:1440px;padding:28px 32px 26px;box-sizing:border-box;background:#0d1117;color:#e6edf3}
  h1{font-size:25px;margin:0 0 6px;font-weight:650}
  .sub{color:#8b949e;font-size:15px;margin-bottom:16px}
  .label{color:#58a6ff;font-size:15px;font-weight:600;margin:14px 0 6px}
  pre{margin:0;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 16px;font:14.5px/1.5 ui-monospace,Menlo,"PingFang SC",monospace;white-space:pre;overflow:hidden}
  .h{color:#d2a8ff;font-weight:700}.ok{color:#3fb950}.bad{color:#ff7b72}.warn{color:#d29922}.dim{color:#8b949e}.key{color:#79c0ff}
  .note{margin-top:14px;border-left:4px solid #d29922;padding:6px 12px;color:#e6edf3;font-size:15px;background:#1c1f26}
  </style><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div>`;
}
const figs = JSON.parse(require('node:fs').readFileSync(`${dir}/figs.json`, 'utf8'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
for (const f of figs) {
  const file = `${dir}/${f.name}.html`;
  writeFileSync(file, page(f.title, f.subtitle, f.blocks, f.note));
  const p = await ctx.newPage();
  await p.goto(`file://${file}`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre')].filter((e) => e.scrollWidth > e.clientWidth).length);
  await p.locator('#card').screenshot({ path: `${dir}/${f.name}.png` });
  console.log(f.name, 'clipped-pre-blocks=' + clipped);
  await p.close();
}
await browser.close();
