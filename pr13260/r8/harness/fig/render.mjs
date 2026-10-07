// Render evidence cards (JSON specs -> HTML -> PNG) with the worktree's Playwright. usage: node render.mjs <spec.json> <outdir>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/Users/wenshao/pr13260-rig/wt9/package.json');
const { chromium } = require('playwright');
const [specFile, outDir] = process.argv.slice(2);
const specs = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;}
#card{display:inline-block;padding:26px 30px 24px;background:#0d1117;color:#c9d1d9;min-width:1100px;max-width:1500px}
h1{font-size:23px;margin:0 0 4px;color:#f0f6fc} .sub{font-size:14px;color:#8b949e;margin-bottom:16px}
h2{font-size:15px;margin:16px 0 6px;color:#58a6ff;font-weight:600}
pre{margin:0;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;overflow:hidden}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}.hi{color:#f0f6fc;font-weight:600}
table{border-collapse:collapse;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;width:100%}
td,th{border:1px solid #30363d;padding:4px 8px;text-align:left;vertical-align:top} th{background:#161b22;color:#8b949e;font-weight:600}
.note{margin-top:14px;border-left:3px solid #d29922;padding:6px 12px;font-size:14px;color:#e6edf3;background:#161b22}
.note.ok{border-color:#3fb950}.note.bad{border-color:#f85149}`;
const cls = (t) => t.startsWith('++ ') ? 'ok' : t.startsWith('-- ') ? 'bad' : t.startsWith('!! ') ? 'warn' : t.startsWith('== ') ? 'dim' : t.startsWith('## ') ? 'hi' : '';
const line = (t) => { const c = cls(t); const body = c ? t.slice(3) : t; return c ? `<span class="${c}">${esc(body)}</span>` : esc(body); };
const cell = (v) => { const s = String(v); const c = cls(s); return `<td${c ? ` class="${c}"` : ''}>${esc(c ? s.slice(3) : s)}</td>`; };
function html(spec) {
  let b = `<div id="card"><h1>${esc(spec.title)}</h1><div class="sub">${esc(spec.subtitle ?? '')}</div>`;
  for (const s of spec.sections) {
    if (s.heading) b += `<h2>${esc(s.heading)}</h2>`;
    if (s.lines) b += `<pre>${s.lines.map(line).join('\n')}</pre>`;
    if (s.table) b += `<table><tr>${s.table[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${s.table.slice(1).map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table>`;
  }
  if (spec.note) b += `<div class="note ${spec.noteClass ?? ''}">${esc(spec.note)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${b}</div></body></html>`;
}
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
for (const spec of specs) {
  const file = path.join(outDir, `${spec.name}.html`);
  fs.writeFileSync(file, html(spec));
  await page.goto(`file://${file}`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await page.locator('#card').screenshot({ path: path.join(outDir, `${spec.name}.png`) });
  console.log(`${spec.name}.png ${clipped ? `WARNING ${clipped} pre block(s) clipped` : 'ok'}`);
}
await browser.close();
