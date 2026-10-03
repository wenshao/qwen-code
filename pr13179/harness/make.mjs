// VERIFICATION RIG ONLY (PR #13179): evidence figures as HTML cards rendered by Playwright.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13179-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out`; fs.mkdirSync(OUT, { recursive: true });
const J = (f) => JSON.parse(fs.readFileSync(`${RIG}/out/ui/${f}`, 'utf8'));
const C = { main: '#2a78d6', pr: '#eb6834', cand: '#1baf7a', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984', grid: '#e7e6e2', surf: '#fcfcfb', band: '#f1f0ec', crit: '#d03b3b', good: '#0ca30c', warn: '#fab219' };
const css = `body{margin:0;background:${C.surf};font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:${C.ink}}
.card{width:1180px;padding:28px 32px 24px;box-sizing:border-box;background:${C.surf}}
h1{font-size:20px;margin:0 0 4px;font-weight:650}.sub{color:${C.ink2};margin:0 0 16px;font-size:13.5px;max-width:1100px}
.legend{display:flex;gap:22px;align-items:center;color:${C.ink2};font-size:13px;margin:0 0 10px}.legend span{display:inline-flex;gap:7px;align-items:center}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.foot{color:${C.muted};font-size:12px;margin-top:12px}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{padding:7px 10px;text-align:left;border-bottom:1px solid ${C.grid};vertical-align:top}th{color:${C.ink2};font-weight:600;font-size:12.5px}
.b{display:inline-flex;gap:6px;align-items:center;font-weight:600;font-size:12.5px;white-space:nowrap}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}`;
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body><div class="card">${body}</div></body></html>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------- timeline helper ----------
function timeline({ rows, x0, x1, bands = [], marks = [], width = 1116, rowH = 30, left = 96, right = 250, ticks }) {
  const W = width, H = rows.length * rowH + 40, pw = W - left - right;
  const X = (s) => left + ((s - x0) / (x1 - x0)) * pw;
  let g = '';
  for (const t of ticks) g += `<line x1="${X(t)}" x2="${X(t)}" y1="8" y2="${H - 28}" stroke="${C.grid}"/><text x="${X(t)}" y="${H - 12}" fill="${C.ink2}" font-size="12" text-anchor="middle">${t} s</text>`;
  for (const b of bands) g += `<rect x="${X(b.from)}" y="8" width="${X(b.to) - X(b.from)}" height="${H - 36}" fill="${C.band}"/><text x="${(X(b.from) + X(b.to)) / 2}" y="22" fill="${C.ink2}" font-size="12" text-anchor="middle">${b.label}</text>`;
  for (const m of marks) g += `<line x1="${X(m.at)}" x2="${X(m.at)}" y1="8" y2="${H - 28}" stroke="${C.ink2}" stroke-dasharray="3 3"/><text x="${X(m.at) + 5}" y="22" fill="${C.ink2}" font-size="12">${m.label}</text>`;
  rows.forEach((r, i) => {
    const y = 36 + i * rowH;
    g += `<text x="${left - 12}" y="${y + 4}" fill="${C.ink}" font-size="12.5" text-anchor="end">${r.label}</text>`;
    g += `<line x1="${left}" x2="${left + pw}" y1="${y}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`;
    for (const d of r.dots) {
      if (d.s < x0 || d.s > x1) continue;
      g += d.ok ? `<circle cx="${X(d.s)}" cy="${y}" r="4.2" fill="${r.color}" stroke="${C.surf}" stroke-width="1.5"/>` : `<circle cx="${X(d.s)}" cy="${y}" r="3.6" fill="${C.surf}" stroke="${r.color}" stroke-width="1.8"/>`;
    }
    g += `<text x="${left + pw + 14}" y="${y + 4}" fill="${C.ink}" font-size="12.5">${r.note}</text>`;
  });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${g}</svg>`;
}
const legendArms = (arms) => `<div class="legend">${arms.map(([n, c]) => `<span><i class="sw" style="background:${c}"></i>${n}</span>`).join('')}<span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="${C.ink2}"/></svg>answered 2xx</span><span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="${C.surf}" stroke="${C.ink2}" stroke-width="1.8"/></svg>failed (5xx / 4xx)</span></div>`;

// ---------- Fig 1: real outage ----------
{
  const d = J('u1-net.json'); const u1 = J('u1-outage.json');
  const k = d.tKill, up = (d.tUp - k) / 1000;
  const rows = [];
  for (const arm of ['base', 'head']) d.pages.filter((p) => p.arm === arm).forEach((p, i) => {
    const row = u1.rows.find((x) => x.arm === arm && x.i === p.i);
    rows.push({ label: `${arm === 'base' ? 'main' : 'PR'} panel ${i + 1}`, color: arm === 'base' ? C.main : C.pr,
      dots: p.net.filter((e) => e.path === '/events/stream' || e.path === '/sessions/get').map((e) => ({ s: (e.t - k) / 1000, ok: e.status >= 200 && e.status < 300 })),
      note: `${row.outageRequests} req while down · stream back +${row.streamBackS.toFixed(1)} s` });
  });
  const svg = timeline({ rows, x0: -12, x1: 272, ticks: [0, 60, 120, 180, 240], bands: [{ from: 0, to: up, label: `stop issued at 0 s (process gone at +${((d.tDown - k) / 1000).toFixed(0)} s) → restarted` }], marks: [{ at: up, label: `answering at +${up.toFixed(0)} s` }] });
  fs.writeFileSync(`${RIG}/fig/html/01-outage.html`, page('Outage timeline', `<h1>Real server outage: what 4 open Managed panels per arm send</h1>
<p class="sub">The Java server (Spring + embedded Runtime Broker) was stopped for real and restarted. Each dot is one <span class="mono">sessions/get</span> or <span class="mono">events/stream</span> request recorded in the browser. main retries every 3 s throughout; the PR backs off to a jittered 3–30 s ladder (−78% requests) and pays for it with a 10.6–27 s reconnect after recovery instead of &lt;3 s.</p>
${legendArms([['main 5ddfacc9d4', C.main], ['PR ⊕ main (trial merge)', C.pr]])}${svg}
<p class="foot">Rig: real Spring fat jar + packaged Hosted Harness + MySQL 8.4, two vite arms each behind its own recording wire (the wire answers 502 while nothing listens, like an ingress). Raw: u1-outage.json / u1-net.json.</p>`));
}
// ---------- Fig 2: deleted session + 401 ----------
{
  const d = J('u2-net.json'); const u2 = J('u2-deleted.json');
  const k = d.tDel; const rows = [];
  for (const arm of ['base', 'head']) d.pages.filter((p) => p.arm === arm).forEach((p, i) => {
    const row = u2.rows.find((x) => x.arm === arm && x.i === p.i);
    const by = row.byPath;
    rows.push({ label: `${arm === 'base' ? 'main' : 'PR'} panel ${i + 1}`, color: arm === 'base' ? C.main : C.pr,
      dots: p.net.filter((e) => e.path === '/events/stream' || e.path === '/sessions/get').map((e) => ({ s: (e.t - k) / 1000, ok: e.status >= 200 && e.status < 300 })),
      note: `${row.requests} req: ${by['/events/stream'] ?? 0} stream + ${by['/sessions/get'] ?? 0} summary` });
  });
  const svg = timeline({ rows, x0: -10, x1: 242, ticks: [0, 60, 120, 180, 240], marks: [{ at: 0, label: 'Session deleted (both reads now 404)' }] });
  fs.writeFileSync(`${RIG}/fig/html/02-deleted.html`, page('Deleted session', `<h1>The watched Session is closed and deleted elsewhere: 240 s afterwards</h1>
<p class="sub">A real <span class="mono">sessions/close</span> → <span class="mono">sessions/delete</span> through the adapter; both reads answer <span class="mono">404 session_not_found</span> from then on. main keeps a 3 s cadence on both endpoints (40 req/min per panel). On the PR the stream loop stops after its first 404, but the summary poller keeps polling on its jittered ladder (≈4.5 req/min, gaps 3.8–29.8 s) for as long as the panel is open — a large reduction, not the "hard stop" the PR description promises.</p>
${legendArms([['main', C.main], ['PR ⊕ main', C.pr]])}${svg}
<p class="foot">Both arms show the same banner "The Session was not found." (figure 6). Raw: u2-deleted.json / u2-net.json.</p>`));
}
// ---------- Fig 3: bootstrap race ----------
{
  const head = [...J('u3-unknown-run1.json').rows, ...J('u3-unknown-run2.json').rows, ...J('u3-unknown.json').rows].filter((r) => r.arm === 'head').map((r) => r.bootstrapAttempts);
  const cand = J('u3-unknown.json').rows.filter((r) => r.arm === 'cand').map((r) => r.bootstrapAttempts);
  const main = J('u3-unknown-run1.json').rows.filter((r) => r.arm === 'base').map((r) => r.bootstrapAttempts);
  const bins = [1, 2, 3, 4, 5, 6, 7, 8];
  const hist = (a) => bins.map((b) => a.filter((x) => x === b).length);
  const chart = (name, color, a, n) => {
    const h = hist(a), W = 520, H = 230, L = 46, B = 196, bw = 44, gap = 12, max = 30;
    let g = '';
    for (const t of [0, 10, 20, 30]) { const y = B - (t / max) * 160; g += `<line x1="${L}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="${C.grid}"/><text x="${L - 8}" y="${y + 4}" font-size="11.5" fill="${C.ink2}" text-anchor="end">${t}</text>`; }
    h.forEach((v, i) => { const x = L + 10 + i * (bw + gap), hh = (v / max) * 160; if (v) g += `<path d="M${x},${B} v${-hh + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${hh - 4} z" fill="${color}"/><text x="${x + bw / 2}" y="${B - hh - 6}" font-size="12" text-anchor="middle" fill="${C.ink}">${v}</text>`; g += `<text x="${x + bw / 2}" y="${B + 17}" font-size="12" text-anchor="middle" fill="${C.ink2}">${i + 1}</text>`; });
    g += `<text x="${L + 10}" y="${H - 2}" font-size="12" fill="${C.ink2}">bootstrap attempts seen in the watch window</text>`;
    return `<div><div style="font-weight:600;margin:0 0 4px">${name} <span style="color:${C.ink2};font-weight:400">— ${n} pages, ${a.filter((x) => x === 1).length}/${n} stopped at the first</span></div><svg width="${W}" height="${H}">${g}</svg></div>`;
  };
  fs.writeFileSync(`${RIG}/fig/html/03-bootstrap-race.html`, page('Bootstrap race', `<h1>Opening a Session id the server does not know: does the bootstrap stop?</h1>
<p class="sub">Both snapshot legs (<span class="mono">sessions/get</span> and <span class="mono">transcript/query</span>) answer 404 within a few ms of each other. The PR tags only the transcript leg's rejection and races the two in <span class="mono">Promise.all</span>, so whichever 404 reaches the hook first decides: a session-leg win stops the loop, a transcript-leg win keeps it retrying on the ladder. main never stops (${Math.min(...main)}–${Math.max(...main)} attempts in 120 s, every 3 s). Candidate = <span class="mono">Promise.allSettled</span>, session leg decides.</p>
<div style="display:flex;gap:40px">${chart('PR ⊕ main', C.pr, head, head.length)}${chart('PR + candidate fix', C.cand, cand, cand.length)}</div>
<p class="foot">Three batches (10 + 20 + 15 pages, 90–120 s each); the last batch ran PR and candidate side by side on the same server. Every multi-attempt page whose request log was kept (batches 1 and 3) did stop inside the window — the longest after 8 attempts / 71 s; batch 2 kept counts only. The banner and the stopped stream are identical once the loop stops; the cost of a lost race is extra bootstrap requests, not a wrong UI. Raw: u3-unknown-run1.json / -run2.json / u3-unknown.json.</p>`));
}
// ---------- Fig 4: containment matrix ----------
{
  const rows = {};
  for (const l of ['final-pr-normal', 'final-main-normal', 'final-main-bypass', 'final-pr-bypass'])
    for (const line of fs.readFileSync(`${RIG}/out/matrix-${l}.console`, 'utf8').split('\n').filter((x) => x.startsWith('ROW '))) { const r = JSON.parse(line.slice(4)); rows[`${l}:${r.vector}`] = r; }
  const verdict = (r) => {
    const t = (r.results ?? []).join(' ');
    if (r.secretReachedModel) return ['crit', '✕ outside content returned to the model'];
    if (r.outsideFile) return ['crit', '✕ written outside'];
    if (/not within any of the registered workspace/.test(t)) return ['good', '✓ rejected by the new worker check'];
    if (/Hosted file tools require file_path relative/.test(t) && !/Successfully|inside-a/.test(t)) return ['neutral', '✓ rejected by the Harness'];
    if (/Hosted file history refused/.test(t) && !/Successfully/.test(t)) return ['neutral', '✓ refused by file history'];
    if (/Hosted file history refused/.test(t)) return ['neutral', '✓ 1st write inside; later writes refused by file history'];
    if (r.insideFile) return ['neutral', '✓ written inside (expected)'];
    return ['neutral', esc(t.slice(0, 60))];
  };
  const badge = ([k, s]) => `<span class="b" style="color:${k === 'crit' ? C.crit : k === 'good' ? '#0a7d0a' : C.ink2}">${s}</span>`;
  const V = [
    ['normal', 'w1-write-dotdot', 'write_file ../../escape-w1.txt'], ['normal', 'w1-read-dotdot', 'read_file ../../secret.txt'], ['normal', 'w1-absolute', 'write_file /…/ws/escape-abs.txt'], ['normal', 'w1-inside-child', 'write_file inside-child.txt'],
    ['normal', 'w2-symlink', 'write_file lnk2/escape-w2.txt (lnk2 → outside, already in the Workspace)'], ['normal', 'w2-symlink-read', 'read_file lnk2/outside-secret.txt (same link)'],
    ['normal', 'w3-stale-cache', 'write lnk3/a.txt; another process swaps lnk3 for a link; write again'], ['normal', 'w3-stale-cache-read', 'read lnk4/a.txt; lnk4 swapped for a link; read again'],
    ['bypass', 'w1-write-dotdot', 'write_file ../../escape-w1.txt'], ['bypass', 'w1-read-dotdot', 'read_file ../../secret.txt'], ['bypass', 'w1-edit-dotdot', 'edit ../../victim.txt'], ['bypass', 'w1-absolute', 'write_file /…/ws/escape-abs.txt'], ['bypass', 'w1-inside-parent', 'write_file ../inside-parent.txt (inside the root, above cwd)'], ['bypass', 'w1-inside-child', 'write_file inside-child.txt'],
  ];
  let tr = '';
  let last;
  for (const [h, v, desc] of V) {
    if (h !== last) { tr += `<tr><th colspan="3" style="padding-top:14px;color:${C.ink}">${h === 'normal' ? 'Unmodified Harness (what production runs)' : 'Harness file_path normalization bypassed (a Harness-layer gap; this is the case the PR describes)'}</th></tr>`; last = h; }
    const m = rows[`final-main-${h}:${v}`], p = rows[`final-pr-${h}:${v}`];
    tr += `<tr><td class="mono">${esc(desc)}</td><td>${badge(verdict(m))}</td><td>${badge(verdict(p))}</td></tr>`;
  }
  fs.writeFileSync(`${RIG}/fig/html/04-containment.html`, page('Worker containment', `<h1>Worker containment on the real Hosted path: main worker vs PR worker</h1>
<p class="sub">Spring + embedded Runtime Broker spawning the packaged <span class="mono">managed-runtime-worker</span> from each tree; packaged Hosted Harness; the scripted model issues the tool call; Session cwd = <span class="mono">&lt;root&gt;/child</span>. Verdict = what the model received plus the host filesystem. Only the worker differs between the two columns.</p>
<table><tr><th style="width:52%">tool call</th><th>main worker</th><th>PR worker</th></tr>${tr}</table>
<p class="foot">Writes never reach the worker unchecked on this profile: the Harness or Hosted file history refuses them on both arms. Reads bypass file history, so the PR's check is their only guard — and the PR's unit test covers write_file only (a mutant exempting read_file passes all 890 tests). Raw: matrix-final-*.console.</p>`));
}
// ---------- Fig 5: perf ----------
{
  const rows = J('u6-perf.json').rows;
  const pts = (arm) => rows.filter((r) => r.arm === arm).map((r) => [r.historyEvents, r.taskS]);
  const W = 640, H = 300, L = 54, R = 120, T = 20, B = 250;
  const X = (v) => L + ((v - 0) / 13000) * (W - L - R), Y = (v) => B - (v / 5) * (B - T);
  let g = '';
  for (const t of [0, 1, 2, 3, 4, 5]) g += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/><text x="${L - 8}" y="${Y(t) + 4}" font-size="12" fill="${C.ink2}" text-anchor="end">${t} s</text>`;
  for (const t of [3000, 6000, 9000, 12000]) g += `<text x="${X(t)}" y="${B + 18}" font-size="12" fill="${C.ink2}" text-anchor="middle">${t / 1000}k</text>`;
  g += `<text x="${(L + W - R) / 2}" y="${H - 6}" font-size="12" fill="${C.ink2}" text-anchor="middle">events in the transcript when the 3000-delta turn ended</text>`;
  for (const [arm, c, name] of [['base', C.main, 'main'], ['head', C.pr, 'PR']]) {
    const p = pts(arm);
    g += `<polyline points="${p.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>`;
    for (const [x, y] of p) g += `<circle cx="${X(x)}" cy="${Y(y)}" r="4.5" fill="${c}" stroke="${C.surf}" stroke-width="2"/><text x="${X(x)}" y="${Y(y) + (arm === 'base' ? -10 : 18)}" font-size="11.5" fill="${C.ink}" text-anchor="middle">${y.toFixed(2)}</text>`;
    const [lx, ly] = p.at(-1);
    g += `<text x="${X(lx) + 12}" y="${Y(ly) + 4}" font-size="12.5" fill="${C.ink}" font-weight="600">${name}</text>`;
  }
  const mb = Object.fromEntries(fs.readFileSync(`${RIG}/out/merge-bench.log`, 'utf8').split('\n').filter((l) => l.startsWith('RESULT')).map((l) => { const m = /n=(\d+) (.*)/.exec(l); return [m[1], JSON.parse(m[2])]; }));
  const tb = Object.entries(mb).map(([n, v]) => `<tr><td>${Number(n).toLocaleString('en')}</td><td>${v.mergeMsBase.toFixed(0)} ms</td><td>${v.mergeMsPR.toFixed(1)} ms</td><td>${v.lastDeltaMergeUsPR.toFixed(1)} µs</td><td>${v.lastDeltaProjUs.toFixed(0)} µs</td></tr>`).join('');
  fs.writeFileSync(`${RIG}/fig/html/05-perf.html`, page('Merge perf', `<h1>Streamed-delta cost: main-thread time per 3000-delta turn as the transcript grows</h1>
<p class="sub">Both arms watched one Session while four 3000-delta turns streamed through the real Harness and Java server (CDP <span class="mono">TaskDuration</span> per turn, per page). main grows with history (Map rebuild + sort per delta); the PR does not grow with it. Both arms rendered every chunk within 0.1 s of the server finishing the turn — the page was never the bottleneck at this rate.</p>
<div style="display:flex;gap:28px;align-items:flex-start"><svg width="${W}" height="${H}">${g}</svg>
<div style="flex:1"><div style="font-weight:600;margin:6px 0 6px">Node 24 micro-benchmark (same two modules)</div><table><tr><th>events</th><th>all merges, main</th><th>all merges, PR</th><th>PR last delta</th><th>re-projection / delta*</th></tr>${tb}</table>
<p class="foot" style="margin-top:8px">Outputs identical id-for-id. The PR's append still copies the array (O(n) per delta, 0.9 → 7.6 µs), not amortised O(1). *<span class="mono">managedEventsToMessages</span>, which the page re-runs over the whole transcript on every event in both arms, is now the dominant per-delta cost.</p></div></div>
<p class="foot">Raw: u6-perf.json (3000×4), u6-perf-run1.json (2000×3: 3.06/2.93/2.16 s main vs 2.86/2.72/1.61 s PR), merge-bench.log.</p>`));
}
// ---------- Fig 6: real panel screenshots ----------
{
  const img = (f) => `data:image/png;base64,${fs.readFileSync(`${RIG}/fig/raw/${f}`).toString('base64')}`;
  const u2 = J('u2-deleted.json');
  const cell = (f, name, c, txt) => `<div style="flex:1"><div style="font-weight:600;margin-bottom:6px"><i class="sw" style="background:${c};margin-right:7px"></i>${name}</div><div style="border:1px solid ${C.grid};border-radius:8px;overflow:hidden;height:330px;background:#fff"><img src="${img(f)}" style="width:100%;display:block"></div><div style="color:${C.ink2};font-size:13px;margin-top:6px">${txt}</div></div>`;
  const reqs = (arm) => u2.rows.filter((r) => r.arm === arm).map((r) => r.requests).join(' / ');
  fs.writeFileSync(`${RIG}/fig/html/06-panels.html`, page('Panels', `<h1>The real panel 60 s after its Session was deleted — main vs PR</h1>
<p class="sub">Same Session, same server bytes, screenshots at the same moment. What the user sees is identical (the banner, and a stale "Completed · Environment: Ready" header because no summary read ever succeeds again); the difference is entirely on the wire.</p>
<div style="display:flex;gap:24px">${cell('u2-base-60s.png', 'main', C.main, `${reqs('base')} requests per panel in 240 s after the delete`)}${cell('u2-head-60s.png', 'PR ⊕ main', C.pr, `${reqs('head')} requests per panel in 240 s after the delete`)}</div>`));
}
// ---------- render ----------
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(`${RIG}/fig/html`).filter((x) => x.endsWith('.html')).sort()) {
  const p = await ctx.newPage();
  await p.goto(`file://${RIG}/fig/html/${f}`);
  await p.locator('.card').screenshot({ path: `${OUT}/${f.replace('.html', '.png')}` });
  console.log('rendered', f);
  await p.close();
}
await browser.close();
