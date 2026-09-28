// usage: node render.cjs <spec.json> <outdir>
// spec: [{ name, title, subtitle, lines: [string], note }]
// Line prefixes: "## " heading, "++ " green, "-- " red, "!! " amber, "== " grey, "   " plain.
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const req = createRequire('$SP/wt-pr/package.json');
const { chromium } = req('playwright');
const [specFile, outDir] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const color = { '## ': '#79c0ff', '++ ': '#56d364', '-- ': '#f85149', '!! ': '#e3b341', '== ': '#8b949e' };
function line(l) {
  const p = l.slice(0, 3);
  if (color[p]) {
    const weight = p === '## ' ? 'font-weight:700;' : '';
    return `<span style="color:${color[p]};${weight}">${esc(l.slice(3))}</span>`;
  }
  return esc(l.startsWith('   ') ? l.slice(3) : l);
}
function html(card) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
  #card{display:inline-block;padding:28px 34px 26px;background:#0d1117;color:#e6edf3;min-width:900px}
  h1{font-size:25px;margin:0 0 6px;color:#e6edf3}
  .sub{font-size:15px;color:#8b949e;margin:0 0 18px}
  pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.5;margin:0;white-space:pre;
      background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 18px;overflow:hidden}
  .note{margin-top:16px;border-left:4px solid #56d364;padding:6px 12px;font-size:15px;color:#c9d1d9;max-width:1250px}
  </style></head><body><div id="card"><h1>${esc(card.title)}</h1><div class="sub">${esc(card.subtitle)}</div>
  <pre>${card.lines.map(line).join('\n')}</pre>${card.note ? `<div class="note">${esc(card.note)}</div>` : ''}</div></body></html>`;
}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1800, height: 1200 } });
  for (const card of spec) {
    const file = path.join(outDir, `${card.name}.html`);
    fs.writeFileSync(file, html(card));
    await page.goto('file://' + file);
    const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].some((p) => p.scrollWidth > p.clientWidth));
    await page.locator('#card').screenshot({ path: path.join(outDir, `${card.name}.png`) });
    console.log(`${card.name}.png${clipped ? ' CLIPPED' : ''}`);
  }
  await browser.close();
})();
