// VERIFICATION RIG ONLY (PR #13135): figure helpers — HTML cards rendered with the worktree's Playwright.
import { createRequire } from 'node:module';
import fs from 'node:fs';
export const RIG = '/Users/wenshao/pr13135-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig`;
fs.mkdirSync(OUT, { recursive: true });
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const res = (db, name) => readJson(`${RIG}/out/${db}/${name}.json`);
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const W = 1040;
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
  .ok{color:#0a7a0a;font-weight:600}.bad{color:#b42727;font-weight:600}.warn{color:#8a5a00;font-weight:600}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f0efec;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;border-left:3px solid #8a5a00;background:#f6f5f2;padding:7px 10px;margin:8px 0;line-height:1.5}
  .note.nbad{border-left-color:#b42727}.note.nok{border-left-color:#0a7a0a}
`;
export const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
export const table = (head, rows, cls = '') =>
  `<table class="${cls}"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => (typeof c === 'object' && c !== null ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`)
    .join('')}</table>`;
export const OK = (t) => ({ c: 'ok', t: `✔ ${t}` });
export const BAD = (t) => ({ c: 'bad', t: `✘ ${t}` });
export const WARN = (t) => ({ c: 'warn', t: `▲ ${t}` });
export const N = (t) => ({ c: 'num', t });
export const M = (t) => ({ c: 'mono', t });
export const count = (r) => `${r.pass}/${r.pass + r.fail}`;

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
