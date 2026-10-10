// VERIFICATION RIG ONLY (PR #13179 round 9): evidence figures.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13179-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out-r9`, HTML = `${RIG}/fig/html-r9`;
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
const C4 = rows('u5c-404-r9.console'), C5 = rows('u5c-502-r9.console'), E = rows('u5e-r9.console'), G = rows('u8-r9-direct-run1.console');
const H1 = rows('u9-r9-run1.console'), H2 = rows('u9-r9-run2.console'), H3 = rows('u9-r9-run3-15s.console');
const O = rows('u1-r9.console'), O2 = rows('u1-r9-run2.console'), U = rows('u4-r9.console'), D2 = rows('u2-r9.console');
const idle = (r) => ok(`cleared at ${r.bannerLastSeenS} s`, 'first keep-alive / establishment');
const hole = (r) => r.bannerAbsentBetween.length ? bad('gap during the hole') : ok(`held through the hole, cleared at ${r.bannerLastSeenS} s`);
const g = (a) => G[a].alertTextsAfterBlip.includes('rig injected 404') ? bad('the old 404 comes back as a terminal stop') : ok('transient "network error"', `${G[a].visibleAfterBlipS[0]}–${G[a].visibleAfterBlipS[1]} s, then cleared`);
const shown = (a) => [H1, H2, H3].map((H) => H[a].turn1RenderedAtS);
const h = (a) => {
  const s = shown(a);
  if (a === 'head') return ok(`recovers by itself: shown at ${s[0]} / ${s[1]} s`, `4 bootstraps during the fault, then one more on the 30 s rung; 15 s fault: shown at ${s[2]} s; turn 2 live 3/3`);
  if (a === 'prev') return bad('stuck until Refresh in 3/3 runs', 'transcript empty, 404 up, turn 2 never shown (also after the 15 s fault)');
  return meh(`shown at ${s[0]} / ${s[1]} s; ${s[2]} s with the 15 s fault`, 'retries every 3 s; turn 2 live 3/3');
};
const Tr = (label, desc, cells) => `<tr><td style="width:24%"><b>${label}</b><span class="d">${desc}</span></td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
fs.writeFileSync(`${HTML}/01-round9.html`, page('Round 9', `<h1>Round 9: 774bba82 ⊕ main c34b8423 — real Spring + Harness, all arms on one Session</h1>
<p class="sub">Each arm has its own recording proxy. The PR head is unchanged since round 8; main moved 24 commits (Spring server, migrations V60/V62, Web Shell host switching). The PR's diff against main is byte-identical to round 8 (same patch-id). prev = the round-7 head 79d77b24 merged into the same main, the control for (h).</p>
<table><tr><th></th><th>main</th><th>prev <span class="mono">79d77b24</span></th><th>head <span class="mono">774bba82</span></th></tr>
${Tr('<span style="color:#d03b3b">(h)</span> page opened while every other <span class="mono">sessions/get</span> answers 404', '30 s (runs 1–2) or 15 s (run 3), then healthy; turn 2 run ~30 s after the heal', [h('base'), h('prev'), h('head')])}
${Tr('(c) one 404 on a stream reconnect, then idle', '', [idle(C4.base), idle(C4.prev), idle(C4.head)])}
${Tr('(c′) one 502 on the same reconnect', '', [idle(C5.base), idle(C5.prev), idle(C5.head)])}
${Tr('(e) 404, then a 30 s black-holed reconnect', 'open, no bytes', [hole(E.base), hole(E.prev), hole(E.head)])}
${Tr('(g) (c), then 37 s later the healthy stream drops', 'abrupt network error, direct to the proxy', [g('base'), g('prev'), g('head')])}
${Tr('Real Spring outage 60 s', '2 runs; the restart took 18–30 s under host load', [`${meh(`${O.base.outageRequests} / ${O2.base.outageRequests} requests (${O.base.perMinute} / ${O2.base.perMinute} per min)`)}<span class="d">cleared ${O.base.bannerClearedAfterUpS} / ${O2.base.bannerClearedAfterUpS} s after recovery; reconnected on the first attempt</span>`, na, `${ok(`${O.head.outageRequests} / ${O2.head.outageRequests} requests (${O.head.perMinute} / ${O2.head.perMinute} per min)`)}<span class="d">cleared ${O.head.bannerClearedAfterUpS} / ${O2.head.bannerClearedAfterUpS} s after recovery (stream back on the ladder at ${O.head.streamBackS} / ${O2.head.streamBackS} s)</span>`])}
${Tr('Gateway 401 for 60 s', '', [meh(`${U.base.perMinute}/min`, 'cleared after'), na, ok(`${U.head.perMinute}/min`, 'cleared after')])}
${Tr('Watched Session deleted (240 s)', 'requests per panel', [meh(`${D2.base.requests} / ${D2['base#1'].requests}`, '3 s forever'), na, ok(`${D2.head.requests} / ${D2['head#1'].requests}`, 'on the ladder')])}
${Tr('Unknown Session id (90 s)', 'bootstrap attempts per page', [meh('31–42 attempts', 'every 3 s'), na, ok('1 attempt on 10/10 pages', '9–14 requests per page')])}
</table>
<p class="foot">(a) a 404 on a summary poll: both clear by 4.1 s; (b) a bootstrap 404: main loads at 2.1 s, head at 3.2 s (both depend on where the poll falls); (d) a failed "Older history" fetch: both clear on the next event; 0 duplicate ids in 982 reads. The proxy's 404 text is "rig injected 404". Raw: u9*/u5*/u8*/u1*/u4*/u2*/u3*/u7*-r9.console.</p>`));
const timeline = (H, T1, tick, note) => {
  const W = 1116, L = 150, R = 20, X = (s) => L + (s / T1) * (W - L - R);
  const arms = [['base', 'main', C.main], ['prev', 'prev 79d77b24', C.prev], ['head', 'head 774bba82', C.pr]];
  const laneH = 78, top = 44, refresh = Math.min(...arms.map(([a]) => H[a].bootstrapsAtS.at(-1)));
  const fault = H.head.faultS, t2 = H.head.turn2RunAtS;
  let s = `<svg width="${W}" height="${top + arms.length * laneH + 34}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`;
  s += `<rect x="${X(0)}" y="${top - 8}" width="${X(fault) - X(0)}" height="${arms.length * laneH + 4}" fill="${C.fault}"/>`;
  s += `<text x="${X(0) + 6}" y="${top - 14}" font-size="12" fill="${C.ink2}">fault: every other sessions/get answers 404 (0–${fault} s)</text>`;
  for (const [t, lab] of [[t2, 'turn 2 run'], [refresh, 'Refresh']]) { s += `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 8}" y2="${top + arms.length * laneH - 4}" stroke="${C.ink2}" stroke-width="1" stroke-dasharray="3 3"/><text x="${X(t) - 4}" y="${top - 14}" font-size="12" text-anchor="end" fill="${C.ink2}">${lab}</text>`; }
  for (let k = 0; k <= T1; k += tick) s += `<text x="${X(k)}" y="${top + arms.length * laneH + 20}" font-size="11.5" text-anchor="middle" fill="${C.muted}">${k} s</text>`;
  arms.forEach(([a, name, col], i) => {
    const r = H[a], y = top + i * laneH;
    s += `<rect x="0" y="${y + 6}" width="12" height="12" rx="3" fill="${col}"/><text x="18" y="${y + 17}" font-size="13.5" font-weight="600" fill="${C.ink}">${name}</text>`;
    for (const [lab, ty] of [['404 shown', y + 30], ['transcript shown', y + 48], ['bootstrap reads', y + 64]]) s += `<text x="18" y="${ty + 4}" font-size="11" fill="${C.ink2}">${lab}</text><line x1="${X(0)}" x2="${X(T1)}" y1="${ty}" y2="${ty}" stroke="${C.grid}"/>`;
    for (const w of r.alertWindows) { const m = w.match(/^([\d.]+)-([\d.]+)s/); const a0 = +m[1], a1 = +m[2]; s += `<rect x="${X(a0)}" y="${y + 26}" width="${Math.max(3, X(a1) - X(a0))}" height="8" rx="4" fill="${col}"/>`; }
    const from = r.turn1RenderedAtS ?? refresh + 0.4;
    s += `<rect x="${X(from)}" y="${y + 44}" width="${X(T1) - X(from)}" height="8" rx="4" fill="${col}" opacity="${r.turn1RenderedAtS === null ? 0.45 : 1}"/>`;
    if (r.turn1RenderedAtS === null) s += `<text x="${X(refresh) - 12}" y="${y + 52}" text-anchor="end" font-size="11.5" fill="${C.crit}" font-weight="600">empty until Refresh — turn 2 never shown</text>`;
    for (const b of r.bootstrapsAtS) s += `<circle cx="${X(b)}" cy="${y + 64}" r="4" fill="${C.surf}" stroke="${C.ink}" stroke-width="2"/>`;
  });
  return `<h2 style="font-size:15px;margin:18px 0 2px">${note}</h2>${s}</svg>`;
};
fs.writeFileSync(`${HTML}/02-rearm-timeline.html`, page('Re-arm timeline', `<h1>(h) on the new main: head still picks up the healed backend by itself</h1>
<p class="sub">Three arms side by side on one Session. prev (the round-7 head) stops after 1 + 3 bootstraps and never re-arms: no stream, no transcript, the 404 stays until Refresh. head keeps the same 4 bootstraps, then re-arms on the 30 s rung, and the bootstrap after the heal loads the transcript and the stream.</p>
${timeline(H2, 80, 10, 'Run 2 — 30 s fault')}
<p class="foot">Dots = bootstrap reads (<span class="mono">transcript/query</span>) seen by the page; bars = what the panel showed (sampled every 0.5 s). The last dot in each lane is the Refresh click.</p>`));
{
  const img = (f) => `data:image/png;base64,${fs.readFileSync(`${RIG}/fig/raw/${f}`).toString('base64')}`;
  const cell = (f, name, c, txt) => `<div style="flex:1"><div style="font-weight:600;margin-bottom:6px"><i class="sw" style="background:${c};margin-right:7px"></i>${name}</div><div style="border:1px solid ${C.grid};border-radius:8px;overflow:hidden;height:300px;background:#fff"><img src="${img(f)}" style="width:210%;display:block"></div><div style="color:${C.ink2};font-size:12.5px;margin-top:6px">${txt}</div></div>`;
  fs.writeFileSync(`${HTML}/03-rearm-panels.html`, page('Re-arm panels', `<h1>(h) 30 s after the backend healed, a new turn has run: the same moment in three builds</h1>
<p class="sub">Run 2: same Session, same proxy fault (every other <span class="mono">sessions/get</span> answered 404 for the first 30 s after the page opened), turn 2 run at ${H2.head.turn2RunAtS} s, screenshot ~10 s later, before anyone clicks Refresh.</p>
<div style="display:flex;gap:16px">${cell('u9-r9b-base-after-turn2.png', 'main', C.main, 'both turns shown, no alert')}${cell('u9-r9b-prev-after-turn2.png', 'prev 79d77b24', C.prev, 'the Session reads Completed, but the transcript is empty and the 404 stands')}${cell('u9-r9b-head-after-turn2.png', 'head 774bba82', C.pr, 'both turns shown, no alert')}</div>`));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(HTML).filter((x) => x.endsWith('.html')).sort()) {
  const p = await ctx.newPage(); await p.goto(`file://${HTML}/${f}`); await p.locator('.card').screenshot({ path: `${OUT}/${f.replace('.html', '.png')}` }); console.log('rendered', f); await p.close();
}
await browser.close();
