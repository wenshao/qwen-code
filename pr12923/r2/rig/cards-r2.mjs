// Round-2 evidence card for PR #12923 @ 3f282a9f.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SP } from './lib.mjs';

const require = createRequire(path.join(SP, 'wt-head', 'package.json'));
const { chromium } = require('playwright');
const CARDS = path.join(SP, 'cards-r2');
fs.mkdirSync(CARDS, { recursive: true });
for (const f of ['web-base-paste.png', 'web-head-preview.png']) fs.copyFileSync(path.join(SP, 'shots', f), path.join(CARDS, f));
const j = (p) => JSON.parse(fs.readFileSync(path.join(SP, p), 'utf8'));
const sdk = j('runs/sdk/results.json');
const sdk2 = j('runs/sdk2-main/results.json');
const exp = j('runs/sdk2-expiry/results.json')[0];
const caps = j('runs/probe-caps/result.json');
const dist = j('runs/dist-compare.json');
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
.note{border-left:3px solid var(--acc);padding:6px 12px;margin-top:14px;background:#0f1b2d;border-radius:0 6px 6px 0}
`;
const crop = (file, [x, y, w, h], scale) =>
  `<div class="shot" style="width:${w * scale}px;height:${h * scale}px"><img src="${file}" style="width:${2720 * scale}px;margin-left:${-x * scale}px;margin-top:${-y * scale}px;display:block"></div>`;
const k = (b) => (b ? '<span class="ok">killed</span>' : '<span class="bad">survived</span>');
const id = (x) => [...sdk, ...sdk2].find((r) => r.id === x);
const hp = web('head-paste');
const bp = web('base-paste');
const mf = web('head-multifail');
const mt = web('head-midturn');
const s12 = id('S12-latency');
const capHead = caps.filter((c) => c.arm === 'head');

const body = `
<h1>Round 2 — PR head <code>3f282a9f</code> (test-only follow-up to <code>1c62df93</code>)</h1>
<p class="sub"><code>git diff 1c62df93..3f282a9f</code>: 2 test files, +58 / −0; non-test diff 0 lines. Bundles built from both heads, compared after normalising esbuild chunk-hash names and the embedded commit SHA: <b class="${dist.identical ? 'ok' : 'bad'}">${dist.normalisedEntries} / ${dist.normalisedEntries} files identical</b>.</p>
<h2>The two new tests (the candidates from round 1, strengthened by the author)</h2>
<table><tr><th>Mutant</th><th>What it removes / breaks</th><th>PR tests @ 1c62df93</th><th>round-1 candidate</th><th>PR tests @ 3f282a9f</th></tr>
<tr><td>M10</td><td>8 MiB check in <code>createUpload</code></td><td>${k(false)}</td><td>${k(true)}</td><td>${k(true)}</td></tr>
<tr><td>M10b</td><td>rejected over-cap create leaks one staging reservation (new mutant)</td><td>${k(false)} <span class="mut">99/99 pass</span></td><td>${k(false)}</td><td>${k(true)}</td></tr>
<tr><td>M13</td><td><code>cancelClientUploads</code> on last-attach detach</td><td>${k(false)}</td><td>${k(true)}</td><td>${k(true)}</td></tr></table>
<div class="note">The author's extra "8 small uploads still fit after the rejection" loop is what kills M10b; the round-1 candidate only asserted the <code>RangeError</code>. The bridge test also gained identity assertions and a <code>string | undefined</code> helper signature.</div>
<h2>Real-environment re-run on the 3f282a9f build (same nginx 1m + fault proxy + Chromium rig)</h2>
<div class="row">
 <div class="col"><span class="tag bad">merge-base</span>${crop('web-base-paste.png', [520, 0, 2200, 1720], 0.293)}</div>
 <div class="col"><span class="tag ok">3f282a9f</span>${crop('web-head-preview.png', [520, 0, 2200, 1720], 0.293)}</div>
</div>
<pre style="margin-top:12px">SDK matrix S1–S9 (nginx, lost responses, 5xx, cancel, ownership, boundaries, mixed versions)  <span class="ok">${sdk.filter((r) => r.pass).length}/${sdk.length} as expected</span>
TCP reset retries, capacity 8 / 32 / 128 MiB and the three release paths                    <span class="ok">${sdk2.filter((r) => r.pass).length}/${sdk2.length} as expected</span>   loopback 8 MiB median ${s12.medianMs.legacy} ms one-shot vs ${s12.medianMs.chunked} ms chunked
5-minute expiry                                                                               <span class="ok">${exp.pass ? 'as expected' : 'FAILED'}</span>   resume after ${Math.round(exp.elapsedMs / 1000)} s → ${exp.resumeAfterExpiry.status}, ${exp.createsAfterExpiry.filter((c) => c === 201).length}/8 slots free
Web Shell paste, base   → <span class="bad">${esc(bp.visibleErrorLines[0])}</span>, ${bp.files.length} files, ${bp.modelCalls.length} model calls
Web Shell paste, PR     → chunks ${hp.faultProxy.filter((e) => /chunks/.test(e.p)).map((e) => e.bytes).join(' + ')}, model image sha256 ${hp.modelCalls.find((c) => c.lastUserImages).images[0].sha256}…, download ${hp.browserDownload.sha256.slice(0, 16)}…
Web Shell two images, 500 on one  → ${mf.faultProxy.filter((e) => e.m === 'DELETE').map((e) => `DELETE …/${e.p.split('/').slice(-2).join('/').replace(/^attachment-uploads\/[0-9a-f]+/, 'attachment-uploads/{id}')} ${e.status}`).join(', ')}; ${mf.files.length} files, ${mf.modelCalls.length} model calls
Web Shell queued send             → ${mt.files.length} file, next model call carries sha256 ${mt.modelCalls.find((c) => c.lastUserImages).images[0].sha256}…
<span class="warn">Capability probe (unchanged, no production change): ${capHead.map((c) => `${c.fault} → ${c.first.ok ? 'OK' : 'upload fails'}`).join(' · ')}; base succeeds in both</span></pre>`;

const file = path.join(CARDS, '06-round2.html');
fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card">${body}</div></body></html>`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1464, height: 1000 }, deviceScaleFactor: 2 });
await page.goto('file://' + file);
await page.waitForTimeout(300);
const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
await page.locator('#card').screenshot({ path: path.join(CARDS, '06-round2.png') });
console.log('06-round2', clipped ? `CLIPPED ${clipped}` : 'ok');
await browser.close();
