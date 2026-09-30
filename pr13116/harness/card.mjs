// Renders an evidence card (HTML -> PNG) with the repo's own Playwright.
// usage: node card.mjs <spec.json> <out.png>
// spec: { title, subtitle, blocks: [{ heading, lines: [string] }], note }
// A line may start with a 3-char tag that sets its colour: "++ " green, "-- " red, "!! " amber,
// "== " grey, "## " blue; anything else is plain. Lines are real output copied from the run logs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/pr13095-rig/wt/package.json');
const { chromium } = require('playwright');

const [, , specPath, out] = process.argv;
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cls = { '++ ': 'ok', '-- ': 'bad', '!! ': 'warn', '== ': 'dim', '## ': 'hd', '.. ': 'plain' };
const line = (l) => {
  const tag = l.slice(0, 3);
  return cls[tag] ? `<span class="${cls[tag]}">${esc(l.slice(3))}</span>` : esc(l);
};
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
#card{display:inline-block;padding:26px 30px 24px;background:#0d1117;color:#e6edf3;min-width:900px}
h1{font-size:21px;margin:0 0 4px;font-weight:600}
.sub{color:#8b949e;font-size:13.5px;margin:0 0 16px}
h2{font-size:13px;color:#79c0ff;margin:16px 0 6px;font-weight:600;letter-spacing:.2px}
pre{margin:0;padding:12px 14px;background:#161b22;border:1px solid #30363d;border-radius:6px;
font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;color:#c9d1d9}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}.hd{color:#79c0ff;font-weight:600}.plain{color:#c9d1d9}
.note{margin-top:16px;padding:8px 12px;border-left:3px solid #3fb950;color:#c9d1d9;font-size:13.5px;line-height:1.5;max-width:1150px}
</style><div id="card"><h1>${esc(spec.title)}</h1><p class="sub">${esc(spec.subtitle ?? '')}</p>
${spec.blocks.map((b) => `${b.heading ? `<h2>${esc(b.heading)}</h2>` : ''}<pre>${b.lines.map(line).join('\n')}</pre>`).join('\n')}
${spec.note ? `<div class="note">${esc(spec.note)}</div>` : ''}</div>`;
writeFileSync(out.replace(/\.png$/, '.html'), html);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 900 } });
await page.setContent(html);
const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
await page.locator('#card').screenshot({ path: out });
const box = await page.locator('#card').boundingBox();
await browser.close();
console.log(`${out} ${Math.round(box.width)}x${Math.round(box.height)} clipped-pre=${clipped}`);
