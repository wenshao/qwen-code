// VERIFICATION RIG ONLY (PR #13179 round 2): evidence figures.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13179-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out-r3`, HTML = `${RIG}/fig/html-r3`; fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(HTML, { recursive: true });
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
  const A = rows('u5a-r3.console'), B = rows('u5b-r3.console'), Cs = rows('u5c-r3.console');
  const ok = (t, d) => `<span class="b" style="color:${C.good}">✓ ${t}</span><span class="d">${d}</span>`;
  const bad = (t, d) => `<span class="b" style="color:${C.crit}">✕ ${t}</span><span class="d">${d}</span>`;
  const meh = (t, d) => `<span class="b" style="color:${C.ink2}">– ${t}</span><span class="d">${d}</span>`;
  const cellA = (r) => r.alertsAfterTurn2.length ? bad('red line never retires', `still up after new events; up ${r.bannerFirstS}–40 s+`) : r.bannerLastSeenS < 10 ? ok('retired by the next good poll', `visible ${r.bannerFirstS}–${r.bannerLastSeenS} s`) : meh('stays until the next event', `visible ${r.bannerFirstS}–${r.bannerLastSeenS} s, gone once turn 2 streamed`);
  const cellB = (r) => r.transcriptRenderedAtS === null ? bad('never loads', `0 streams opened; turn 2 never shown`) : ok(`loads at ${r.transcriptRenderedAtS} s`, `stream opened; turn 2 shown live`);
  const cellC = (r) => !r.turn2Rendered ? bad('stream loop dead', 'turn 2 never shown; red line stays') : r.alertsAfterTurn2.length ? bad('red line stays over a live stream', 'turn 2 streamed in under it') : meh('cleared by the first new event', 'turn 2 streamed, red line gone');
  const T = (label, desc, cells) => `<tr><td style="width:28%"><b>${label}</b><span class="d">${desc}</span></td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const body = `<h1>Re-run on main 6136786c0c: one definite 404, then the server is healthy again</h1>
<p class="sub">Real Spring + Harness, all arms watching the same Session at the same time; each arm's proxy answers exactly one request with the server's own <span class="mono">404 session_not_found</span> envelope. (a) and (b) are the two R7 Critical shapes; (c) is the stream-side sibling the new commit introduces. Rebuilt on main <span class="mono">6136786c0c</span> (Druid pool, #13351/#13365 replay changes).</p>
<table><tr><th></th><th>main <span class="mono">6136786c0c</span></th><th>head <span class="mono">e826f590</span> ⊕ main</th><th>head + candidate</th></tr>
${T('(a) a summary poll gets the 404', 'stream live, later polls succeed', [cellA(A.base), cellA(A.head), cellA(A.cand)])}
${T('(b) the bootstrap\'s session read gets the 404', 'later reads succeed', [cellB(B.base), cellB(B.head), cellB(B.cand)])}
${T('(c) a stream reconnect gets the 404', 'the next connection is healthy and delivers turn 2', [cellC(Cs.base), cellC(Cs.head), cellC(Cs.cand)])}
</table>
<p class="foot">(c) on the new head: red line over live content in 4/4 runs across rounds 2 and 3. The previous head <span class="mono">07a9756</span> column is in the round-2 figure. Candidate = the stream answers for its own leg (<span class="mono">'stream'</span>) and the first new event of a later connection retires it; (a) and (b) unchanged. Raw: u5a/u5b/u5c*.console.</p>`;
  fs.writeFileSync(`${HTML}/01-retire-matrix.html`, page('Retire matrix', body));
}
// ---- Fig 2: screenshots for (c) ----
{
  const img = (f) => `data:image/png;base64,${fs.readFileSync(`${RIG}/fig/raw/${f}`).toString('base64')}`;
  const cell = (f, name, c, txt) => `<div style="flex:1"><div style="font-weight:600;margin-bottom:6px"><i class="sw" style="background:${c};margin-right:7px"></i>${name}</div><div style="border:1px solid ${C.grid};border-radius:8px;overflow:hidden;height:330px;background:#fff"><img src="${img(f)}" style="width:200%;display:block"></div><div style="color:${C.ink2};font-size:12.5px;margin-top:6px">${txt}</div></div>`;
  fs.writeFileSync(`${HTML}/02-stream-leg-panels.html`, page('Panels', `<h1>Shape (c) on main 6136786c0c, 6 s after turn 2 streamed in: the same moment in three builds</h1>
<p class="sub">One stream reconnect got a definite 404 ~40 s earlier; every reconnect since succeeded and turn 2 (<span class="mono">[RTCN-…]</span>) streamed in live on all three. The red line is the proxy's message for the injected 404 (the real server's text would be "The Session was not found.").</p>
<div style="display:flex;gap:16px">${cell('u5c-base-after-turn2.png', 'main', C.main, 'red line gone with the first new event')}${cell('u5c-head-after-turn2.png', 'new head e826f590', C.pr, 'red line stays over the live turn; only a gap resync, an older-page load or Refresh clears it')}${cell('u5c-cand-after-turn2.png', 'new head + candidate', C.cand, 'red line gone with the first new event')}</div>`));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(HTML).filter((x) => x.endsWith('.html')).sort()) {
  const p = await ctx.newPage(); await p.goto(`file://${HTML}/${f}`); await p.locator('.card').screenshot({ path: `${OUT}/${f.replace('.html', '.png')}` }); console.log('rendered', f); await p.close();
}
await browser.close();
