// VERIFICATION RIG ONLY: render evidence cards (HTML -> PNG) with the repository's Playwright.
// usage: node render.mjs <cards.mjs> [id-filter]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/rig/wt/package.json');
const { chromium } = require('playwright');

const OUT = '/rig/fig/png';
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const color = { PASS: '#3fb950', FAIL: '#f85149', NOTE: '#d29922', INFO: '#8b949e', HEAD: '#58a6ff', KILL: '#3fb950', SURV: '#d29922', TEXT: '#c9d1d9' };

function line(l) {
  if (typeof l === 'string') return `<span style="color:${color.TEXT}">${esc(l)}</span>`;
  const tag = l.tag ? `<span style="color:${color[l.kind] ?? color.TEXT};font-weight:600">${esc(l.tag.padEnd(l.pad ?? 5))}</span> ` : '';
  const text = `<span style="color:${l.kind === 'HEAD' ? color.HEAD : color.TEXT}${l.kind === 'HEAD' ? ';font-weight:600' : ''}">${esc(l.text)}</span>`;
  const detail = l.detail ? `\n${' '.repeat((l.pad ?? 5) + 1)}<span style="color:${color.INFO}">${esc(l.detail)}</span>` : '';
  return tag + text + detail;
}

function html(card) {
  const sections = card.sections
    .map((s) => `${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}<pre>${s.lines.map(line).join('\n')}</pre>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
  #card{width:${card.width ?? 1480}px;padding:26px 30px 24px;background:#0d1117;color:#c9d1d9;box-sizing:border-box}
  h1{font-size:21px;margin:0 0 4px;color:#f0f6fc;font-weight:600}
  .sub{font-size:13.5px;color:#8b949e;margin:0 0 14px;line-height:1.45}
  h2{font-size:13.5px;margin:14px 0 6px;color:#58a6ff;font-weight:600;border-bottom:1px solid #21262d;padding-bottom:4px}
  pre{margin:0;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;overflow:hidden}
  .foot{margin-top:14px;padding:9px 12px;border-left:3px solid ${card.footColor ?? '#3fb950'};background:#161b22;font-size:13.5px;line-height:1.5;color:#e6edf3}
  </style></head><body><div id="card"><h1>${esc(card.title)}</h1><p class="sub">${esc(card.subtitle ?? '')}</p>${sections}${card.footer ? `<div class="foot">${esc(card.footer)}</div>` : ''}</div></body></html>`;
}

const mod = await import(path.resolve(process.argv[2]));
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const card of mod.cards) {
  if (filter && !filter.test(card.id)) continue;
  const file = `${OUT}/${card.id}.html`;
  fs.writeFileSync(file, html(card));
  await page.goto('file://' + file);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await page.locator('#card').screenshot({ path: `${OUT}/${card.id}.png` });
  const box = await page.locator('#card').boundingBox();
  console.log(`${card.id}.png ${Math.round(box.width)}x${Math.round(box.height)} clippedPre=${clipped}`);
}
await browser.close();
