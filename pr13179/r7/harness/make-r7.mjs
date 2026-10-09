// VERIFICATION RIG ONLY (PR #13179 round 7): evidence figures.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13179-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out-r7`, HTML = `${RIG}/fig/html-r7`;
const C = { main: '#2a78d6', pr: '#eb6834', cand: '#1baf7a', prev: '#8a8984', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984', grid: '#e7e6e2', surf: '#fcfcfb', crit: '#d03b3b', good: '#0a7d0a', fault: '#efeeea' };
const css = `body{margin:0;background:${C.surf};font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:${C.ink}}
.card{width:1180px;padding:28px 32px 24px;box-sizing:border-box;background:${C.surf}}
h1{font-size:20px;margin:0 0 4px;font-weight:650}.sub{color:${C.ink2};margin:0 0 14px;font-size:13.5px;max-width:1110px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.foot{color:${C.muted};font-size:12px;margin-top:12px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 9px;text-align:left;border-bottom:1px solid ${C.grid};vertical-align:top}th{color:${C.ink2};font-weight:600;font-size:12.5px}
.b{font-weight:600;font-size:12.5px}.d{display:block;color:${C.ink2};font-weight:400;font-size:11.5px;margin-top:2px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}`;
const page = (t, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title><style>${css}</style></head><body><div class="card">${body}</div></body></html>`;
const rowsOf = (f) => fs.readFileSync(`${RIG}/out/${f}`, 'utf8').split('\n').filter((l) => l.startsWith('ROW ')).map((l) => JSON.parse(l.slice(4)));
const rows = (f) => Object.fromEntries(rowsOf(f).map((r) => [r.arm + (r.i ? '#' + r.i : ''), r]));
const ok = (t, d = '') => `<span class="b" style="color:${C.good}">✓ ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const bad = (t, d = '') => `<span class="b" style="color:${C.crit}">✕ ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const meh = (t, d = '') => `<span class="b" style="color:${C.ink2}">– ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const na = `<span class="d">not run</span>`;
const C4 = rows('u5c-404-r7.console'), C5 = rows('u5c-502-r7.console'), E = rows('u5e-r7.console'), G = rows('u8-r7-direct-run1.console'), G2 = rows('u8-r7-direct-run2.console');
const H = rows('u9-r7-run2.console'), H1 = rows('u9-r7-run1.console'), H3 = rows('u9-r7-run3-15s.console');
const O = rows('u1-r7.console'), O2 = rows('u1-r7-run2.console'), U = rows('u4-r7.console'), D2 = rows('u2-r7.console');
const idle = (r) => ok(`cleared at ${r.bannerLastSeenS} s`, 'first keep-alive / establishment');
const hole = (r) => r.bannerAbsentBetween.length ? bad('gap during the hole') : ok(`held through the hole, cleared at ${r.bannerLastSeenS} s`);
const g = (a) => { const r = G[a], r2 = G2[a]; const res = r.alertTextsAfterBlip.includes('rig injected 404'); const res2 = r2.alertTextsAfterBlip.includes('rig injected 404'); if (res !== res2) return meh('runs disagree'); return res ? bad('the old 404 comes back as a terminal stop', `2/2 runs, ${r.visibleAfterBlipS[0]}–${r.visibleAfterBlipS[1]} s`) : ok('transient "network error"', `2/2 runs, ${r.visibleAfterBlipS[0]}–${r.visibleAfterBlipS[1]} s, then cleared`); };
const h = (a) => {
  const r = H[a];
  if (r.turn1RenderedAtS === null) return bad('never recovers by itself', `${r.bootstrapsAtS.length - 1} bootstraps, then none; transcript empty and the 404 up until Refresh (3/3 runs, also after a 15 s fault)`);
  const n = r.duringFault.transcriptQuery;
  return ok(`transcript shown at ${r.turn1RenderedAtS} s`, a === 'cand' ? `${n} bootstraps in the fault (bound kept), then one re-arm on the 30 s rung; 15 s fault: shown at ${H3.cand.turn1RenderedAtS} s` : a === 'prev' ? `${n} bootstraps during the fault (re-arms every 3 s)` : `${n} bootstrap attempts during the fault (every 3 s)`);
};
const Tr = (label, desc, cells) => `<tr><td style="width:24%"><b>${label}</b><span class="d">${desc}</span></td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
fs.writeFileSync(`${HTML}/01-round7.html`, page('Round 7', `<h1>Round 7: 79d77b24 ⊕ main 085a44f3 — real Spring + Harness, all arms on one Session</h1>
<p class="sub">Each arm has its own recording proxy. prev = the round-6 head 2061be72 merged into the same main, so the prev→head column pair is exactly this round's five commits. The candidate = head + one change: past the re-arm bound, re-arm on the slowest rung instead of never.</p>
<table><tr><th></th><th>main</th><th>prev <span class="mono">2061be72</span></th><th>head <span class="mono">79d77b24</span></th><th>head + candidate</th></tr>
${Tr('(c) one 404 on a stream reconnect, then idle', '', [idle(C4.base), idle(C4.prev), idle(C4.head), na])}
${Tr('(c′) one 502 on the same reconnect', '', [idle(C5.base), idle(C5.prev), idle(C5.head), na])}
${Tr('(e) 404, then a 30 s black-holed reconnect', 'open, no bytes', [hole(E.base), hole(E.prev), hole(E.head), na])}
${Tr('(g) (c), then 37 s later the healthy stream drops', 'abrupt network error, direct to the proxy', [g('base'), g('prev'), g('head'), na])}
${Tr('<span style="color:#d03b3b">(h)</span> page opened while every other <span class="mono">sessions/get</span> answers 404', 'for 30 s (one of two replicas), then healthy', [h('base'), h('prev'), h('head'), h('cand')])}
${Tr('Real Spring outage 60 s', '2 runs', [`${meh(`${O.base.outageRequests} / ${O2.base.outageRequests} requests (37/min)`)}<span class="d">cleared ${O.base.bannerClearedAfterUpS} / ${O2.base.bannerClearedAfterUpS} s after recovery</span>`, na, `${ok(`${O.head.outageRequests} / ${O2.head.outageRequests} requests (10–12/min)`)}<span class="d">cleared ${O.head.bannerClearedAfterUpS} / ${O2.head.bannerClearedAfterUpS} s after recovery (stream back on the ladder at ${O.head.streamBackS} / ${O2.head.streamBackS} s)</span>`, na])}
${Tr('Gateway 401 for 60 s', '', [meh(`${U.base.perMinute}/min`, 'cleared after'), na, ok(`${U.head.perMinute}/min`, 'cleared after'), na])}
${Tr('Watched Session deleted (240 s)', 'requests per panel', [meh(`${D2.base.requests} / ${D2['base#1'].requests}`, '3 s forever'), na, ok(`${D2.head.requests} / ${D2['head#1'].requests}`, 'on the ladder'), na])}
${Tr('Unknown Session id (90 s)', 'bootstrap attempts per page', [meh('31–33 attempts', 'every 3 s'), na, ok('1 attempt on 10/10 pages', '9–13 requests per page'), na])}
</table>
<p class="foot">(a) a 404 on a summary poll: main clears at 3.1 s, head at 6.7 s; (b) a bootstrap 404: both load at 3.1 s; (d) a failed "Older history" fetch: both clear on the next event; 0 duplicate ids in 345 reads. The proxy's 404 text is "rig injected 404"; a real replica would say "The Session was not found.". Raw: u5*/u8*/u9*/u1*/u4*/u2*/u3*-r7.console.</p>`));
{
  const W = 1116, L = 150, R = 20, T0 = 0, T1 = 80, X = (s) => L + ((s - T0) / (T1 - T0)) * (W - L - R);
  const arms = [['base', 'main', C.main], ['prev', 'prev 2061be72', C.prev], ['head', 'head 79d77b24', C.pr], ['cand', 'head + candidate', C.cand]];
  const laneH = 78, top = 44, refresh = Math.min(...arms.map(([a]) => H[a].bootstrapsAtS.at(-1)));
  const fault = H.head.faultS, t2 = H.head.turn2RunAtS;
  let s = `<svg width="${W}" height="${top + arms.length * laneH + 34}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`;
  s += `<rect x="${X(0)}" y="${top - 8}" width="${X(fault) - X(0)}" height="${arms.length * laneH + 4}" fill="${C.fault}"/>`;
  s += `<text x="${X(0) + 6}" y="${top - 14}" font-size="12" fill="${C.ink2}">fault: every other sessions/get answers 404 (0–${fault} s)</text>`;
  for (const [t, lab] of [[t2, 'turn 2 run'], [refresh, 'Refresh clicked']]) { s += `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 8}" y2="${top + arms.length * laneH - 4}" stroke="${C.ink2}" stroke-width="1" stroke-dasharray="3 3"/><text x="${X(t) - 4}" y="${top - 14}" font-size="12" text-anchor="end" fill="${C.ink2}">${lab}</text>`; }
  for (let k = 0; k <= T1; k += 10) s += `<text x="${X(k)}" y="${top + arms.length * laneH + 20}" font-size="11.5" text-anchor="middle" fill="${C.muted}">${k} s</text>`;
  arms.forEach(([a, name, col], i) => {
    const r = H[a], y = top + i * laneH;
    s += `<rect x="0" y="${y + 6}" width="12" height="12" rx="3" fill="${col}"/><text x="18" y="${y + 17}" font-size="13.5" font-weight="600" fill="${C.ink}">${name}</text>`;
    const tracks = [['red line up', y + 30], ['transcript shown', y + 48], ['bootstrap reads', y + 64]];
    for (const [lab, ty] of tracks) s += `<text x="18" y="${ty + 4}" font-size="11" fill="${C.ink2}">${lab}</text><line x1="${X(0)}" x2="${X(T1)}" y1="${ty}" y2="${ty}" stroke="${C.grid}"/>`;
    for (const w of r.alertWindows) { const m = w.match(/^([\d.]+)-([\d.]+)s/); const a0 = +m[1], a1 = +m[2]; s += `<rect x="${X(a0)}" y="${y + 26}" width="${Math.max(3, X(a1) - X(a0))}" height="8" rx="4" fill="${col}"/>`; }
    const shownFrom = r.turn1RenderedAtS ?? refresh + 0.4;
    s += `<rect x="${X(shownFrom)}" y="${y + 44}" width="${X(T1) - X(shownFrom)}" height="8" rx="4" fill="${col}" opacity="${r.turn1RenderedAtS === null ? 0.45 : 1}"/>`;
    if (r.turn1RenderedAtS === null) s += `<text x="${X(fault) + 8}" y="${y + 52}" font-size="11.5" fill="${C.crit}" font-weight="600">empty until Refresh — turn 2 never shown</text>`;
    for (const b of r.bootstrapsAtS) s += `<circle cx="${X(b)}" cy="${y + 64}" r="4" fill="${C.surf}" stroke="${C.ink}" stroke-width="2"/>`;
  });
  s += '</svg>';
  fs.writeFileSync(`${HTML}/02-rearm-timeline.html`, page('Re-arm timeline', `<h1>(h) The re-arm bound on the real stack: a fault at page open leaves head's panel dead after the backend heals</h1>
<p class="sub">Run 2 of 3 (four arms side by side). head stops after 1 + 3 bootstraps (MAX_SESSION_REARMS = 3) — as designed during the fault — but nothing re-arms it once the poll keeps succeeding: no stream, no transcript, and the 404 stays up until the user clicks Refresh. The candidate keeps the same 4 bootstraps during the fault and re-arms once more on the 30 s rung.</p>${s}
<p class="foot">Dots = bootstrap reads (<span class="mono">transcript/query</span>) seen by the page; bars = what the panel showed (sampled every 0.5 s). The reads at ~72 s are the Refresh click.</p>`));
}
{
  const img = (f) => `data:image/png;base64,${fs.readFileSync(`${RIG}/fig/raw/${f}`).toString('base64')}`;
  const cell = (f, name, c, txt) => `<div style="flex:1"><div style="font-weight:600;margin-bottom:6px"><i class="sw" style="background:${c};margin-right:7px"></i>${name}</div><div style="border:1px solid ${C.grid};border-radius:8px;overflow:hidden;height:300px;background:#fff"><img src="${img(f)}" style="width:210%;display:block"></div><div style="color:${C.ink2};font-size:12.5px;margin-top:6px">${txt}</div></div>`;
  fs.writeFileSync(`${HTML}/03-rearm-panels.html`, page('Re-arm panels', `<h1>(h) 30 s after the backend healed, a new turn has run: the same moment in three builds</h1>
<p class="sub">Same Session, same proxy fault (every other <span class="mono">sessions/get</span> answered 404 for the first 30 s after the page opened), turn 2 run at 61.6 s, screenshot ~10 s later, before anyone clicks Refresh.</p>
<div style="display:flex;gap:16px">${cell('u9-2-base-after-turn2.png', 'main', C.main, 'both turns shown, no alert')}${cell('u9-2-head-after-turn2.png', 'head 79d77b24', C.pr, 'the Session reads Completed, but the transcript is empty and the 404 stands')}${cell('u9-2-cand-after-turn2.png', 'head + candidate', C.cand, 'both turns shown, no alert')}</div>`));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(HTML).filter((x) => x.endsWith('.html')).sort()) {
  const p = await ctx.newPage(); await p.goto(`file://${HTML}/${f}`); await p.locator('.card').screenshot({ path: `${OUT}/${f.replace('.html', '.png')}` }); console.log('rendered', f); await p.close();
}
await browser.close();
