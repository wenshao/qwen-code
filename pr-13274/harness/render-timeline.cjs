// Render a measured A/B request timeline to PNG.
// Usage: NODE_PATH=<wt>/node_modules node render-timeline.cjs <spec.json> <out.png>
// spec: { title, subtitle, xMaxMs, tickMs, unit:'s', groups:[{label, note, lanes:[{arm, child, lane}]}] }
// where lane = an entry produced by extract-timeline.mjs.
const { chromium } = require('playwright-core');
const fs = require('fs');

const [specPath, outPng] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const W = 760; // plot width px
const x = (t) => Math.max(0, Math.min(W, (t / spec.xMaxMs) * W));

function laneSvg(l) {
  const parts = [];
  const H = 34;
  const y = 17;
  const reqs = l.lane.requests;
  // Stalls attributed to this lane: an abort of this lane within 30ms, or a
  // request of this lane that follows within 200ms (the re-dispatch).
  const stalls = (l.lane.stalls || []).filter(
    (s) =>
      (l.lane.aborts || []).some((a) => Math.abs(a.t - s) < 30) ||
      reqs.some((r) => r.t > s && r.t - s < 20),
  );
  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i];
    const next = reqs[i + 1];
    const end = l.endMs ?? spec.xMaxMs;
    if (r.action === '429' || r.action === 'stream429') {
      const stallInWait = stalls.find((s) => s > r.t && (!next || s <= next.t));
      const waitEnd = stallInWait ?? (next ? next.t : l.waitEndMs ?? end);
      parts.push(`<rect x="${x(r.t)}" y="${y - 5}" width="${Math.max(2, x(waitEnd) - x(r.t))}" height="10" rx="4" fill="var(--wait)"/>`);
    } else if (r.action === 'hang') {
      const ab = (l.lane.aborts || []).find((a) => a.t >= r.t);
      const hEnd = ab ? ab.t : next ? next.t : end;
      parts.push(`<rect x="${x(r.t)}" y="${y - 5}" width="${Math.max(2, x(hEnd) - x(r.t))}" height="10" rx="4" fill="var(--hang)"/>`);
    }
  }
  for (const r of reqs) {
    const label = r.label ?? (r.action === 'stream429' ? '429*' : r.action === 'ok' ? '200' : r.action);
    parts.push(`<line x1="${x(r.t)}" x2="${x(r.t)}" y1="${y - 10}" y2="${y + 10}" stroke="var(--ink)" stroke-width="2"/>`);
    parts.push(`<text x="${x(r.t) + 3}" y="${y - 8}" class="lbl">${esc(label)}</text>`);
  }
  for (const s of stalls) {
    parts.push(`<g transform="translate(${x(s)},${y})"><circle r="7" fill="var(--crit)" stroke="var(--surface)" stroke-width="2"/><path d="M-3,-3 L3,3 M3,-3 L-3,3" stroke="#fff" stroke-width="1.8"/></g>`);
  }
  if (l.terminal) {
    parts.push(`<g transform="translate(${x(l.terminal.t)},${y})"><rect x="-7" y="-7" width="14" height="14" rx="3" fill="var(--crit)" stroke="var(--surface)" stroke-width="2"/><text x="10" y="4" class="lbl strong">${esc(l.terminal.label)}</text></g>`);
  }
  return `<svg width="${W + 20}" height="${H}" style="overflow:visible"><g transform="translate(6,0)">${parts.join('')}</g></svg>`;
}

const ticks = [];
for (let t = 0; t <= spec.xMaxMs + 1; t += spec.tickMs) ticks.push(t);
const axis = `<svg width="${W + 20}" height="22" style="overflow:visible"><g transform="translate(6,0)">${ticks
  .map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="5" stroke="var(--grid-strong)"/><text x="${x(t)}" y="17" text-anchor="middle" class="tick">${spec.unit === 's' ? (t / 1000).toFixed(spec.tickMs < 1000 ? 1 : 0) + 's' : t + 'ms'}</text>`)
  .join('')}</g></svg>`;
const gridBg = `background-image: ${ticks
  .map(() => '')
  .slice(0, 0)
  .join('')}repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px ${(spec.tickMs / spec.xMaxMs) * W}px); background-position: 6px 0; background-size: ${W + 1}px 100%; background-repeat: no-repeat;`;

const rows = spec.groups
  .map(
    (g) => `
  <div class="group">
    <div class="gtitle">${esc(g.label)}</div>
    ${g.lanes
      .map(
        (l) => `<div class="row"><div class="arm ${l.arm === 'Base' ? 'base' : 'pr'}">${esc(l.arm)}${l.child ? ` <span class="child">${esc(l.child)}</span>` : ''}</div><div class="plot" style="${gridBg}">${laneSvg(l)}</div><div class="verdict ${l.good ? 'good' : 'bad'}">${l.good ? '✓' : '✕'} ${esc(l.verdict)}</div></div>`,
      )
      .join('')}
  </div>`,
  )
  .join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#8a8984;--grid:#ecebe7;--grid-strong:#c9c8c2;
--wait:#2a78d6;--hang:#eb6834;--crit:#d03b3b;--good:#0ca30c;}
body{margin:0;background:var(--surface);font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--ink);}
.card{padding:22px 26px 18px;display:inline-block;}
h1{font-size:19px;margin:0 0 4px;font-weight:650}
.sub{font-size:13px;color:var(--ink2);margin-bottom:12px;max-width:1120px;line-height:1.45}
.legend{display:flex;gap:20px;font-size:12.5px;color:var(--ink2);margin:6px 0 14px;flex-wrap:wrap;align-items:center}
.sw{display:inline-block;width:22px;height:10px;border-radius:4px;vertical-align:middle;margin-right:6px}
.group{margin-bottom:10px;border-top:1px solid var(--grid-strong);padding-top:6px}
.gtitle{font-size:13.5px;font-weight:600;margin:2px 0 4px}
.row{display:flex;align-items:center;height:36px}
.arm{width:118px;font-size:12.5px;font-weight:600;font-family:ui-monospace,Menlo,monospace}
.arm.base{color:var(--ink2)} .arm.pr{color:var(--ink)}
.child{font-weight:400;color:var(--muted)}
.plot{width:${W + 20}px;height:34px}
.verdict{width:310px;font-size:12.5px;padding-left:14px}
.verdict.good{color:#0a7d0a} .verdict.bad{color:var(--crit)}
.lbl{font-size:10.5px;fill:var(--ink2);font-family:ui-monospace,Menlo,monospace}
.lbl.strong{fill:var(--crit);font-weight:600}
.tick{font-size:10.5px;fill:var(--muted)}
.axisrow{display:flex}.axisrow .sp{width:118px}
.foot{font-size:11.5px;color:var(--muted);margin-top:8px;max-width:1120px;line-height:1.45}
</style></head><body><div class="card">
<h1>${esc(spec.title)}</h1><div class="sub">${spec.subtitle}</div>
<div class="legend">
<span><span class="sw" style="background:var(--wait)"></span>announced backoff wait (429 → retry)</span>
<span><span class="sw" style="background:var(--hang)"></span>request with no response (hang)</span>
<span><svg width="16" height="16" style="vertical-align:middle;margin-right:5px"><circle cx="8" cy="8" r="7" fill="#d03b3b"/><path d="M5,5 L11,11 M11,5 L5,11" stroke="#fff" stroke-width="1.8"/></svg>stall watchdog fired → attempt aborted</span>
<span><svg width="14" height="18" style="vertical-align:middle;margin-right:5px"><line x1="7" x2="7" y1="1" y2="17" stroke="#0b0b0b" stroke-width="2"/></svg>child HTTP request (label = provider reply)</span>
</div>
${rows}
<div class="axisrow"><div class="sp"></div>${axis}</div>
<div class="foot">${spec.foot ?? ''}</div>
</div></body></html>`;

(async () => {
  fs.writeFileSync(outPng.replace(/\.png$/, '.html'), html);
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  const card = page.locator('.card');
  const box = await card.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await card.screenshot({ path: outPng });
  await browser.close();
  console.log('wrote', outPng, box);
})();
