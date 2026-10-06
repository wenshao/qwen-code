// VERIFICATION RIG ONLY (PR #13179 round 6): evidence figures.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13179-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out-r6`, HTML = `${RIG}/fig/html-r6`;
const C = { main: '#2a78d6', pr: '#eb6834', cand: '#1baf7a', prev: '#8a8984', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984', grid: '#e7e6e2', surf: '#fcfcfb', crit: '#d03b3b', good: '#0a7d0a' };
const css = `body{margin:0;background:${C.surf};font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:${C.ink}}
.card{width:1180px;padding:28px 32px 24px;box-sizing:border-box;background:${C.surf}}
h1{font-size:20px;margin:0 0 4px;font-weight:650}.sub{color:${C.ink2};margin:0 0 14px;font-size:13.5px;max-width:1110px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.foot{color:${C.muted};font-size:12px;margin-top:12px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 9px;text-align:left;border-bottom:1px solid ${C.grid};vertical-align:top}th{color:${C.ink2};font-weight:600;font-size:12.5px}
.b{font-weight:600;font-size:12.5px}.d{display:block;color:${C.ink2};font-weight:400;font-size:11.5px;margin-top:2px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}`;
const page = (t, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title><style>${css}</style></head><body><div class="card">${body}</div></body></html>`;
const rows = (f) => Object.fromEntries(fs.readFileSync(`${RIG}/out/${f}`, 'utf8').split('\n').filter((l) => l.startsWith('ROW ')).map((l) => { const r = JSON.parse(l.slice(4)); return [r.arm + (r.i ? '#' + r.i : ''), r]; }));
const ok = (t, d = '') => `<span class="b" style="color:${C.good}">✓ ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const bad = (t, d = '') => `<span class="b" style="color:${C.crit}">✕ ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const meh = (t, d = '') => `<span class="b" style="color:${C.ink2}">– ${t}</span>${d ? `<span class="d">${d}</span>` : ''}`;
const na = `<span class="d">not run</span>`;
const C4 = rows('u5c-404-r6.console'), C5 = rows('u5c-502-r6.console'), E = rows('u5e-r6.console'), G = rows('u8-r6-direct.console');
const O = rows('u1-r6.console'), U = rows('u4-r6.console'), D2 = rows('u2-r6.console'), U3 = rows('u3-r6.console');
const idle = (r) => r.bannerLastSeenS < 30 ? ok(`cleared at ${r.bannerLastSeenS} s`, 'first keep-alive / establishment') : meh('waits for the next event', `up ${r.bannerFirstS}–${r.bannerLastSeenS} s`);
const hole = (r) => r.bannerAbsentBetween.length ? bad('gap during the hole') : r.bannerLastSeenS < 60 ? ok(`held through the hole, cleared at ${r.bannerLastSeenS} s`) : meh('held, then waits for the next event');
const resurrect = (r) => r.alertTextsAfterBlip.includes('rig injected 404') ? bad('the old 404 comes back as a terminal stop', `"rig injected 404" ${r.visibleAfterBlipS[0]}–${r.visibleAfterBlipS[1]} s`) : ok('transient "network error"', `${r.visibleAfterBlipS[0]}–${r.visibleAfterBlipS[1]} s, then cleared`);
const Tr = (label, desc, cells) => `<tr><td style="width:26%"><b>${label}</b><span class="d">${desc}</span></td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
fs.writeFileSync(`${HTML}/01-round6.html`, page('Round 6', `<h1>Round 6: 2061be72 ⊕ main ac497aee — real Spring + Harness, all arms on one Session</h1>
<p class="sub">Each arm's proxy fails exactly one request (or the server is stopped / the stream is dropped). main now clears a stream failure on (re-)establishment (#13342 <span class="mono">onEstablished</span>); this server establishes on its first keep-alive, so main and the PR's keep-alive rule land at the same time.</p>
<table><tr><th></th><th>main</th><th>head <span class="mono">2061be72</span></th><th>head + candidate</th></tr>
${Tr('(c) one 404 on a stream reconnect, then idle', '', [idle(C4.base), idle(C4.head), na])}
${Tr('(c′) one 502 on the same reconnect', '', [idle(C5.base), idle(C5.head), na])}
${Tr('(e) 404, then a 30 s black-holed reconnect', 'open, no bytes', [hole(E.base), hole(E.head), na])}
${Tr('<span style="color:#d03b3b">(g)</span> (c), then 37 s later the healthy stream drops', 'abrupt network error; direct to the wire (2/2 runs)', [resurrect(G.base), resurrect(G.head), resurrect(G.cand)])}
${Tr('Real Spring outage 60 s', '', [`${meh(O.base.outageRequests + ' requests (38/min)')}<span class="d">cleared ${O.base.bannerClearedAfterUpS} s after recovery</span>`, `${ok(O.head.outageRequests + ' requests (10.5/min)')}<span class="d">cleared ${O.head.bannerClearedAfterUpS} s after recovery</span>`, na])}
${Tr('Gateway 401 for 60 s', '', [meh(`${U.base.perMinute}/min`, 'cleared after'), ok(`${U.head.perMinute}/min`, 'cleared after'), na])}
${Tr('Watched Session deleted (240 s)', 'requests per panel', [meh(`${D2.base.requests} / ${D2['base#1'].requests}`, '3 s forever'), ok(`${D2.head.requests} / ${D2['head#1'].requests}`, 'stream + summary on the ladder'), na])}
${Tr('Unknown Session id (90 s)', 'bootstrap attempts per page', [meh('31–33 attempts', 'every 3 s'), ok('1 attempt on 10/10 pages', '9–13 requests per page'), na])}
</table>
<p class="foot">(a) a 404 on a summary poll: main clears at 3.6 s, head at 6.6 s; (b) a bootstrap 404: both load at 3.1 s; (d) a failed "Older history" fetch: both clear on the next event. Candidate = one line: a keep-alive that lands the expiry also drops the captured verdict. Raw: u5*/u8*/u1*/u4*/u2*/u3*-r6.console.</p>`));
{
  const img = (f) => `data:image/png;base64,${fs.readFileSync(`${RIG}/fig/raw/${f}`).toString('base64')}`;
  const cell = (f, name, c, txt) => `<div style="flex:1"><div style="font-weight:600;margin-bottom:6px"><i class="sw" style="background:${c};margin-right:7px"></i>${name}</div><div style="border:1px solid ${C.grid};border-radius:8px;overflow:hidden;height:250px;background:#fff"><img src="${img(f)}" style="width:200%;display:block"></div><div style="color:${C.ink2};font-size:12.5px;margin-top:6px">${txt}</div></div>`;
  fs.writeFileSync(`${HTML}/02-resurrect-panels.html`, page('Resurrect', `<h1>Shape (g), 3 s after the healthy stream dropped: the same moment in three builds</h1>
<p class="sub">At ~3 s one reconnect was answered 404 (the proxy's text: "rig injected 404" — on the real server "The Session was not found."); the next connection was healthy and its keep-alive cleared the line at ~21 s; at 40 s that connection was dropped abruptly.</p>
<div style="display:flex;gap:16px">${cell('u8-base-3s-after-drop.png', 'main', C.main, 'transient "network error", gone after the reconnect')}${cell('u8-head-3s-after-drop.png', 'head 2061be72', C.pr, 'the 37 s-old 404 is restored as a terminal stop')}${cell('u8-cand-3s-after-drop.png', 'head + candidate', C.cand, 'transient "network error", like main')}</div>`));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(HTML).filter((x) => x.endsWith('.html')).sort()) {
  const p = await ctx.newPage(); await p.goto(`file://${HTML}/${f}`); await p.locator('.card').screenshot({ path: `${OUT}/${f.replace('.html', '.png')}` }); console.log('rendered', f); await p.close();
}
await browser.close();
