// Render tmux ANSI captures and text tables into PNG evidence cards.
// Usage: node render.mjs <spec.json> <outdir>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire('/Users/wenshao/pr13729-rig/merge/package.json');
const { chromium } = require('playwright');

const BASE16 = [
  '#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
  '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc',
];
function c256(n) {
  if (n < 16) return BASE16[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  n -= 16;
  const s = [0, 95, 135, 175, 215, 255];
  return `rgb(${s[Math.floor(n / 36)]},${s[Math.floor(n / 6) % 6]},${s[n % 6]})`;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ansiLineToHtml(line, maxCols) {
  let st = {};
  let out = '';
  let cols = 0;
  const re = /\x1b\[([0-9;]*)m|\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[A-Za-z]/g;
  let last = 0;
  const emit = (txt) => {
    if (!txt || cols >= maxCols) return;
    const chars = [...txt];
    const take = chars.slice(0, maxCols - cols).join('');
    cols += Math.min(chars.length, maxCols - cols);
    const css = [];
    if (st.fg) css.push(`color:${st.fg}`);
    if (st.bg) css.push(`background:${st.bg}`);
    if (st.bold) css.push('font-weight:700');
    if (st.dim) css.push('opacity:.65');
    if (st.italic) css.push('font-style:italic');
    out += css.length ? `<span style="${css.join(';')}">${esc(take)}</span>` : esc(take);
  };
  let m;
  while ((m = re.exec(line))) {
    emit(line.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] === undefined) continue;
    const p = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (v === 0) st = {};
      else if (v === 1) st.bold = true;
      else if (v === 2) st.dim = true;
      else if (v === 3) st.italic = true;
      else if (v === 22) { st.bold = false; st.dim = false; }
      else if (v === 23) st.italic = false;
      else if (v >= 30 && v <= 37) st.fg = BASE16[v - 30];
      else if (v >= 90 && v <= 97) st.fg = BASE16[v - 90 + 8];
      else if (v === 39) delete st.fg;
      else if (v >= 40 && v <= 47) st.bg = BASE16[v - 40];
      else if (v >= 100 && v <= 107) st.bg = BASE16[v - 100 + 8];
      else if (v === 49) delete st.bg;
      else if (v === 38 || v === 48) {
        const key = v === 38 ? 'fg' : 'bg';
        if (p[i + 1] === 5) { st[key] = c256(p[i + 2]); i += 2; }
        else if (p[i + 1] === 2) { st[key] = `rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`; i += 4; }
      }
    }
  }
  emit(line.slice(last));
  return out;
}

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '');

// frame: {file, from?: regex, to?: regex, maxCols, dropBlank}
function frameHtml(f) {
  let lines = readFileSync(f.file, 'utf8').split('\n');
  lines = lines.filter((l) => {
    const t = strip(l);
    if (t.trim() === '') return false;
    if (/^\s*│\s*│?\s*$/.test(t)) return false;
    return true;
  });
  let start = 0;
  let end = lines.length;
  if (f.from) start = Math.max(0, lines.findIndex((l) => new RegExp(f.from).test(strip(l))));
  if (f.to) {
    const idx = lines.findIndex((l, i) => i >= start && new RegExp(f.to).test(strip(l)));
    if (idx >= 0) end = idx + 1;
  }
  return lines
    .slice(start, end)
    .map((l) => ansiLineToHtml(l, f.maxCols ?? 104))
    .join('\n');
}

const CSS = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:22px 26px;background:#0d1117}
h1{font-size:21px;margin:0 0 4px 0;color:#f0f6fc}
.sub{font-size:13.5px;color:#8b949e;margin:0 0 14px 0}
.panel{border:1px solid #30363d;border-radius:8px;margin:0 0 14px 0;overflow:hidden}
.ph{padding:7px 12px;font-size:13.5px;font-weight:600;border-bottom:1px solid #30363d;background:#161b22}
.ph.bad{color:#ff7b72}.ph.good{color:#3fb950}.ph.neutral{color:#79c0ff}
pre{margin:0;padding:10px 12px;font:12.5px/1.42 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;color:#e6edf3;background:#0d1117}
.note{border-left:3px solid #d29922;padding:6px 12px;font-size:13.5px;color:#e6edf3;background:#161b22;margin-top:4px}
table{border-collapse:collapse;font-size:13px}
td,th{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9}
.g{color:#3fb950}.r{color:#ff7b72}.y{color:#e3b341}.m{color:#8b949e}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
`;

function cardHtml(card) {
  let body = `<h1>${card.title}</h1>`;
  if (card.sub) body += `<div class="sub">${card.sub}</div>`;
  for (const p of card.panels ?? []) {
    body += `<div class="panel"><div class="ph ${p.kind ?? 'neutral'}">${p.head}</div>`;
    if (p.frame) body += `<pre>${frameHtml(p.frame)}</pre>`;
    if (p.text) body += `<pre>${p.text}</pre>`;
    if (p.html) body += `<div style="padding:10px 12px">${p.html}</div>`;
    body += `</div>`;
  }
  if (card.html) body += card.html;
  if (card.note) body += `<div class="note">${card.note}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card">${body}</div></body></html>`;
}

const [, , specPath, outDir] = process.argv;
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1100, height: 900 } });
for (const card of spec) {
  const html = cardHtml(card);
  const htmlPath = path.join(outDir, card.name + '.html');
  writeFileSync(htmlPath, html);
  await page.goto('file://' + htmlPath);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length,
  );
  await page.locator('#card').screenshot({ path: path.join(outDir, card.name + '.png') });
  console.log(card.name, clipped ? `WARNING ${clipped} clipped pre` : 'ok');
}
await browser.close();
