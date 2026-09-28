// Evidence cards for the PR comment: HTML -> Playwright element screenshot (2x).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SP } from './lib.mjs';

const require = createRequire(path.join(SP, 'wt-head', 'package.json'));
const { chromium } = require('playwright');
const CARDS = path.join(SP, 'cards');
fs.mkdirSync(CARDS, { recursive: true });
for (const f of fs.readdirSync(path.join(SP, 'shots'))) fs.copyFileSync(path.join(SP, 'shots', f), path.join(CARDS, f));
fs.copyFileSync(path.join(SP, 'runs/web-head-midturn/midturn-during.png'), path.join(CARDS, 'web-head-midturn-during.png'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sdk = JSON.parse(fs.readFileSync(path.join(SP, 'runs/sdk/results.json'), 'utf8'));
const sdk2 = JSON.parse(fs.readFileSync(path.join(SP, 'runs/sdk2-main/results.json'), 'utf8'));
const exp = JSON.parse(fs.readFileSync(path.join(SP, 'runs/sdk2-expiry/results.json'), 'utf8'));
const caps = JSON.parse(fs.readFileSync(path.join(SP, 'runs/probe-caps/result.json'), 'utf8'));
const web = (n) => JSON.parse(fs.readFileSync(path.join(SP, `runs/web-${n}/result.json`), 'utf8'));
const mut = (fs.existsSync(path.join(SP, 'runs/mutants.json')) ? JSON.parse(fs.readFileSync(path.join(SP, 'runs/mutants.json'), 'utf8')) : []).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
const byId = (id) => [...sdk, ...sdk2, ...exp].find((r) => r.id === id);

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--acc:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--fg)}
#card{width:1400px;padding:28px 32px;background:var(--bg)}
h1{font-size:23px;margin:0 0 4px}h2{font-size:17px;margin:18px 0 8px;color:var(--acc)}
.sub{color:var(--mut);margin:0 0 14px;font-size:14px}
pre{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.mut{color:var(--mut)}
.row{display:flex;gap:16px}.col{flex:1;min-width:0}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:10px;margin-right:8px}
.tag.bad{background:#3d1214}.tag.ok{background:#12301a}.tag.warn{background:#3a2a07}
.shot{border:1px solid var(--line);border-radius:8px;overflow:hidden;position:relative}
.shot img{position:absolute;left:0;top:0}
.note{border-left:3px solid var(--acc);padding:6px 12px;margin-top:14px;color:var(--fg);background:#0f1b2d;border-radius:0 6px 6px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:600}td.r{white-space:nowrap}
`;
// Crop a 2x screenshot (2720x1720) to [x,y,w,h] source pixels and display at `scale`.
const crop = (file, [x, y, w, h], scale = 0.5) =>
  `<div class="shot" style="width:${w * scale}px;height:${h * scale}px"><img src="${file}" style="width:${2720 * scale}px;margin-left:${-x * scale}px;margin-top:${-y * scale}px;position:relative"></div>`;

const cards = {};

// 1. Web Shell before/after.
{
  const b = web('base-paste');
  const h = web('head-paste');
  cards['01-webshell-before-after'] = `
<h1>Web Shell behind nginx <code>client_max_body_size 1m</code>: paste a 2855×1625 PNG (1,778,959 B) and send</h1>
<p class="sub">Same Web Shell flow, same PNG, same nginx 1.27.5 container. Each arm serves its own bundled Web Shell from its own daemon build. Model = local OpenAI-compatible fake that hashes every image it receives.</p>
<div class="row">
 <div class="col"><span class="tag bad">BEFORE · merge-base b32f261a</span>
  ${crop('web-base-paste.png', [520, 0, 2200, 1720], 0.293)}
  <pre style="margin-top:8px">nginx: POST …/attachments?name=image.png  <span class="bad">413</span>  content_length=1778959
toast: <span class="bad">${esc(b.visibleErrorLines[0])}</span>
stored files: ${b.files.length}   model calls: ${b.modelCalls.length}   draft restored</pre></div>
 <div class="col"><span class="tag ok">AFTER · PR head 1c62df93</span>
  ${crop('web-head-preview.png', [520, 0, 2200, 1720], 0.293)}
  <pre style="margin-top:8px">nginx: create 201 → 4 chunks <span class="ok">200</span> (524288×3 + 206095) → complete <span class="ok">200</span>
stored: image.png ${h.files[0].bytes} B  sha256 ${h.files[0].sha256.slice(0, 16)}…
model:  ${h.modelCalls[0].images.length} image  ${h.modelCalls[0].images[0].bytes} B  sha256 ${h.modelCalls[0].images[0].sha256}…
browser GET via nginx: ${h.browserDownload.bytes} B  sha256 ${h.browserDownload.sha256.slice(0, 16)}…</pre></div>
</div>
<div class="note">Source PNG sha256 <b>${h.source.sha256.slice(0, 16)}…</b> — the stored file, the provider request and the browser download all match it byte-for-byte.</div>`;
}

// 2. Wire ledger.
{
  const trim = (l) =>
    l
      .replace(/"(\w+) \/session\/[0-9a-f-]+/, '"$1 /session/…')
      .replace(/attachment-uploads\/[0-9a-f-]+/, 'attachment-uploads/{id}')
      .replace(/ HTTP\/1\.1"/, '"')
      .replace(/ request_length=\d+/, '');
  const color = (l) => (/status=4\d\d/.test(l) ? `<span class="bad">${esc(l)}</span>` : esc(l));
  const b = byId('S2-base');
  const h = byId('S2-head');
  const s5 = byId('S5-headSDK-baseDaemon-nginx');
  cards['02-nginx-wire'] = `
<h1>What nginx saw — TypeScript SDK <code>uploadSessionAttachment()</code>, same 1,778,959 B PNG</h1>
<p class="sub">docker nginx:1.27-alpine access log (<code>$http_content_length</code>). DaemonClient → nginx:18080 → transparent ledger proxy → <code>qwen serve</code> (dist/cli.js).</p>
<h2>base SDK + base daemon</h2><pre>${b.nginx.map(trim).map(color).join('\n')}
<span class="mut">→ DaemonHttpError 413 (nginx HTML body); nothing reached the daemon; 0 files</span></pre>
<h2>PR SDK + PR daemon</h2><pre>${h.nginx.map(trim).map(color).join('\n')}
<span class="ok">→ ref ${esc(JSON.stringify(h.ref))}
→ provider received ${h.modelImages.length} image, ${h.modelImages[0].bytes} B, sha256 ${h.modelImages[0].sha256.slice(0, 16)}… = source</span></pre>
<h2>PR SDK + base daemon (no <code>session_attachment_chunk_upload</code> capability)</h2><pre>${s5.nginx.map(trim).map(color).join('\n')}
<span class="mut">→ legacy path kept; error now reads: </span><span class="warn">${esc(s5.error.message)}</span></pre>`;
}

// 3. Scenario matrix.
{
  const rows = [
    ['S1', 'nginx control: raw one-shot POST of the PNG (both daemons)', '413 from nginx, never forwarded, 0 files', byId('S1-base').pass && byId('S1-head').pass],
    ['S2', 'SDK upload + prompt through nginx', 'base 413 · PR create+4 chunks+complete, 1 file, model got the same bytes', byId('S2-base').pass && byId('S2-head').pass],
    ['S3', '51,590 B PNG (PR)', 'legacy single POST, no chunk routes touched', byId('S3-head').pass],
    ['S4', '512 KiB / 512 KiB+1 / 8 MiB / 8 MiB+1 (PR)', `1 legacy POST / 2 chunks (524288+1) / 16 chunks, byte-identical / RangeError before any request, raw create 413`, ['S4-512KiB', 'S4-512KiB+1', 'S4-8MiB', 'S4-8MiB+1'].every((i) => byId(i).pass)],
    ['S5', 'mixed versions: PR SDK→base daemon (nginx / direct), base SDK→PR daemon', '413 + proxy hint / legacy OK / legacy route still works', ['S5-headSDK-baseDaemon-nginx', 'S5-headSDK-baseDaemon-direct', 'S5-baseSDK-headDaemon-direct'].every((i) => byId(i).pass)],
    ['S6', 'daemon applied chunk 2 / last chunk / complete, response lost (nginx 502); 503 on chunk 3; 502 on complete', 'retried with the same upload ID; exactly 1 file, byte-identical, list = 1', ['S6-lost-chunk', 'S6-lost-last-chunk', 'S6-lost-complete', 'S6-503-chunk', 'S6-502-complete'].every((i) => byId(i).pass)],
    ['S10', 'same, without nginx: TCP reset after chunk 2 / after complete', 'TypeError path retried; exactly 1 file', ['S10-reset-chunk', 'S10-reset-complete'].every((i) => byId(i).pass)],
    ['S7', 'abort while chunk 3 is held by the gateway', 'DELETE 204, late chunk 404, 0 files, complete → 404', byId('S7-cancel').pass],
    ['S8', 'second attached client / anonymous caller on A\'s upload', 'append/complete 404; owner completes 200', byId('S8-ownership').pass],
    ['S11', 'capacity: 9th per session · 33rd daemon-wide · 128 MiB + 1 B', '429 attachment_upload_capacity_exceeded; freed by DELETE, by client detach (session stays open), by session close', ['S11a-session-cap', 'S11b-client-detach', 'S11c-global-cap-close', 'S11d-byte-cap'].every((i) => byId(i).pass)],
    ['S13', 'unfinished upload, wait 5 min 35 s', `resume → 404 attachment_upload_not_found; 8/8 slots free again`, exp[0].pass],
    ['W1', 'Web Shell paste + send through nginx (both arms)', 'base: toast 413 · PR: image in message + preview, model got it', web('head-paste').outcome === 'model-replied' && web('base-paste').outcome === 'error-visible'],
    ['W2', 'Web Shell: two screenshots, gateway 500 on every chunk of one', 'toast; completed one removed (DELETE /attachments 200), other cancelled (DELETE upload 204); 0 files, 0 model calls', web('head-multifail').files.length === 0 && web('head-multifail').modelCalls.length === 0],
    ['W3', 'Web Shell: send an image while a turn is running (queued)', 'uploaded in 4 chunks at dispatch; next model call carries the image (same sha256)', web('head-midturn').files.length === 1],
  ];
  const s12 = byId('S12-latency');
  cards['03-scenario-matrix'] = `
<h1>Scenario matrix — real <code>qwen serve</code> builds, real nginx, fault-injecting proxy, real Chromium</h1>
<p class="sub">PR head 1c62df93 vs merge-base b32f261a, both built with <code>npm run build &amp;&amp; npm run bundle</code>. Every "1 file" row is read from the session's attachment directory on disk, not from an API response.</p>
<table><tr><th>#</th><th>Scenario</th><th>Observed</th><th></th></tr>
${rows.map(([id, s, o, p]) => `<tr><td class="r">${id}</td><td>${esc(s)}</td><td>${esc(o)}</td><td class="r ${p ? 'ok' : 'bad'}">${p ? '✔ as expected' : '✘'}</td></tr>`).join('')}
</table>
<div class="note">Cost on loopback (no proxy), 8 MiB, 5 runs: legacy one-shot median <b>${s12.medianMs.legacy} ms</b> vs 16 chunks median <b>${s12.medianMs.chunked} ms</b>. Through the nginx rig the 8 MiB chunked transfer took 16.0 s, which is the Docker VM port forwarder, not chunking: a 512 KiB one-shot POST took 1.4 s on the same path (≈0.37 vs ≈0.52 MB/s).</div>`;
}

// 4. Web Shell failure cleanup + queued send.
{
  const m = web('head-multifail');
  const q = web('head-midturn');
  const led = m.faultProxy
    .filter((e) => !(e.m === 'GET'))
    .map((e) => `${e.m.padEnd(6)} ${e.p.replace(/\/session\/[0-9a-f]+/, '')}${e.q ?? ''}  ${e.status}${e.fault ? '  ← injected' : ''}`);
  const compact = [];
  for (const l of led) {
    const key = l.replace(/\?offset=\d+/, '?offset=…').replace(/\s+\d+$/, '');
    if (compact.length && compact.at(-1).key === key && /chunks/.test(l)) compact.at(-1).n++;
    else compact.push({ key, l, n: 1 });
  }
  cards['04-webshell-cleanup-queued'] = `
<h1>Web Shell paths the PR description lists as not manually tested</h1>
<p class="sub">PR head 1c62df93 through nginx. Left: two pasted screenshots in one message, the gateway answers 500 to every chunk of one of them. Right: an image sent while a turn is still running.</p>
<div class="row">
 <div class="col"><span class="tag warn">multi-file failure</span>
  ${crop('web-head-multifail.png', [520, 0, 2200, 1720], 0.293)}
  <pre style="margin-top:8px">${compact.map((c) => esc(c.n > 1 ? c.l.replace(/\?offset=\d+/, `?offset=… ×${c.n}`) : c.l)).join('\n')}
<span class="ok">attachment dir: ${m.files.length} files · model calls: ${m.modelCalls.length}</span></pre></div>
 <div class="col"><span class="tag ok">queued send</span>
  ${crop('web-head-midturn.png', [520, 0, 2200, 1720], 0.293)}
  <pre style="margin-top:8px">${q.faultProxy.filter((e) => e.m === 'POST').map((e) => esc(`${e.m} ${e.p.replace(/\/session\/[0-9a-f]+/, '')}${e.q ?? ''}  ${e.bytes} B  ${e.status}`)).join('\n')}
<span class="ok">model call 2: "${esc(q.modelCalls[1].lastUserText.trim())}"
  + 1 image ${q.modelCalls[1].images[0].bytes} B sha256 ${q.modelCalls[1].images[0].sha256}…</span>
<span class="mut">composer ghost text = prompt-suggestion side query answered by the fake model</span></pre></div>
</div>`;
}

// 5. Probe + mutants.
{
  const c = caps;
  const line = (r) => `${r.arm.padEnd(4)} ${r.fault.padEnd(9)} first upload: ${r.first.ok ? 'OK' : 'FAILED — ' + r.first.error.replace('DaemonAttachmentUploadError: ', '')}   next upload: ${r.secondUploadSameClient}`;
  cards['05-probe-mutants'] = `
<h1>Capability probe edge + do the PR's own tests pin the behaviour?</h1>
<p class="sub">Top: one gateway fault on <code>GET /capabilities</code> only (no body cap involved, 1,778,959 B PNG, SDK straight to the fault proxy). Bottom: single-point mutants of the PR code, each run against that package's tests; "killed" = at least one PR test fails, attributed by test name.</p>
<pre>${c.map((r) => (r.first.ok ? esc(line(r)) : `<span class="warn">${esc(line(r))}</span>`)).join('\n')}
<span class="mut">A 503 on a chunk or on complete is retried (S6); the same 503 on the probe fails the whole upload. base never probes.</span></pre>
<h2>Mutants: ${mut.filter((m) => m.killed).length} of ${mut.length} killed</h2>
<table><tr><th>#</th><th>Behaviour removed</th><th>Result</th><th>First failing PR test</th></tr>
${mut.map((m) => `<tr><td class="r">${m.id}</td><td>${esc(m.what)}</td><td class="r ${m.killed ? 'ok' : 'bad'}">${m.killed ? 'killed' : 'SURVIVED'}</td><td class="mut">${esc((m.failing[0] ?? '').replace(/^src\/[^ ]+ > |^test\/[^ ]+ > /, '').replace(/ \d+ms$/, '').slice(0, 110))}</td></tr>`).join('')}
</table>
<div class="note">M10 and M13 are killed by the two candidate tests in the comment (each passes on the PR head and fails on its mutant; the three acp-bridge files then run 1,089/1,089). M19 only changes the wording of the legacy 413 error.</div>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1464, height: 1000 }, deviceScaleFactor: 2 });
const only = process.argv[2];
for (const [name, body] of Object.entries(cards)) {
  if (only && !name.startsWith(only)) continue;
  const file = path.join(CARDS, `${name}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card">${body}</div></body></html>`);
  await page.goto('file://' + file);
  await page.waitForTimeout(300);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent.slice(0, 60)));
  await page.locator('#card').screenshot({ path: path.join(CARDS, `${name}.png`) });
  console.log(name, clipped.length ? `CLIPPED: ${JSON.stringify(clipped)}` : 'ok');
}
await browser.close();
