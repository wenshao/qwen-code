// node make-cards.mjs <cards.json> <outdir> <worktree-with-playwright>
// Each card: { id, title, subtitle, blocks: [{ kind: 'table'|'pre'|'note', ... }] }
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [cardsFile, outDir, wt] = process.argv.slice(2);
const cards = JSON.parse(fs.readFileSync(cardsFile, 'utf8'));
const require = createRequire(path.join(wt, 'package.json'));
const { chromium } = require('playwright');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (c) => {
  const raw = String(c);
  const forced = /^\[(g|r|m|a)\] /.exec(raw);
  const s = forced ? raw.slice(4) : raw;
  if (forced) return `<td class="${forced[1]}">${esc(s)}</td>`;
  if (/^KILLED-/.test(s)) return `<td class="r">${esc(s)}</td>`;
  const cls = /^(ACCEPT|COMMITTED|OK|PASS|KILLED|yes)\b/.test(s)
    ? 'g'
    : /^(REJECT|REFUSED|FAILED|HANG|KILLED-|SURVIVED|INVALID|no\b)/.test(s)
      ? 'r'
      : /^(~|≈|n\/a|—)/.test(s)
        ? 'm'
        : '';
  return `<td class="${cls}">${esc(s)}</td>`;
};

function block(b) {
  if (b.kind === 'table') {
    return `<table>${b.caption ? `<caption>${esc(b.caption)}</caption>` : ''}<thead><tr>${b.head
      .map((h) => `<th>${esc(h)}</th>`)
      .join('')}</tr></thead><tbody>${b.rows
      .map((r) => `<tr${r.hl ? ' class="hl"' : ''}>${(r.cells ?? r).map(cell).join('')}</tr>`)
      .join('')}</tbody></table>`;
  }
  if (b.kind === 'pre') return `<pre>${esc(b.text)}</pre>`;
  if (b.kind === 'note')
    return `<div class="note ${b.tone ?? ''}">${esc(b.text)}</div>`;
  if (b.kind === 'bars') {
    const max = Math.max(...b.rows.map((r) => r.value));
    const scale = (v) => (b.log ? Math.log10(v + 1) / Math.log10(max + 1) : v / max);
    return `<div class="bars">${b.caption ? `<div class="cap">${esc(b.caption)}</div>` : ''}${b.rows
      .map(
        (r) =>
          `<div class="bar"><span class="bl">${esc(r.label)}</span><span class="track"><span class="fill ${r.tone ?? ''}" style="width:${Math.max(0.6, scale(r.value) * 100).toFixed(1)}%"></span></span><span class="bv">${esc(r.text)}</span></div>`,
      )
      .join('')}</div>`;
  }
  throw new Error(`unknown block ${b.kind}`);
}

const css = `
:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--line:#30363d;--g:#3fb950;--r:#f85149;--a:#d29922;--b:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{width:1180px;padding:26px 30px 24px;background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;color:var(--mut);font-weight:400;margin:0 0 16px}
table{border-collapse:collapse;width:100%;margin:6px 0 14px;font:13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}
caption{text-align:left;color:var(--b);font:600 13px -apple-system,sans-serif;padding:0 0 6px}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{background:#161b22;color:var(--mut);font-weight:600}
td.g{color:var(--g)}td.r{color:var(--r)}td.m{color:var(--mut)}td.a{color:var(--a)}tr.hl td{background:#2d1f0f}
pre{white-space:pre;overflow:hidden;background:#161b22;border:1px solid var(--line);padding:10px 12px;font:12.5px/1.4 ui-monospace,Menlo,monospace;margin:6px 0 14px}
.note{border-left:4px solid var(--b);background:#161b22;padding:9px 12px;margin:8px 0 6px;font-size:14px}
.note.warn{border-color:var(--a)}.note.bad{border-color:var(--r)}.note.good{border-color:var(--g)}
.bars{margin:6px 0 14px}.cap{color:var(--b);font-weight:600;font-size:13px;margin-bottom:6px}
.bar{display:flex;align-items:center;gap:10px;margin:3px 0;font:12.5px ui-monospace,Menlo,monospace}
.bl{width:250px;color:var(--mut)}.track{flex:1;height:14px;background:#161b22;border:1px solid var(--line)}
.fill{display:block;height:100%;background:var(--b)}.fill.r{background:var(--r)}.fill.g{background:var(--g)}.fill.a{background:var(--a)}
.bv{width:250px}
`;

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1240, height: 900 } });
for (const c of cards) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(c.title)}</h1><h2>${esc(c.subtitle)}</h2>${c.blocks.map(block).join('')}</div></body></html>`;
  const htmlPath = path.join(outDir, `${c.id}.html`);
  fs.writeFileSync(htmlPath, html);
  await page.goto(`file://${htmlPath}`);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length,
  );
  await page.locator('#card').screenshot({ path: path.join(outDir, `${c.id}.png`) });
  console.log(`${c.id}.png clippedPre=${clipped}`);
}
await browser.close();
