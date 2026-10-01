// Render per-run model-request timelines (from the recording proxy) to PNG.
//   NODE_PATH=<wt>/node_modules node gantt.cjs <out.png> <title> <rid>[,<rid>...] [--xmax=SEC] [--lines]
const fs = require('fs');
const path = require('path');
const { chromium } = require('/root/verify/pr13005/wt/node_modules/playwright-core');

const [, , outPng, title, ridList, ...flags] = process.argv;
const xmaxFlag = flags.find((f) => f.startsWith('--xmax='));
const showLines = flags.includes('--lines');
const ROOT = '/root/verify/pr13005/runs';
const summary = JSON.parse(fs.readFileSync('/root/verify/pr13005/summary.json', 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const COLORS = {
  tool_search: '#d97706',
  bridge: '#f59e0b',
  monitor: '#2563eb',
  final: '#60a5fa',
  drain: '#0d9488',
  extractor: '#9333ea',
  other: '#6b7280',
};
function label(r) {
  const calls = r.respToolCalls || [];
  if (r.purpose === 'memory-extractor') return ['extractor', 'memory extractor'];
  if (r.purpose === 'main:task-notification-drain') return ['drain', 'drain turn'];
  if (calls.includes('tool_search')) return ['tool_search', 'tool_search'];
  if (calls.includes('tool_call')) return ['bridge', 'tool_call bridge'];
  if (calls.includes('monitor')) return ['monitor', 'monitor call'];
  if (calls.length) return ['other', calls.join(',')];
  return ['final', 'final answer'];
}

const runs = ridList.split(',').map((rid) => {
  const meta = summary.find((s) => s.rid === rid);
  let reqs = fs.readFileSync(path.join(ROOT, rid, 'proxy.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).sort((a, b) => a.tRecv - b.tRecv);
  if (meta.registered) {
    const starts = reqs.map((r, i) => (r.purpose === 'main:user-prompt' ? i : -1)).filter((i) => i >= 0);
    if (starts[1] !== undefined) reqs = reqs.slice(starts[1]);
  }
  const t0 = reqs[0].tRecv;
  // Pack overlapping bars into sub-lanes.
  const lanes = [];
  const bars = reqs.map((r) => {
    const s = (r.tRecv - t0) / 1000;
    const e = ((r.tEnd ?? r.tRecv) - t0) / 1000;
    let lane = lanes.findIndex((end) => end <= s + 0.05);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = e;
    const [kind, text] = label(r);
    return { s, e, inj: (r.injectMs || 0) / 1000, kind, text, lane };
  });
  const infFile = path.join(ROOT, rid, 'inflight.json');
  const inflight = fs.existsSync(infFile) ? JSON.parse(fs.readFileSync(infFile, 'utf8')) : [];
  for (const f of inflight) {
    let lane = lanes.findIndex((end) => end <= f.s + 0.05);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = 1e9;
    bars.push({ s: f.s, e: null, inj: 0, kind: f.kind, text: f.text, lane, inflight: true });
  }
  const span = Math.max(...bars.filter((b) => b.e !== null).map((b) => b.e));
  const bootSec = meta.call.vitest && meta.call.vitest.ok ? meta.call.vitest.ms / 1000 - span : null;
  return { rid, meta, bars, nLanes: lanes.length, n: reqs.length + inflight.length, nDone: reqs.length, bootSec };
});

const boots = runs.map((r) => r.bootSec).filter((v) => v !== null).sort((a, b) => a - b);
const boot = boots.length ? boots[Math.floor(boots.length / 2)] : 0;
const timeoutX = 300 - boot;
for (const r of runs) for (const b of r.bars) if (b.e === null) b.e = timeoutX;
const xmax = xmaxFlag ? Number(xmaxFlag.split('=')[1]) : Math.ceil(Math.max(...runs.flatMap((r) => r.bars.map((b) => b.e))) / 5) * 5 + 5;
const W = 1180, LEFT = 300, RIGHT = 30, LANE_H = 26, GAP = 16;
const plotW = W - LEFT - RIGHT;
const x = (t) => LEFT + (t / xmax) * plotW;
let y = 50;
let svg = '';
for (const run of runs) {
  const m = run.meta;
  const c = m.call;
  const verdict = c.vitest ? (c.vitest.ok ? 'PASS' : 'FAIL') : '?';
  const timedOut = c.timedOut ? ` — timed out` : '';
  const pair = /^n(\d+)-/.exec(run.rid); const armName = (pair ? `pair ${pair[1]} · ` : '') + (m.arm === 'base' ? 'main test' : m.arm === 'pr' ? 'PR test' : m.arm);
  const h = run.nLanes * LANE_H;
  svg += `<text x="12" y="${y + 16}" class="arm ${m.arm}">${esc(armName)}${m.injectMs ? ` · +${m.injectMs / 1000}s/req` : ''}</text>`;
  svg += `<text x="12" y="${y + 34}" class="sub">${run.nDone === run.n ? run.n : run.nDone + ' of ' + run.n} model requests · <tspan class="${verdict === 'PASS' ? 'pass' : 'fail'}">${verdict}</tspan> ${c.vitest ? (c.vitest.ms / 1000).toFixed(1) + 's' : ''}${esc(timedOut)}</text>`;
  svg += `<rect x="${LEFT}" y="${y - 3}" width="${plotW}" height="${h + 6}" class="lanebg"/>`;
  for (const b of run.bars) {
    const by = y + b.lane * LANE_H;
    const bw = Math.max(2, x(b.e) - x(b.s));
    if (b.inflight) svg += `<rect x="${x(b.s)}" y="${by}" width="${bw}" height="${LANE_H - 5}" rx="3" fill="${COLORS[b.kind]}" fill-opacity="0.35" stroke="${COLORS[b.kind]}" stroke-dasharray="4 3"/>`;
    else svg += `<rect x="${x(b.s)}" y="${by}" width="${bw}" height="${LANE_H - 5}" rx="3" fill="${COLORS[b.kind]}"/>`;
    if (b.inj > 0) svg += `<rect x="${x(b.s)}" y="${by}" width="${Math.min(bw, x(b.inj) - x(0))}" height="${LANE_H - 5}" rx="3" fill="url(#hatch)"/>`;
    if (bw > 64) svg += `<text x="${x(b.s) + 5}" y="${by + 15}" class="${b.inflight ? 'barin' : 'bar'}">${esc(b.text)}</text>`;
  }
  y += h + GAP + 18;
}
const axisY = y;
let axis = `<line x1="${LEFT}" y1="${axisY}" x2="${LEFT + plotW}" y2="${axisY}" class="axis"/>`;
let gridOnly = '';
const step = xmax > 200 ? 30 : xmax > 60 ? 10 : 5;
for (let t = 0; t <= xmax; t += step) { gridOnly += `<line x1="${x(t)}" y1="40" x2="${x(t)}" y2="${axisY}" class="grid"/>`; axis += `<text x="${x(t)}" y="${axisY + 16}" class="tick">${t}s</text>`; }
if (showLines) {
  
  axis += `<line x1="${x(timeoutX)}" y1="36" x2="${x(timeoutX)}" y2="${axisY}" class="lim"/><text x="${x(timeoutX) - 4}" y="34" class="limt" text-anchor="end">test timeout (300s after test start)</text>`;
}
const legend = Object.entries({ tool_search: 'tool_search', bridge: 'tool_call bridge', monitor: 'monitor call', final: 'final answer', drain: 'drain turn', extractor: 'memory extractor' })
  .map(([k, v]) => `<span><i style="background:${COLORS[k]}"></i>${v}</span>`).join('') + (runs.some((r) => r.meta.injectMs) ? '<span><i class="hatch"></i>injected delay</span>' : '');
const H = axisY + 30;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328}
.wrap{padding:18px 20px 10px;width:${W}px}
h1{font-size:17px;margin:0 0 4px} .cap{font-size:12.5px;color:#57606a;margin:0 0 8px}
.legend{font-size:12px;color:#1f2328;display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 0}
.legend i{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:5px;vertical-align:-2px}
.legend i.hatch{background:repeating-linear-gradient(45deg,#fff 0 3px,#9ca3af 3px 5px);border:1px solid #9ca3af}
text{font-size:12px} .arm{font-weight:600;font-size:13px} .arm.base{fill:#9a3412} .arm.pr{fill:#1e40af}
.sub{fill:#57606a} .pass{fill:#1a7f37;font-weight:600} .fail{fill:#cf222e;font-weight:600}
.bar{fill:#fff;font-size:11px;font-weight:600;paint-order:stroke;stroke:rgba(17,24,39,.55);stroke-width:2.6px} .barin{fill:#1f2328;font-size:11px;font-weight:500} .lanebg{fill:#f6f8fa;fill-opacity:.6}
.axis{stroke:#8c959f} .grid{stroke:#eaeef2} .tick{fill:#57606a;font-size:11px;text-anchor:middle}
.lim{stroke:#cf222e;stroke-width:2;stroke-dasharray:6 4} .limt{fill:#cf222e;font-size:11.5px;font-weight:600}
.lim2{stroke:#bf8700;stroke-width:1.5;stroke-dasharray:4 4} .limt2{fill:#9a6700;font-size:11.5px}
</style></head><body><div class="wrap"><h1>${esc(title)}</h1>
<p class="cap">Real model (qwen3.8-max) behind a recording proxy · same <code>dist/cli.js</code> (main 0a5f518b4f + PR) for both arms · only the test file differs · t=0 = first model request of the <code>should call monitor tool</code> case</p>
<div class="legend">${legend}</div>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${gridOnly}<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(255,255,255,0.55)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(55,65,81,0.55)" stroke-width="3"/></pattern></defs>${svg}${axis}</svg></div></body></html>`;
fs.writeFileSync(outPng.replace(/\.png$/, '.html'), html);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: W + 40, height: 400 } });
  await page.setContent(html);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  const box2 = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: outPng, clip: box2 });
  await browser.close();
  console.log('wrote', outPng, Math.round(box2.width), 'x', Math.round(box2.height));
})();
