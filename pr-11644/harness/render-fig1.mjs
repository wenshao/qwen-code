// Render the A/B request-count chart from out/summary.json via Chromium.
import pw from '/root/git/pr11644/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;
const S = JSON.parse(fs.readFileSync('/root/git/h11644/out/summary.json', 'utf8'));
const rows = JSON.parse(fs.readFileSync('/root/git/h11644/out/fig1-rows.json', 'utf8'));
const max = (a, b) => Math.max(a, b, 1);
const bar = (v, m, cls) => `<div class="bar ${cls}" style="width:${(v / m) * 100}%"></div><span class="num">${v}</span>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:15px/1.35 'DejaVu Sans',sans-serif;color:#1f2328}
.wrap{padding:22px 28px;width:1040px}
h1{font-size:21px;margin:0 0 4px} .sub{color:#57606a;font-size:13px;margin-bottom:16px}
.row{display:grid;grid-template-columns:430px 1fr;gap:14px;padding:9px 0;border-top:1px solid #eaeef2}
.label b{display:block;font-size:14px} .label i{font-style:normal;color:#57606a;font-size:12.5px}
.track{display:flex;align-items:center;gap:8px;height:20px;margin:2px 0}
.tag{width:40px;font-size:12px;color:#57606a;text-align:right}
.bar{height:16px;border-radius:3px;min-width:2px} .base{background:#cf222e} .pr{background:#1a7f37}
.num{font-weight:bold;font-size:13px;min-width:28px}
.legend{display:flex;gap:18px;font-size:13px;margin-bottom:6px}.legend span:before{content:'';display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.lb:before{background:#cf222e}.lp:before{background:#1a7f37}
</style></head><body><div class="wrap">
<h1>Browser → daemon requests, real <code>qwen serve</code> + Web Shell (Linux)</h1>
<div class="sub">Same daemon binary; only the Web Shell bundle differs. base 00d86315c8 vs PR 144bc25a31. Counted with Playwright <code>page.on('request')</code>.</div>
<div class="legend"><span class="lb">base</span><span class="lp">PR</span></div>
${rows.map((r) => { const m = max(r.base, r.pr); return `<div class="row"><div class="label"><b>${r.title}</b><i>${r.note}</i></div><div>
<div class="track"><span class="tag">base</span>${bar(r.base, m, 'base')}</div>
<div class="track"><span class="tag">PR</span>${bar(r.pr, m, 'pr')}</div></div></div>`; }).join('')}
</div></body></html>`;
fs.writeFileSync('/root/git/h11644/figs/fig1.html', html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 400 }, deviceScaleFactor: 2 });
await p.setContent(html);
const el = await p.$('.wrap');
await el.screenshot({ path: '/root/git/h11644/figs/fig1-requests.png' });
await b.close();
console.log('fig1 rendered', rows.length, 'rows');
