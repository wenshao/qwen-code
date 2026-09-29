const { chromium } = require('playwright');
const fs = require('fs');
const R = '/root/verify/pr12134/results/';
const OUT = '/root/verify/pr12134/publish/';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function parked(dir) {
  const rows = JSON.parse(fs.readFileSync(R + dir + '/results.json')).scenarios.parked;
  const abs = (e) => rows.filter((r) => r.event === e).reduce((s, r) => s + Math.abs(r.shift), 0);
  return { appears: abs('mount'), drops: abs('step'), completes: abs('unmount') };
}
const arms = [
  ['Before the F1 patch (control)', 'production build', parked('control')],
  ['PR head 2a74ac5', 'production build', parked('head-shots')],
  ['PR head 2a74ac5', 'dev build, React StrictMode', parked('dev-head')],
  ['PR head + suggested patch', 'production build', parked('fix2')],
  ['PR head + suggested patch', 'dev build, React StrictMode', parked('dev-fix2')],
];
fs.writeFileSync(OUT + 'data-reading-shift.json', JSON.stringify(arms.map(([a, b, v]) => ({ arm: a, build: b, ...v, total: v.appears + v.drops + v.completes })), null, 1));
const SEG = [['appears', 'Plan appears', '#2a78d6'], ['drops', '5 row drops (steps 3-7)', '#eb6834'], ['completes', 'Plan completes (strip removed)', '#1baf7a']];
const MAX = 360, W = 520; const px = (v) => (v / MAX) * W;
const rowsHtml = arms.map(([a, b, v]) => {
  const total = v.appears + v.drops + v.completes;
  let x = 0; const segs = [];
  for (const [k, , c] of SEG) { const w = px(v[k]); if (w > 0.5) { segs.push(`<div class="seg" style="left:${x}px;width:${Math.max(0, w - 2)}px;background:${c}"></div>`); x += w; } }
  return `<div class="row"><div class="lab"><div class="a">${esc(a)}</div><div class="b">${esc(b)}</div></div><div class="track">${[0, 100, 200, 300].map((g) => `<div class="grid" style="left:${px(g)}px"></div>`).join('')}${segs.join('')}<div class="val" style="left:${x + 8}px">${total.toFixed(1)} px</div></div></div>`;
}).join('');
const chart = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fcfcfb;font-family:'DejaVu Sans',Arial,sans-serif;color:#0b0b0b}
.card{padding:22px 26px 18px;width:${W + 330}px}
h1{font-size:17px;margin:0 0 4px;font-weight:600} .sub{font-size:12.5px;color:#52514e;margin-bottom:14px;line-height:1.45}
.legend{display:flex;gap:18px;font-size:12.5px;color:#52514e;margin:0 0 12px 250px}.legend span{display:inline-flex;align-items:center;gap:6px}.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
.row{display:flex;align-items:center;height:46px}.lab{width:250px;font-size:13px}.lab .b{color:#52514e;font-size:11.5px;margin-top:2px}
.track{position:relative;height:26px;width:${W + 70}px}.grid{position:absolute;top:-8px;bottom:-8px;width:1px;background:#e4e3df}
.seg{position:absolute;top:0;height:26px;border-radius:0 4px 4px 0}.val{position:absolute;top:4px;font-size:13px;font-weight:600;white-space:nowrap}
.axis{position:relative;height:18px;margin-left:250px;font-size:11px;color:#73726c}.axis div{position:absolute;transform:translateX(-50%)}
.foot{font-size:11.5px;color:#73726c;margin-top:10px;line-height:1.45}
</style></head><body><div class="card">
<h1>How far the text a scrolled-up reader is looking at moves during one 7-step plan</h1>
<div class="sub">Real <code>qwen serve</code> daemon, scripted model emitting real <code>todo_write</code> calls, Chromium 1280×800.<br>The reader wheels 600 px up before the plan starts; the value is the summed |Δy| of one transcript paragraph.</div>
<div class="legend">${SEG.map(([, l, c]) => `<span><i class="sw" style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>
${rowsHtml}
<div class="axis">${[0, 100, 200, 300].map((g) => `<div style="left:${px(g)}px">${g} px</div>`).join('')}</div>
<div class="foot">Per-event numbers are in the report table. main has no strip, so it moves 0 px.</div>
</div></body></html>`;

function crop(file, k) {
  const b64 = fs.readFileSync(file).toString('base64');
  // viewport 1280x800 css; crop the chat pane x 262..1280, y 44..540
  const x0 = 262, y0 = 44, w = 1018, h = 470;
  return { html: `<div class="crop" style="width:${w * k}px;height:${h * k}px"><img src="data:image/png;base64,${b64}" style="width:${1280 * k}px;margin-left:${-x0 * k}px;margin-top:${-y0 * k}px"></div>`, y0, k };
}
const k = 0.56;
const before = JSON.parse(fs.readFileSync(R + 'head-shots/results.json')).beforeComplete;
const guideY = (before.lineY - 44 - 3) * k;
const panel = (file, title, sub, guide) => { const c = crop(file, k); return `<div class="p"><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div><div class="wrap">${c.html}${guide ? `<div class="guide" style="top:${guideY}px"></div>` : ''}</div></div>`; };
const shots = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:'DejaVu Sans',Arial,sans-serif;color:#e6edf3}
.card{padding:18px 20px 14px;display:inline-block}h1{font-size:16px;margin:0 0 4px;font-weight:600}.sub{font-size:12px;color:#9198a1;margin-bottom:12px;line-height:1.45}
.grid2{display:grid;grid-template-columns:auto auto;gap:14px 16px}.p .t{font-size:13px;font-weight:600;margin-bottom:2px}.p .s{font-size:11.5px;color:#9198a1;margin-bottom:6px}
.wrap{position:relative;border:1px solid #30363d;border-radius:6px;overflow:hidden}.crop{overflow:hidden}.crop img{display:block}
.guide{position:absolute;left:0;right:0;height:0;border-top:2px dashed #f2cc60}
.foot{font-size:11.5px;color:#9198a1;margin-top:10px;line-height:1.45}
</style></head><body><div class="card">
<h1>The last todo completes while the reader is scrolled up (production build, real daemon)</h1>
<div class="sub">Red box: the paragraph the reader is looking at. Yellow dashed line: where it was before the strip was removed.</div>
<div class="grid2">
${panel(R + 'head-shots/parked-before-complete.png', 'PR head 2a74ac5: before', 'Step 7 / 7, one open row (strip 64 px)', true)}
${panel(R + 'head-shots/parked-after-complete.png', 'PR head 2a74ac5: after', 'strip removed, paragraph jumps up 64.19 px', true)}
${panel(R + 'fix2/parked-before-complete.png', 'PR head + suggested patch: before', 'same state', true)}
${panel(R + 'fix2/parked-after-complete.png', 'PR head + suggested patch: after', 'paragraph stays put (0.19 px)', true)}
</div>
<div class="foot">The suggested patch hands the strip's height back to the scroller in the layout-effect cleanup, before React removes the strip.</div>
</div></body></html>`;
(async () => {
  const b = await chromium.launch();
  for (const [name, html, sel] of [['fig1-reading-shift', chart, '.card'], ['fig2-completion-ab', shots, '.card']]) {
    const page = await (await b.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 })).newPage();
    await page.setContent(html);
    await page.waitForTimeout(300);
    const box = await page.locator(sel).boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width + 40), height: Math.ceil(box.height + 40) });
    await page.locator(sel).screenshot({ path: OUT + name + '.png' });
    console.log(name, Math.round(box.width), Math.round(box.height));
  }
  await b.close();
})();
