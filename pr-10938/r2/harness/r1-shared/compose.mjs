// Build annotated before/after composites from the harness screenshots.
// usage: node compose.mjs <spec.json> <out.png>
// spec: { title, columns: ["base ...","head ..."], rows: [{ label, cells: [{ file, crop:{x,y,w,h}, caption }] }] }
import fs from 'node:fs';
import { launch } from './lib.mjs';

const [specFile, outFile] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const cellW = spec.cellWidth ?? 640;

const browser = await launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
// Crop each source image with a canvas inside the page.
const cropped = [];
for (const row of spec.rows) {
  const out = [];
  for (const cell of row.cells) {
    const b64 = fs.readFileSync(cell.file).toString('base64');
    const dataUrl = await page.evaluate(
      async ({ src, crop }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        const { x = 0, y = 0, w = img.width, h = img.height } = crop ?? {};
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
        return c.toDataURL('image/png');
      },
      { src: `data:image/png;base64,${b64}`, crop: cell.crop },
    );
    out.push({ ...cell, dataUrl });
  }
  cropped.push({ ...row, cells: out });
}
const cols = spec.columns.length;
const html = `<!doctype html><html><head><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.wrap{padding:18px 20px;display:inline-block}
h1{font-size:18px;margin:0 0 4px}
.sub{color:#8b949e;margin:0 0 14px;font-size:13px}
.grid{display:grid;grid-template-columns:150px repeat(${cols},${cellW}px);gap:10px;align-items:start}
.colh{font-weight:600;padding:6px 8px;border-radius:6px;text-align:center}
.bad{background:#3d1d20;color:#ff9492}.good{background:#12321f;color:#7ee2a8}.neutral{background:#1f2937;color:#c9d1d9}
.rowh{color:#c9d1d9;font-weight:600;padding-top:8px;font-size:13px;line-height:1.35}
.cell{border:1px solid #30363d;border-radius:6px;overflow:hidden;background:#000}
.cell img{display:block;width:100%}
.cap{padding:6px 8px;font-size:12px;color:#c9d1d9;background:#161b22;border-top:1px solid #30363d;line-height:1.4}
</style></head><body><div class="wrap">
<h1>${esc(spec.title)}</h1><p class="sub">${esc(spec.subtitle)}</p>
<div class="grid"><div></div>${spec.columns.map((c, i) => `<div class="colh ${spec.columnClass?.[i] ?? 'neutral'}">${esc(c)}</div>`).join('')}
${cropped
  .map(
    (row) =>
      `<div class="rowh">${esc(row.label)}</div>` +
      row.cells.map((c) => `<div class="cell"><img src="${c.dataUrl}">${c.caption ? `<div class="cap">${esc(c.caption)}</div>` : ''}</div>`).join(''),
  )
  .join('')}
</div></div></body></html>`;
await page.setContent(html);
await page.waitForTimeout(300);
const wrap = await page.$('.wrap');
await wrap.screenshot({ path: outFile });
await browser.close();
console.log('wrote', outFile);
