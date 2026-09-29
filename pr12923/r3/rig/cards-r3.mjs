// Round-3 evidence card for PR #12923 @ 4b45177be.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SP } from './lib.mjs';

const require = createRequire(path.join(SP, 'wt-head', 'package.json'));
const { chromium } = require('playwright');
const OUT = path.join(SP, 'evidence');
const j = (p) => JSON.parse(fs.readFileSync(path.join(SP, p), 'utf8'));
const sdk = j('runs/sdk/results.json');
const sdk2 = j('runs/sdk2-main/results.json');
const exp = j('runs/sdk2-expiry/results.json')[0];
const caps = j('runs/probe-caps/result.json');
const live = j('runs/live-r1/results.json');
const mut = j('results/mutants-r3.json');
const web = (n) => j(`runs/web-${n}/result.json`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--acc:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--fg)}
#card{width:1400px;padding:28px 32px;background:var(--bg)}h1{font-size:23px;margin:0 0 4px}h2{font-size:17px;margin:20px 0 8px;color:var(--acc)}
.sub{color:var(--mut);margin:0 0 10px;font-size:14px}
pre{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.mut{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:600}
.row{display:flex;gap:16px}.col{flex:1;min-width:0}.shot{border:1px solid var(--line);border-radius:8px;overflow:hidden}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:10px;margin:0 8px 6px 0}.tag.bad{background:#3d1214}.tag.ok{background:#12301a}
`;
const crop = (file, [x, y, w, h], scale) =>
  `<div class="shot" style="width:${w * scale}px;height:${h * scale}px"><img src="${file}" style="width:${2720 * scale}px;margin-left:${-x * scale}px;margin-top:${-y * scale}px;display:block"></div>`;
const hp = web('head-paste');
const bp = web('base-paste');
const mf = web('head-multifail');
const mt = web('head-midturn');
const s12 = sdk2.find((r) => r.id === 'S12-latency');
const capHead = caps.filter((c) => c.arm === 'head');
const s2h = sdk.find((r) => r.id === 'S2-head');
const mutRow = mut
  .map((m) => `<tr><td>${m.id}</td><td>${m.cleanPasses ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>'} <span class="mut">${esc(m.cleanSummary)}</span></td><td>${m.killed ? '<span class="ok">KILLED</span>' : '<span class="bad">SURVIVED</span>'} <span class="mut">${esc(m.mutantSummary)}</span></td></tr>`)
  .join('');

const body = `
<h1>Round 3 — PR head <code>4b45177be</code> (bot-review fixes R1-1 … R1-12), Linux aarch64</h1>
<p class="sub">nginx 1.27.5 <code>client_max_body_size 1m</code> → fault proxy → daemon. Fixture: 2855×1625 PNG, ${hp.source.bytes.toLocaleString('en-US')} B, sha256 ${hp.source.sha256.slice(0, 16)}…</p>
<h2>Web Shell through the 1 MiB gateway: merge-base vs PR head</h2>
<div class="row">
 <div class="col"><span class="tag bad">merge-base b32f261a</span>${crop('../shots/web-base-paste.png', [520, 0, 2200, 1720], 0.293)}</div>
 <div class="col"><span class="tag ok">4b45177be</span>${crop('../shots/web-head-preview.png', [520, 0, 2200, 1720], 0.293)}</div>
</div>
<pre style="margin-top:12px">base   → <span class="bad">${esc(bp.visibleErrorLines[0])}</span>; ${bp.files.length} files stored, ${bp.modelCalls.length} model calls
head   → chunks ${hp.faultProxy.filter((e) => /chunks/.test(e.p)).map((e) => e.bytes).join(' + ')}, all 200; model got 1 image sha256 ${hp.modelCalls.find((c) => c.lastUserImages).images[0].sha256}…; download ${hp.browserDownload.sha256.slice(0, 16)}… (byte-identical)</pre>
<h2>Re-measured at the new head (same rig as rounds 1–2)</h2>
<pre>SDK matrix S1–S9 (nginx 413 control, lost responses, 5xx, cancel, ownership, boundaries, mixed versions)  <span class="ok">${sdk.filter((r) => r.pass).length}/${sdk.length} as expected</span>
TCP-reset retries, capacity 8/32/128 MiB, three release paths                                          <span class="ok">${sdk2.filter((r) => r.pass).length}/${sdk2.length} as expected</span>
8 MiB loopback latency, 5 runs each    median ${s12.medianMs.legacy} ms one-shot vs ${s12.medianMs.chunked} ms chunked
5-minute expiry                                                                                          <span class="ok">${exp.pass ? 'as expected' : 'FAILED'}</span>   resume after ${Math.round(exp.elapsedMs / 1000)} s → ${exp.resumeAfterExpiry.status}, ${exp.createsAfterExpiry.filter((c) => c === 201).length}/8 slots free
Web Shell two images, gateway 500 on one  → ${mf.faultProxy.filter((e) => e.m === 'DELETE').map((e) => `DELETE …/${e.p.split('/').slice(-2).join('/')} ${e.status}`).join(', ')}; ${mf.files.length} files, ${mf.modelCalls.length} model calls
Web Shell queued send during a turn       → ${mt.files.length} file, model call carries sha256 ${mt.modelCalls.find((c) => c.lastUserImages).images[0].sha256}…
<span class="warn">Capability probe (carried forward, deferred): ${capHead.map((c) => `${c.fault} → first upload ${c.first.ok ? 'OK' : 'fails'}`).join(' · ')}; second upload recovers; base succeeds</span></pre>
<h2>The R1-review fixes: each is pinned by its new test (single-point mutants)</h2>
<table><tr><th>Fix reverted</th><th>Clean run</th><th>Mutant run</th></tr>${mutRow}</table>
<pre style="margin-top:12px">live daemon, R1-4: Content-Encoding gzip on a chunk → ${live.find((r) => r.id === 'R1-4a-live').gz.status} ${live.find((r) => r.id === 'R1-4a-live').gz.json.code};  charset iso-8859-1 on create → ${live.find((r) => r.id === 'R1-4b-live').r.status} ${live.find((r) => r.id === 'R1-4b-live').r.json.code}
live daemon, R1-5: gateway HTML 413 on a chunk → SDK error "${esc(live.find((r) => r.id === 'R1-5a-live').message.slice(0, 88))}…"
live daemon, R1-5: daemon's own over-size create 413 → ${live.find((r) => r.id === 'R1-5b-live').r.json.code} (structured, no hint)</pre>`;

const file = path.join(OUT, '04-round3-card.html');
fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card">${body}</div></body></html>`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1464, height: 1000 }, deviceScaleFactor: 2 });
await page.goto('file://' + file);
await page.waitForTimeout(300);
const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
await page.locator('#card').screenshot({ path: path.join(OUT, '04-round3-card.png') });
console.log('04-round3-card', clipped ? `CLIPPED ${clipped}` : 'ok');
await browser.close();
