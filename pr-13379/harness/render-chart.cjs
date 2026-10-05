// Static benchmark figure (light surface) from out/bench/chart-data.json -> PNG.
const fs = require('fs');
const NM = '/root/verify/pr13379/head/node_modules';
const { chromium } = require(NM + '/playwright-core');
const d = JSON.parse(fs.readFileSync('/root/verify/pr13379/out/bench/chart-data.json', 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const W = 1250, LX = 330, PW = 560; // label column, plot width (0..100%)
const x = (pct) => LX + (pct / 100) * PW;
const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');
const pctTxt = (p) => (p - 100 >= 0 ? '+' : '−') + Math.abs(p - 100).toFixed(0) + '%';
function bar(x0, y, w, h, color) { // 4px rounded data end, square at baseline
  const r = Math.min(4, w); return `<path d="M${x0},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z" fill="${color}"/>`;
}
function grid(y0, y1) {
  let s = '';
  for (const g of [0, 25, 50, 75, 100]) {
    s += `<line x1="${x(g)}" x2="${x(g)}" y1="${y0}" y2="${y1}" stroke="${g === 100 ? 'var(--ref)' : 'var(--grid)'}" stroke-width="1" ${g === 100 ? 'stroke-dasharray="4 3"' : ''}/>`;
    s += `<text x="${x(g)}" y="${y1 + 16}" text-anchor="middle" class="tick">${g}%</text>`;
  }
  return s;
}
let y = 0, svg = '';
// Panel A
svg += `<text x="16" y="${y += 30}" class="h">A · PR@87682bc vs main@71fefc7 — full extension refresh, 100 extensions × (40 skills, 10 commands, 5 agents)</text>`;
svg += `<text x="16" y="${y += 20}" class="sub">Bar = PR time as % of main (dashed line = main, 100%). Linux 6.12 KVM, 16 vCPU, Node 22.22.2, ext4 on NVMe unless noted. Medians.</text>`;
y += 14; const a0 = y; let rowsA = '';
for (const r of d.A) {
  const h = 18; y += 8;
  rowsA += `<text x="${LX - 12}" y="${y + 13}" text-anchor="end" class="lbl">${esc(r.label)}</text>`;
  rowsA += `<rect x="${LX}" y="${y}" width="${PW}" height="${h}" fill="var(--track)"/>`;
  rowsA += bar(LX, y, (r.pct / 100) * PW, h, 'var(--s1)');
  rowsA += `<text x="${x(100) + 10}" y="${y + 13}" class="val"><tspan class="strong">${pctTxt(r.pct)}</tspan>  ${fmt(r.main)} → ${fmt(r.pr)}  <tspan class="muted">(${esc(r.n)})</tspan></text>`;
  y += h + 6;
}
svg += grid(a0, y + 4) + rowsA; y += 40;
// Panel B
svg += `<text x="16" y="${y += 24}" class="h">B · How much of the attainable overlap the batch barrier keeps (fresh-process first refresh, time as % of the serial loop)</text>`;
svg += `<text x="16" y="${y += 20}" class="sub">Same built dist; only the outer loop swapped. "Pool of 4" is a reviewer sketch (sliding window, same directory-order results and drain), not part of the PR. n=9–11 per cell.</text>`;
y += 12;
svg += `<rect x="${LX}" y="${y + 2}" width="12" height="12" rx="2" fill="var(--s1)"/><text x="${LX + 18}" y="${y + 13}" class="lbl">PR: batches of 4 (barrier)</text>`;
svg += `<rect x="${LX + 220}" y="${y + 2}" width="12" height="12" rx="2" fill="var(--s2)"/><text x="${LX + 238}" y="${y + 13}" class="lbl">Sketch: sliding pool of 4</text>`;
y += 22; const b0 = y; let rowsB = '';
for (const r of d.B) {
  const h = 14; y += 10;
  rowsB += `<text x="${LX - 12}" y="${y + h + 2}" text-anchor="end" class="lbl">${esc(r.label)}</text>`;
  rowsB += `<text x="${LX - 12}" y="${y + h + 17}" text-anchor="end" class="muted small">serial ${fmt(r.serial)}</text>`;
  rowsB += bar(LX, y, (r.batchPct / 100) * PW, h, 'var(--s1)');
  rowsB += `<text x="${x(100) + 10}" y="${y + 11}" class="val">${pctTxt(r.batchPct)}  <tspan class="muted">${fmt(r.batch4)}</tspan></text>`;
  y += h + 2; // 2px surface gap between adjacent bars
  rowsB += bar(LX, y, (r.poolPct / 100) * PW, h, 'var(--s2)');
  rowsB += `<text x="${x(100) + 10}" y="${y + 11}" class="val">${pctTxt(r.poolPct)}  <tspan class="muted">${fmt(r.pool4)}</tspan></text>`;
  y += h + 6;
}
svg += grid(b0, y + 4) + rowsB; y += 34;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
.viz-root{--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#7a7974;--grid:#e6e5e1;--ref:#9a9993;--track:#f0efec;--s1:#2a78d6;--s2:#eb6834}
body{margin:0;background:#fcfcfb}
.viz-root{background:var(--surface-1);padding:8px 10px;display:block;width:${W}px}
text{font-family:'DejaVu Sans',sans-serif;fill:var(--text-secondary);font-size:13px}
.h{font-size:15px;font-weight:700;fill:var(--text-primary)} .sub{font-size:12px;fill:var(--text-muted)}
.lbl{fill:var(--text-primary)} .val{fill:var(--text-secondary)} .strong{font-weight:700;fill:var(--text-primary)}
.muted{fill:var(--text-muted)} .small{font-size:11px} .tick{font-size:11px;fill:var(--text-muted)}
</style></head><body><div class="viz-root" id="v"><svg width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">${svg}</svg></div></body></html>`;
fs.writeFileSync('/root/verify/pr13379/out/bench/chart.html', html);
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: W + 40, height: y + 40 } });
  await page.setContent(html);
  await page.locator('#v').screenshot({ path: '/root/verify/pr13379/pub/benchmark.png' });
  await browser.close();
  console.log('wrote benchmark.png', W, y);
})();
