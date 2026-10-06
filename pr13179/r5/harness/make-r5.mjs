// VERIFICATION RIG ONLY (PR #13179 round 5): evidence figures.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13179-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out-r5`, HTML = `${RIG}/fig/html-r5`;
const C = { main: '#2a78d6', pr: '#eb6834', cand: '#1baf7a', prev: '#8a8984', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984', grid: '#e7e6e2', surf: '#fcfcfb', band: '#f1f0ec', crit: '#d03b3b', good: '#0a7d0a' };
const css = `body{margin:0;background:${C.surf};font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:${C.ink}}
.card{width:1180px;padding:28px 32px 24px;box-sizing:border-box;background:${C.surf}}
h1{font-size:20px;margin:0 0 4px;font-weight:650}.sub{color:${C.ink2};margin:0 0 14px;font-size:13.5px;max-width:1110px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.foot{color:${C.muted};font-size:12px;margin-top:12px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 9px;text-align:left;border-bottom:1px solid ${C.grid};vertical-align:top}th{color:${C.ink2};font-weight:600;font-size:12.5px}
.b{font-weight:600;font-size:12.5px}.d{display:block;color:${C.ink2};font-weight:400;font-size:11.5px;margin-top:2px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f4f3ef;border:1px solid ${C.grid};border-radius:8px;padding:10px 12px;white-space:pre-wrap;word-break:break-all;margin:0}`;
const page = (t, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title><style>${css}</style></head><body><div class="card">${body}</div></body></html>`;
const rows = (f) => Object.fromEntries(fs.readFileSync(`${RIG}/out/${f}`, 'utf8').split('\n').filter((l) => l.startsWith('ROW ')).map((l) => { const r = JSON.parse(l.slice(4)); return [r.arm + (r.i ? '#' + r.i : ''), r]; }));
const ok = (t, d = '') => `<span class="b" style="color:${C.good}">✓ ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const bad = (t, d = '') => `<span class="b" style="color:${C.crit}">✕ ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const meh = (t, d = '') => `<span class="b" style="color:${C.ink2}">– ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const na = `<span class="d">not run</span>`;
const C4 = rows('u5c-404-r5.console'), C4c = rows('u5c-404-r5-cand.console'), C5 = rows('u5c-502-r5.console'), C5c = rows('u5c-502-r5-cand.console');
const E = rows('u5e-r5-cand.console'), A = rows('u5a-r5.console'), B = rows('u5b-r5.console'), D = rows('u7-404-r5.console');
const O = rows('u1-r5.console'), Oc = rows('u1-r5-cand.console'), U = rows('u4-r5.console'), Uc = rows('u4-r5-cand.console');
const cellIdle = (r) => r.alertsAfterTurn2.length ? bad('stays over live events') : r.bannerLastSeenS < 30 ? ok(`cleared at ${r.bannerLastSeenS} s`, 'no new event needed') : meh('waits for the next event', `up ${r.bannerFirstS}–${r.bannerLastSeenS} s, until turn 2`);
const cellE = (r) => r.bannerAbsentBetween.length ? bad('gap during the black hole') : r.bannerLastSeenS < 60 ? ok(`held through the hole, cleared at ${r.bannerLastSeenS} s`, 'first keep-alive after release') : meh('held, then waits for the next event', `up ${r.bannerFirstS}–${r.bannerLastSeenS} s`);
const cellA = (r) => r.alertsAfterTurn2.length ? bad('stays') : r.bannerLastSeenS < 12 ? ok(`cleared at ${r.bannerLastSeenS} s`) : meh('waits for the next event');
const cellB = (r) => r.transcriptRenderedAtS === null ? bad('never loads') : ok(`loads at ${r.transcriptRenderedAtS} s`);
const cellO = (r) => r.bannerClearedAfterUpS != null ? ok(`cleared ${r.bannerClearedAfterUpS} s after recovery`) : meh('waits for the next event', 'still up 60 s after recovery');
const cellU = (r) => r.alertsAfter.length ? meh('waits for the next event', 'still up 45 s after the 401 ended') : ok('cleared after the 401 ended');
const cellD = (r) => { const after = r.log.find((x) => x.label === 'after turn 2 streamed live').alerts; return after.length ? bad('stays over the live turn', 'until the user pages again') : meh('cleared by the next event'); };
const Tr = (label, desc, cells) => `<tr><td style="width:24%"><b>${label}</b><span class="d">${desc}</span></td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
fs.writeFileSync(`${HTML}/01-round5-matrix.html`, page('Round 5', `<h1>Round 5 on main 933dc0a614: one-off failure, then a healthy but idle Session</h1>
<p class="sub">Real Spring + Harness; all arms watch the same Session at the same time; each arm's proxy fails exactly one request (or the real server is stopped). "Waits for the next event" = main's behaviour: the red line stays until something new streams in.</p>
<table><tr><th></th><th>main</th><th>prev head <span class="mono">9439da72</span></th><th>head <span class="mono">1780afcd</span></th><th>head + keep-alive candidate</th></tr>
${Tr('(c) a stream reconnect gets a 404', 'then healthy and idle', [cellIdle(C4.base), cellIdle(C4.prev), cellIdle(C4.head), cellIdle(C4c.cand)])}
${Tr('(c′) the same reconnect gets a 502', '', [cellIdle(C5.base), cellIdle(C5.prev), cellIdle(C5.head), cellIdle(C5c.cand)])}
${Tr('(e) 404, then the next reconnect is black-holed 30 s', 'open, no bytes — R11-1\'s case', [cellE(E.base), na, cellE(E.head), cellE(E.cand)])}
${Tr('Real Spring outage (60 s)', '', [cellO(O.base), cellO(O.prev), cellO(O.head), cellO(Oc.cand)])}
${Tr('Gateway 401 for 60 s', '', [cellU(U.base), cellU(U.prev), cellU(U.head), cellU(Uc.cand)])}
${Tr('(a) a summary poll gets a 404', 'stream live', [cellA(A.base), cellA(A.prev), cellA(A.head), na])}
${Tr('(b) the bootstrap session read gets a 404', '', [cellB(B.base), cellB(B.prev), cellB(B.head), na])}
${Tr('(d) one "Older history" fetch fails', 'then turn 2 streams', [cellD(D.base), cellD(D.prev), cellD(D.head), na])}
</table>
<p class="foot">Head and the previous head differ only in the autofix rounds (same tree otherwise). The candidate touches only the stream leg, so (a), (b) and (d) were not re-run on it. Raw: u5*/u1*/u4*/u7*-r5*.console.</p>`));
// Fig 2: why — raw bytes + timelines
{
  const raw = fs.readFileSync(`${RIG}/out/sse-idle-resume.raw`, 'utf8');
  const shown = raw.replace(/data:\{.*?\}\n/s, (m) => m.slice(0, 120) + '…}\n').replace(/</g, '&lt;');
  const W = 600, L = 116, R = 20, x0 = 0, x1 = 75; const X = (s) => L + ((s - x0) / (x1 - x0)) * (W - L - R);
  const bars = [
    ['(c) head', C4c.head, C.pr, null], ['(c) candidate', C4c.cand, C.cand, null],
    ['(e) head', E.head, C.pr, [6.1, 36.1]], ['(e) candidate', E.cand, C.cand, [6.1, 36.1]],
  ];
  let g = '';
  for (const t of [0, 15, 30, 45, 60, 75]) g += `<line x1="${X(t)}" x2="${X(t)}" y1="6" y2="${bars.length * 34 + 6}" stroke="${C.grid}"/><text x="${X(t)}" y="${bars.length * 34 + 22}" font-size="11.5" fill="${C.ink2}" text-anchor="middle">${t} s</text>`;
  bars.forEach(([label, r, color, hole], i) => {
    const y = 14 + i * 34;
    if (hole) g += `<rect x="${X(hole[0])}" y="${y - 9}" width="${X(hole[1]) - X(hole[0])}" height="26" fill="${C.band}"/><text x="${(X(hole[0]) + X(hole[1])) / 2}" y="${y + 23}" font-size="10" fill="${C.ink2}" text-anchor="middle">black-holed reconnect</text>`;
    g += `<text x="${L - 8}" y="${y + 8}" font-size="12" text-anchor="end">${label}</text><rect x="${X(r.bannerFirstS)}" y="${y}" width="${X(r.bannerLastSeenS) - X(r.bannerFirstS)}" height="10" rx="3" fill="${color}"/>`;
  });
  fs.writeFileSync(`${HTML}/02-why-keepalive.html`, page('Why', `<h1>Why the head's fix does not fire on this server — and what a keep-alive changes</h1>
<p class="sub">The head expires a stream verdict only when the reconnect "delivered" a frame. Resuming an idle Session (<span class="mono">afterSequence</span> = its head), this server sends no frame at all — only <span class="mono">:keepalive</span> comments about every 15 s, which the client drops. The candidate reports each keep-alive as the connection answering; a black-holed connection sends none, so R11-1's protection holds.</p>
<div style="display:flex;gap:24px;align-items:flex-start"><div style="flex:0 0 520px"><div style="font-weight:600;margin-bottom:6px">Raw bytes, 40 s of an idle resume (curl, <span class="mono">afterSequence: 8</span>)</div><pre>${shown}</pre><div class="d" style="margin-top:6px">id 9 was appended right after the read of last_sequence; after it, only comments.</div></div>
<div><div style="font-weight:600;margin-bottom:6px">Red line on screen (bar = visible)</div><svg width="${W}" height="${bars.length * 34 + 30}">${g}</svg><div class="d">404 injected at ~3 s; reconnect ~3 s later. (c) idle afterwards; (e) the reconnect is held 30 s with no bytes, then forwarded. Turn 2 streams at ~40 s / ~70 s, which is what finally clears the head.</div></div></div>`));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(HTML).filter((x) => x.endsWith('.html')).sort()) {
  const p = await ctx.newPage(); await p.goto(`file://${HTML}/${f}`); await p.locator('.card').screenshot({ path: `${OUT}/${f.replace('.html', '.png')}` }); console.log('rendered', f); await p.close();
}
await browser.close();
