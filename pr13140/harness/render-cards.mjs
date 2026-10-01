// Renders evidence cards (HTML) to PNG with the worktree's Playwright.
// usage: node render-cards.mjs <spec.mjs> <outdir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [specPath, outDir] = process.argv.slice(2);
const require = createRequire(
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad/wt-pr/package.json',
);
const { chromium } = require('playwright');
const { cards } = await import(pathToFileURL(path.resolve(specPath)).href);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TONES = { '.. ': 'p', '++ ': 'g', '-- ': 'r', '!! ': 'a', '== ': 'm', '## ': 'b', '** ': 'w' };
function body(lines) {
  return lines
    .map((l) => {
      const tone = TONES[l.slice(0, 3)];
      const text = tone ? l.slice(3) : l;
      return tone ? `<span class="${tone}">${esc(text)}</span>` : esc(text);
    })
    .join('\n');
}
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{display:inline-block;padding:26px 30px 24px;background:#0d1117;color:#e6edf3;min-width:900px}
h1{font-size:23px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:14px;margin-bottom:16px}
.grid{display:grid;gap:14px}
.panel{border:1px solid #30363d;border-radius:8px;background:#161b22;overflow:hidden}
.ph{padding:7px 12px;font-size:13.5px;font-weight:600;border-bottom:1px solid #30363d;display:flex;gap:8px;align-items:center}
.badge{font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;letter-spacing:.3px}
.bad .badge{background:#5c1d22;color:#ffa198}.good .badge{background:#12361f;color:#7ee787}
.warn .badge{background:#4b3a0c;color:#f2cc60}.info .badge{background:#132d4f;color:#79c0ff}
pre{margin:0;padding:10px 12px;font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;color:#c9d1d9}
.p{color:inherit}.g{color:#7ee787}.r{color:#ff7b72}.a{color:#f2cc60}.m{color:#8b949e}.b{color:#79c0ff}.w{color:#ffffff;font-weight:600}
.note{margin-top:14px;border-left:3px solid #388bfd;padding:4px 12px;color:#c9d1d9;font-size:13.5px;line-height:1.5}
`;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1800, height: 1200 } });
for (const card of cards) {
  const panels = card.panels
    .map(
      (p) =>
        `<div class="panel ${p.tone ?? 'info'}" style="${p.span ? `grid-column:span ${p.span}` : ''}"><div class="ph"><span class="badge">${esc(p.badge ?? '')}</span>${esc(p.title)}</div><pre>${body(p.lines)}</pre></div>`,
    )
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(card.title)}</h1><div class="sub">${esc(card.sub)}</div><div class="grid" style="grid-template-columns:${card.cols ?? '1fr'}">${panels}</div>${card.note ? `<div class="note">${esc(card.note)}</div>` : ''}</div>`;
  const file = path.join(outDir, `${card.name}.html`);
  fs.writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length,
  );
  await page.locator('#card').screenshot({ path: path.join(outDir, `${card.name}.png`) });
  console.log(card.name, clipped ? `WARNING ${clipped} clipped pre` : 'ok');
}
await browser.close();
