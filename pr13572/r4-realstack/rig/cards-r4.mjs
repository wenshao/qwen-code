// Evidence cards for the PR 13572 real-stack report: HTML cards rendered
// with the repo's Playwright, each #card captured at 2x. Line prefixes
// colour the text: "## " heading, "++ " ok, "-- " bad, "!! " warn, "== " dim.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13572-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13572-rig/fig/out-r4';
mkdirSync(OUT, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function pre(text) {
  return text
    .split('\n')
    .map((line) => {
      const m = /^(## |\+\+ |-- |!! |== )/.exec(line);
      const cls = m ? { '## ': 'h', '++ ': 'ok', '-- ': 'bad', '!! ': 'warn', '== ': 'dim' }[m[1]] : '';
      const body = m ? line.slice(3) : line;
      return `<span class="${cls}">${esc(body) || ' '}</span>`;
    })
    .join('\n');
}
function card({ title, subtitle, panels, note }) {
  const cols = panels.length;
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
  #card{display:inline-block;padding:22px 26px;background:#0d1117;color:#c9d1d9;min-width:900px}
  h1{font-size:21px;margin:0 0 4px;color:#f0f6fc} .sub{font-size:13px;color:#8b949e;margin-bottom:14px}
  .grid{display:grid;grid-template-columns:repeat(${cols},auto);gap:14px}
  .panel{border:1px solid #30363d;border-radius:8px;background:#161b22;padding:10px 12px}
  .panel h2{font-size:13px;margin:0 0 6px;color:#58a6ff;font-weight:600}
  pre{margin:0;font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre;color:#c9d1d9}
  .h{color:#58a6ff;font-weight:600}.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}
  .note{margin-top:14px;border-left:3px solid #d29922;padding:6px 12px;font-size:13px;color:#e6edf3;max-width:1500px}
  </style><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div><div class="grid">${panels
    .map((p) => `<div class="panel"><h2>${esc(p.h)}</h2><pre>${pre(p.t)}</pre></div>`)
    .join('')}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
}

const cards = JSON.parse(await (await import('node:fs/promises')).readFile('/Users/wenshao/git/pr13572-rig/fig/cards-r4.json', 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1200 } });
for (const c of cards) {
  const file = `${OUT}/${c.name}.html`;
  writeFileSync(file, card(c));
  await page.goto(`file://${file}`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await page.locator('#card').screenshot({ path: `${OUT}/${c.name}.png` });
  console.log(c.name, clipped ? `CLIPPED ${clipped}` : 'ok');
}
await browser.close();
