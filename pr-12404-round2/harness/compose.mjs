// compose.mjs — crop the 2x full-page captures and stack them into captioned report figures.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/root/verify/pr12404-r2/package.json');
const { chromium } = require('playwright-core');
const OUT = '/root/verify/pr12404-r2-e2e/out', FIG = '/root/verify/pr12404-r2-e2e/fig';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const uri = (f) => 'data:image/png;base64,' + fs.readFileSync(`${OUT}/${f}`).toString('base64');
const FIGS = [
  { name: '01-nonobject-closed', title: 'Closed at 8363acf: non-object annotation elements', sub: 'Raw POST /session/:id/prompt with _meta.inputAnnotations = [null, "x", 5, true, [null], <valid @README.md>]', rows: [
    { f: 'base-NULLMIX-live.png', tag: 'main 8f86b4f · live', verdict: 'bad', note: 'TypeError on null → "This message could not be displayed."' },
    { f: 'head-NULLMIX-restart.png', tag: 'PR 8363acf · after daemon restart', verdict: 'ok', note: 'JSONL keeps only the valid element; the README.md tag renders' },
    { f: 'head-NULLMIX-legacy.png', tag: 'PR 8363acf · record in the f6d25c84ec on-disk shape', verdict: 'ok', note: 'replay filter drops the 5 non-object entries; tag renders (also with main\'s Web Shell, which has no null guard)' },
  ] },
  { name: '02-field-types-open', title: 'Still open: object elements with a non-string field', sub: 'Same raw POST, one element: { type: "reference", …, reference: { id: "file:@README.md", kind: "file", value: 7 } }', rows: [
    { f: 'base-FIELDVALUE-reload.png', tag: 'main 8f86b4f · after refresh', verdict: 'ok', note: 'annotations never persisted → plain text (live view fails the same way on main)' },
    { f: 'head-FIELDVALUE-restart.png', tag: 'PR 8363acf · after daemon restart', verdict: 'bad', note: 'TypeError: e.value?.trim is not a function — on every load, the element is on disk' },
    { f: 'fix-FIELDVALUE-restart.png', tag: 'PR + one-line fix (isValidComposerTag) · same JSONL', verdict: 'ok', note: 'malformed tag skipped → plain text; valid tags elsewhere unchanged' },
  ] },
  { name: '03-core-after-restart', title: 'Core claim re-checked at 8363acf (after the main merges)', sub: 'Tags from the real @ picker (file, extension, MCP, long file) → daemon restart → reopen → click the restored README.md tag', rows: [
    { f: 'head-4-file-preview.png', tag: 'PR 8363acf · after daemon restart', verdict: 'ok', note: '4 tags, all 28 px / 8 px right padding / 8 px radius; GET /file?path=README.md → 200, preview shows the fixture', h: 620 },
  ] },
];
const browser = await chromium.launch();
for (const fig of FIGS) {
  const rows = fig.rows.map((r) => {
    const h = r.h || 480;
    return `<div class="row"><div class="cap"><span class="pill ${r.verdict}">${r.verdict === 'ok' ? '✓' : '✗'}</span><b>${esc(r.tag)}</b><span class="note">${esc(r.note)}</span></div>
      <div class="shot" style="height:${h / 2}px;background-image:url(${uri(r.f)});background-size:1400px 900px;background-position:-262px 0"></div></div>`;
  }).join('');
  const html = `<html><head><style>
    body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,'DejaVu Sans',sans-serif}
    .wrap{padding:18px 20px;width:1138px}
    h1{font-size:18px;margin:0 0 4px} .sub{color:#9da7b3;font:12.5px/1.4 'DejaVu Sans Mono',monospace;margin-bottom:14px}
    .row{margin-bottom:14px;border:1px solid #30363d;border-radius:8px;overflow:hidden}
    .cap{padding:8px 12px;background:#161b22;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
    .note{color:#9da7b3} .pill{font-weight:700;border-radius:10px;padding:0 8px}
    .pill.ok{background:#1f6f3a;color:#d6ffe0} .pill.bad{background:#8e1f1f;color:#ffe0e0}
    .shot{width:1138px;background-repeat:no-repeat}
  </style></head><body><div class="wrap"><h1>${esc(fig.title)}</h1><div class="sub">${esc(fig.sub)}</div>${rows}</div></body></html>`;
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 800 } });
  await page.setContent(html); await page.waitForTimeout(300);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
  await page.locator('.wrap').screenshot({ path: `${FIG}/${fig.name}.png` });
  console.log(fig.name, Math.round(box.width), 'x', Math.round(box.height));
  await page.close();
}
await browser.close();
