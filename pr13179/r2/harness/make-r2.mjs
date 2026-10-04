// VERIFICATION RIG ONLY (PR #13179 round 2): evidence figures.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13179-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out-r2`, HTML = `${RIG}/fig/html-r2`;
const J = (f) => JSON.parse(fs.readFileSync(`${RIG}/out/ui/${f}`, 'utf8'));
const C = { main: '#2a78d6', pr: '#eb6834', cand: '#1baf7a', prev: '#8a8984', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984', grid: '#e7e6e2', surf: '#fcfcfb', band: '#f1f0ec', crit: '#d03b3b', good: '#0a7d0a' };
const css = `body{margin:0;background:${C.surf};font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:${C.ink}}
.card{width:1180px;padding:28px 32px 24px;box-sizing:border-box;background:${C.surf}}
h1{font-size:20px;margin:0 0 4px;font-weight:650}.sub{color:${C.ink2};margin:0 0 16px;font-size:13.5px;max-width:1110px}
.legend{display:flex;gap:22px;align-items:center;color:${C.ink2};font-size:13px;margin:0 0 10px}.legend span{display:inline-flex;gap:7px;align-items:center}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.foot{color:${C.muted};font-size:12px;margin-top:12px}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid ${C.grid};vertical-align:top}th{color:${C.ink2};font-weight:600;font-size:12.5px}
.b{display:inline-flex;gap:6px;align-items:baseline;font-weight:600;font-size:13px}.d{display:block;color:${C.ink2};font-weight:400;font-size:12px;margin-top:2px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}`;
const page = (t, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title><style>${css}</style></head><body><div class="card">${body}</div></body></html>`;
const rows = (f) => Object.fromEntries(fs.readFileSync(`${RIG}/out/${f}`, 'utf8').split('\n').filter((l) => l.startsWith('ROW ')).map((l) => { const r = JSON.parse(l.slice(4)); return [r.arm, r]; }));

// ---- Fig 1: retire matrix ----
{
  const A = rows('u5a.console'), B = rows('u5b.console'), Cc = rows('u5c.console');
  const Ac = rows('u5a-cand.console'), Bc = rows('u5b-cand.console'), Cs = rows('u5c-shot.console');
  const ok = (t, d) => `<span class="b" style="color:${C.good}">✓ ${t}</span><span class="d">${d}</span>`;
  const bad = (t, d) => `<span class="b" style="color:${C.crit}">✕ ${t}</span><span class="d">${d}</span>`;
  const meh = (t, d) => `<span class="b" style="color:${C.ink2}">– ${t}</span><span class="d">${d}</span>`;
  const cellA = (r) => r.alertsAfterTurn2.length ? bad('red line never retires', `still up after new events; up ${r.bannerFirstS}–40 s+`) : r.bannerLastSeenS < 10 ? ok('retired by the next good poll', `visible ${r.bannerFirstS}–${r.bannerLastSeenS} s`) : meh('stays until the next event', `visible ${r.bannerFirstS}–${r.bannerLastSeenS} s, gone once turn 2 streamed`);
  const cellB = (r) => r.transcriptRenderedAtS === null ? bad('never loads', `0 streams opened; turn 2 never shown`) : ok(`loads at ${r.transcriptRenderedAtS} s`, `stream opened; turn 2 shown live`);
  const cellC = (r) => !r.turn2Rendered ? bad('stream loop dead', 'turn 2 never shown; red line stays') : r.alertsAfterTurn2.length ? bad('red line stays over a live stream', 'turn 2 streamed in under it') : meh('cleared by the first new event', 'turn 2 streamed, red line gone');
  const T = (label, desc, cells) => `<tr><td style="width:28%"><b>${label}</b><span class="d">${desc}</span></td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const body = `<h1>One definite 404, then the server is healthy again: what each build does</h1>
<p class="sub">Real Spring + Harness, all arms watching the same Session at the same time; each arm's proxy answers exactly one request with the server's own <span class="mono">404 session_not_found</span> envelope. (a) and (b) are the two R7 Critical shapes; (c) is the stream-side sibling the new commit introduces.</p>
<table><tr><th></th><th>main <span class="mono">2c591ecc08</span></th><th>previous head <span class="mono">07a9756</span></th><th>new head <span class="mono">e826f590</span></th><th>new head + candidate</th></tr>
${T('(a) a summary poll gets the 404', 'stream live, later polls succeed', [cellA(A.base), cellA(A.prev), cellA(A.head), cellA(Ac.cand)])}
${T('(b) the bootstrap\'s session read gets the 404', 'later reads succeed', [cellB(B.base), cellB(B.prev), cellB(B.head), cellB(Bc.cand)])}
${T('(c) a stream reconnect gets the 404', 'the next connection is healthy and delivers turn 2', [cellC(Cc.base), cellC(Cc.prev), cellC(Cs.head), cellC(Cs.cand)])}
</table>
<p class="foot">(c) ran three times on the new head (3-arm, 3-arm with candidate, and again for the screenshots): the red line stayed over live content every time. Candidate = the stream answers for its own leg (<span class="mono">'stream'</span>) and the first new event of a later connection retires it; (a) and (b) unchanged. Raw: u5a/u5b/u5c*.console.</p>`;
  fs.writeFileSync(`${HTML}/01-retire-matrix.html`, page('Retire matrix', body));
}
// ---- Fig 2: screenshots for (c) ----
{
  const img = (f) => `data:image/png;base64,${fs.readFileSync(`${RIG}/fig/raw/${f}`).toString('base64')}`;
  const cell = (f, name, c, txt) => `<div style="flex:1"><div style="font-weight:600;margin-bottom:6px"><i class="sw" style="background:${c};margin-right:7px"></i>${name}</div><div style="border:1px solid ${C.grid};border-radius:8px;overflow:hidden;height:330px;background:#fff"><img src="${img(f)}" style="width:200%;display:block"></div><div style="color:${C.ink2};font-size:12.5px;margin-top:6px">${txt}</div></div>`;
  fs.writeFileSync(`${HTML}/02-stream-leg-panels.html`, page('Panels', `<h1>Shape (c), 6 s after turn 2 streamed in: the same moment in three builds</h1>
<p class="sub">One stream reconnect got a definite 404 ~40 s earlier; every reconnect since succeeded and turn 2 (<span class="mono">[RTCN-…]</span>) streamed in live on all three. The red line is the proxy's message for the injected 404 (the real server's text would be "The Session was not found.").</p>
<div style="display:flex;gap:16px">${cell('u5c-base-after-turn2.png', 'main', C.main, 'red line gone with the first new event')}${cell('u5c-head-after-turn2.png', 'new head e826f590', C.pr, 'red line stays over the live turn; only a gap resync, an older-page load or Refresh clears it')}${cell('u5c-cand-after-turn2.png', 'new head + candidate', C.cand, 'red line gone with the first new event')}</div>`));
}
// ---- Fig 3: deleted session timeline ----
{
  const d = J('u2-net.json'); const u2 = J('u2-deleted.json');
  const k = d.tDel, W = 1116, left = 112, right = 230, rowH = 30, pw = W - left - right, x0 = -10, x1 = 242;
  const X = (s) => left + ((s - x0) / (x1 - x0)) * pw;
  const lanes = [];
  for (const arm of ['base', 'prev', 'head']) d.pages.filter((p) => p.arm === arm).forEach((p, i) => {
    const r = u2.rows.find((x) => x.arm === arm && x.i === p.i);
    lanes.push({ label: `${{ base: 'main', prev: 'prev head', head: 'new head' }[arm]} ${i + 1}`, color: { base: C.main, prev: C.prev, head: C.pr }[arm], net: p.net, note: `${r.requests} req: ${r.byPath['/events/stream'] ?? 0} stream + ${r.byPath['/sessions/get'] ?? 0} summary` });
  });
  const H = lanes.length * rowH + 44;
  let g = '';
  for (const t of [0, 60, 120, 180, 240]) g += `<line x1="${X(t)}" x2="${X(t)}" y1="8" y2="${H - 28}" stroke="${C.grid}"/><text x="${X(t)}" y="${H - 12}" fill="${C.ink2}" font-size="12" text-anchor="middle">${t} s</text>`;
  g += `<line x1="${X(0)}" x2="${X(0)}" y1="8" y2="${H - 28}" stroke="${C.ink2}" stroke-dasharray="3 3"/><text x="${X(0) + 5}" y="20" fill="${C.ink2}" font-size="12">Session deleted (both reads now 404)</text>`;
  lanes.forEach((l, i) => {
    const y = 40 + i * rowH;
    g += `<text x="${left - 12}" y="${y + 4}" font-size="12.5" text-anchor="end">${l.label}</text><line x1="${left}" x2="${left + pw}" y1="${y}" y2="${y}" stroke="${C.grid}"/>`;
    for (const e of l.net) {
      if (e.path !== '/events/stream' && e.path !== '/sessions/get') continue;
      const s = (e.t - k) / 1000; if (s < x0 || s > x1) continue;
      const okk = e.status >= 200 && e.status < 300, st = e.path === '/events/stream';
      g += st ? (okk ? `<rect x="${X(s) - 4}" y="${y - 4}" width="8" height="8" fill="${l.color}"/>` : `<rect x="${X(s) - 3.6}" y="${y - 3.6}" width="7.2" height="7.2" fill="${C.surf}" stroke="${l.color}" stroke-width="1.8"/>`)
              : (okk ? `<circle cx="${X(s)}" cy="${y}" r="4.2" fill="${l.color}"/>` : `<circle cx="${X(s)}" cy="${y}" r="3.6" fill="${C.surf}" stroke="${l.color}" stroke-width="1.8"/>`);
    }
    g += `<text x="${left + pw + 14}" y="${y + 4}" font-size="12.5">${l.note}</text>`;
  });
  fs.writeFileSync(`${HTML}/03-deleted-r2.html`, page('Deleted r2', `<h1>Watched Session closed and deleted: 240 s afterwards, three builds</h1>
<p class="sub">Real <span class="mono">sessions/close → sessions/delete</span>; both reads answer 404 from then on. The previous head stopped its stream after the first 404; the new head records the 404 and keeps re-subscribing on the 3–30 s ladder, so a deleted Session now costs two laddered loops per open panel instead of one — still −79 % against main.</p>
<div class="legend"><span><i class="sw" style="background:${C.main}"></i>main</span><span><i class="sw" style="background:${C.prev}"></i>previous head 07a9756</span><span><i class="sw" style="background:${C.pr}"></i>new head e826f590</span><span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" fill="none" stroke="${C.ink2}" stroke-width="1.8"/></svg>events/stream</span><span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="none" stroke="${C.ink2}" stroke-width="1.8"/></svg>sessions/get</span><span>hollow = 404</span></div>
<svg width="${W}" height="${H}">${g}</svg><p class="foot">Raw: u2-deleted.json / u2-net.json (round 2).</p>`));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(HTML).filter((x) => x.endsWith('.html')).sort()) {
  const p = await ctx.newPage(); await p.goto(`file://${HTML}/${f}`); await p.locator('.card').screenshot({ path: `${OUT}/${f.replace('.html', '.png')}` }); console.log('rendered', f); await p.close();
}
await browser.close();
