// VERIFICATION RIG ONLY (PR #13129): renders the evidence figures from the probe ledgers (no hand-typed numbers
// except the scenario labels). usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13129-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig`;
fs.mkdirSync(OUT, { recursive: true });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const res = (db, name) => readJson(`${RIG}/out/${db}/${name}.json`);
const lx = (name) => readJson(`${RIG}/lx/rig/out/lx/${name}.json`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const W = 1000;
const css = `
  body{margin:0;background:#fcfcfb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0b0b0b}
  #card{width:${W}px;padding:22px 26px 24px;background:#fcfcfb;border:1px solid #d9d8d4;border-radius:10px}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#52514e;margin:0 0 14px;line-height:1.45}
  h2{font-size:14px;margin:16px 0 6px}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:4px 0 10px}
  th,td{border:1px solid #d9d8d4;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#f0efec;color:#52514e;font-weight:600}
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  td.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  table.kv td:first-child{width:30%}
  .ok{color:#0a7a0a;font-weight:600}.bad{color:#b42727;font-weight:600}.warn{color:#8a5a00;font-weight:600}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f0efec;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;border-left:3px solid #8a5a00;background:#f6f5f2;padding:7px 10px;margin:8px 0;line-height:1.5}
  .note.nbad{border-left-color:#b42727}.note.nok{border-left-color:#0a7a0a}
  .charts{display:flex;gap:18px}
  .chart{flex:1}
  .chart .t{font-size:13px;font-weight:600;margin:0 0 4px}
  svg text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows, cls = '') =>
  `<table class="${cls}"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => (typeof c === 'object' && c !== null ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`)
    .join('')}</table>`;
const OK = (t) => ({ c: 'ok', t: `✔ ${t}` });
const BAD = (t) => ({ c: 'bad', t: `✘ ${t}` });
const WARN = (t) => ({ c: 'warn', t: `▲ ${t}` });
const N = (t) => ({ c: 'num', t });
const M = (t) => ({ c: 'mono', t });
const count = (r) => `${r.pass}/${r.pass + r.fail}`;
const row = (r, label) => r.rows.find((x) => x.label.startsWith(label));
const passed = (r, label) => { const x = row(r, label); return Boolean(x && !x.note && x.ok); };
const mark = (r, label, yes, no) => (passed(r, label) ? OK(yes) : BAD(no));

// Line chart: single series, x = hook_execution rows in the Session, recessive grid, no legend (title names it).
function lineChart(points, { yLabel, color = '#2a78d6', w = 470, h = 250, yFmt = (v) => v }) {
  const pad = { l: 58, r: 14, t: 10, b: 36 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const xRaw = Math.max(...xs);
  const xStep = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * 10 ** Math.floor(Math.log10(xRaw / 6))).find((s) => s * 6 >= xRaw);
  const xMax = xStep * 6;
  const raw = Math.max(...ys) * 1.05;
  const mag = 10 ** Math.floor(Math.log10(raw / 4));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((s) => s * 4 >= raw);
  const yMax = step * 4;
  const X = (x) => pad.l + (x / xMax) * (w - pad.l - pad.r);
  const Y = (y) => h - pad.b - (y / yMax) * (h - pad.t - pad.b);
  const ticks = (max, n) => Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
  const niceY = ticks(yMax, 4);
  const niceX = ticks(xMax, 6);
  const grid = niceY.map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e7e6e2" stroke-width="1"/><text x="${pad.l - 6}" y="${Y(v) + 4}" font-size="10.5" fill="#52514e" text-anchor="end">${yFmt(Math.round(v))}</text>`).join('');
  const xt = niceX.map((v) => `<text x="${X(v)}" y="${h - pad.b + 15}" font-size="10.5" fill="#52514e" text-anchor="middle">${Math.round(v)}</text>`).join('');
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${grid}<line x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}" stroke="#b9b8b2"/>${xt}
    <text x="${(pad.l + w - pad.r) / 2}" y="${h - 4}" font-size="11" fill="#52514e" text-anchor="middle">hook_execution records already in the Session</text>
    <text transform="translate(12,${(pad.t + h - pad.b) / 2}) rotate(-90)" font-size="11" fill="#52514e" text-anchor="middle">${yLabel}</text>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

export const figs = {};
export async function render(names = Object.keys(figs)) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W + 80, height: 900 } });
  const pg = await ctx.newPage();
  for (const name of names) {
    const file = `${OUT}/${name}.html`;
    fs.writeFileSync(file, figs[name]);
    await pg.goto(`file://${file}`);
    const clipped = await pg.evaluate(() => [...document.querySelectorAll('td,pre')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${name}.png ${clipped ? `(${clipped} clipped cells!)` : ''}`);
  }
  await browser.close();
}
export { page, table, OK, BAD, WARN, N, M, count, row, passed, mark, lineChart, res, lx, esc, readJson, RIG };
