// Render evidence cards: node fig/card.mjs <spec.json> <out.png>
// spec: { title, subtitle, width?, sections: [ {kind:'table', head:[], rows:[[...]], widths?:[]},
//         {kind:'images', items:[{src, caption}], cols?}, {kind:'note', text, tone?:'ok'|'bad'|'warn'} ] }
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/Users/wenshao/pr13760-rig/src-merge/package.json');
const { chromium } = require('playwright');
const [specPath, outPath] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cellHtml = (c) => {
  const s = String(c ?? '');
  const cls = /^(PASS|agree|yes|✓)/.test(s) ? 'ok' : /^(FAIL|CAP-|no-entry-expected-fail|✗)/.test(s) ? 'bad' : /^(WARN|note|⚠)/.test(s) ? 'warn' : '';
  return `<td class="${cls}">${esc(s)}</td>`;
};
const img = (src) => `data:image/png;base64,${fs.readFileSync(path.resolve(path.dirname(specPath), src)).toString('base64')}`;
const sections = spec.sections.map((s) => {
  if (s.kind === 'table') {
    const cols = s.widths ? `<colgroup>${s.widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : '';
    return `${s.title ? `<h3>${esc(s.title)}</h3>` : ''}<table>${cols}<thead><tr>${s.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map(cellHtml).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if (s.kind === 'images') {
    return `${s.title ? `<h3>${esc(s.title)}</h3>` : ''}<div class="imgs" style="grid-template-columns:repeat(${s.cols ?? s.items.length},1fr)">${s.items.map((i) => `<figure><img src="${img(i.src)}"><figcaption>${esc(i.caption)}</figcaption></figure>`).join('')}</div>`;
  }
  return `<div class="note ${s.tone ?? ''}">${esc(s.text)}</div>`;
}).join('\n');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif;color:#e6edf3}
#card{width:${spec.width ?? 1400}px;padding:28px 32px;box-sizing:border-box;background:#0d1117}
h1{font-size:26px;margin:0 0 6px}h2{font-size:15px;font-weight:400;color:#8b949e;margin:0 0 18px}
h3{font-size:16px;margin:18px 0 8px;color:#79c0ff}
table{border-collapse:collapse;width:100%;font:13px ui-monospace,Menlo,monospace;table-layout:fixed}
th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;word-break:break-word}
th{background:#161b22;color:#8b949e;font-weight:600}
td.ok{color:#3fb950}td.bad{color:#f85149;font-weight:600}td.warn{color:#d29922}
.imgs{display:grid;gap:12px}figure{margin:0;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px}
figure img{width:100%;display:block;border-radius:4px}figcaption{font-size:13px;color:#c9d1d9;margin-top:6px}
.note{border-left:4px solid #58a6ff;padding:8px 12px;margin:14px 0 0;background:#161b22;font-size:14px;white-space:pre-wrap}
.note.ok{border-color:#3fb950}.note.bad{border-color:#f85149}.note.warn{border-color:#d29922}
</style></head><body><div id="card"><h1>${esc(spec.title)}</h1><h2>${esc(spec.subtitle)}</h2>${sections}</div></body></html>`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: (spec.width ?? 1400) + 20, height: 900 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
const clipped = await page.evaluate(() => [...document.querySelectorAll('td,th')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
await page.locator('#card').screenshot({ path: outPath });
await browser.close();
console.log(`wrote ${outPath} clippedCells=${clipped}`);
