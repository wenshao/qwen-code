// Compose labelled panels (cropped to the manager area, sidebar removed) into one PNG.
import { readFileSync } from 'node:fs';
import { chromium, EXE } from './browser-common.mjs';
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const html = `<!doctype html><html><head><style>
body{margin:0;background:#0d1117;font-family:'DejaVu Sans',sans-serif;color:#e6edf3}
.wrap{display:inline-block;padding:20px}
h1{font-size:22px;margin:0 0 6px} .sub{font-size:14px;color:#9da7b3;margin:0 0 14px;max-width:${spec.cols * spec.w}px}
.grid{display:grid;grid-template-columns:repeat(${spec.cols},${spec.w}px);gap:14px}
.cell{background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
.cap{padding:8px 12px;font-size:14px;border-bottom:1px solid #30363d} .cap b{color:#58a6ff} .cap .bad{color:#f85149} .cap .good{color:#3fb950}
.cell img{display:block;width:${spec.w}px}
</style></head><body><div class="wrap"><h1>${esc(spec.title)}</h1><p class="sub">${esc(spec.subtitle ?? '')}</p><div class="grid">
${spec.panels.map((p) => `<div class="cell"><div class="cap">${p.capHtml ?? esc(p.cap)}</div><img src="${img(p.src)}"></div>`).join('')}
</div></div></body></html>`;
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: spec.cols * (spec.w + 14) + 60, height: 600 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
await page.locator('.wrap').screenshot({ path: spec.out });
await browser.close();
console.log('wrote', spec.out);
