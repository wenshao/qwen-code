// VERIFICATION RIG ONLY (PR #13179 round 4): evidence figures.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13179-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out-r4`, HTML = `${RIG}/fig/html-r4`;
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
// data
const A = rows('u5a-r4.console'), B = rows('u5b-r4.console'), Cc = rows('u5c-r4.console');
const C4 = rows('u5c-404-r4-cand.console'), C5 = rows('u5c-502-r4-cand.console');
const D4 = rows('u7-404-r4.console'), D5 = rows('u7-500-r4.console');
const O = rows('u1-r4.console'), Oc = rows('u1-r4-cand.console');
const U4 = rows('u4-r4-cand.console');
const cellRetire = (r) => r.alertsAfterTurn2.length ? bad('red line stays', 'still up after new events') : r.bannerLastSeenS < 12 ? ok(`cleared at ${r.bannerLastSeenS} s`, 'no new event needed') : meh('cleared by the next event', `up ${r.bannerFirstS}–${r.bannerLastSeenS} s until turn 2`);
const cellB = (r) => r.transcriptRenderedAtS === null ? bad('never loads') : ok(`loads at ${r.transcriptRenderedAtS} s`);
const cellD = (r) => { const after = r.log.find((x) => x.label === 'after turn 2 streamed live').alerts; const at4 = r.log[0].alerts; return after.length ? bad('red line stays over the live turn', 'until the user pages again') : at4.length ? meh('cleared by the next event') : ok('cleared by the next poll', 'within 4 s'); };
const cellO = (...rs) => rs.every((r) => r.bannerClearedAfterUpS != null) ? ok(`cleared ${rs.map((r) => r.bannerClearedAfterUpS).join(' / ')} s after recovery`) : meh('stays until the next event', `still up 60 s after recovery (${rs.length} page${rs.length > 1 ? 's' : ''})`);
const cellU4 = (r) => r.alertsAfter.length ? meh('stays until the next event', 'still up 45 s after the 401 ended') : ok('cleared', 'within 45 s after the 401 ended');
const Tr = (label, desc, cells) => `<tr><td style="width:25%"><b>${label}</b><span class="d">${desc}</span></td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const body = `<h1>After a one-off failure the server is healthy again — does the red line go away?</h1>
<p class="sub">Real Spring + Harness on main <span class="mono">f2e069061a</span>; all arms watch the same Session at the same time; each arm's proxy fails exactly one request (or the real server is stopped and restarted). "Next event" means the line stays on an idle Session until something new streams in — main's behaviour.</p>
<table><tr><th></th><th>main</th><th>prev head <span class="mono">e826f590</span></th><th>new head <span class="mono">9439da72</span></th><th>new head + candidate</th></tr>
${Tr('(a) summary poll gets a 404', 'stream live', [cellRetire(A.base), cellRetire(A.prev), cellRetire(A.head), na])}
${Tr('(b) bootstrap session read gets a 404', '', [cellB(B.base), cellB(B.prev), cellB(B.head), na])}
${Tr('(c) stream reconnect gets a <b>404</b>', 'terminal verdict', [cellRetire(C4.base), cellRetire(Cc.prev), cellRetire(C4.head), cellRetire(C4.cand)])}
${Tr('(c′) the same reconnect gets a <b>502</b>', 'transient — weaker than (c)', [cellRetire(C5.base), na, cellRetire(C5.head), cellRetire(C5.cand)])}
${Tr('Real Spring outage, then recovery', '60 s down', [cellO(O['base'], O['base#1']), cellO(O['prev'], O['prev#1']), cellO(O['head'], O['head#1'], Oc['head']), cellO(Oc['cand'])])}
${Tr('Gateway 401 for 60 s, then accepted', '', [cellU4(U4.base), na, cellU4(U4.head), cellU4(U4.cand)])}
${Tr('(d) one "Older history" page fetch fails', '404 and 500 alike, then turn 2 streams', [cellD(D4.base), cellD(D4.prev), cellD(D4.head), `<span class="d">not addressed by the candidate</span>`])}
</table>
<p class="foot">Why the new head falls back to main's behaviour (–) where the previous head had fixed it, and does worse than main (✕) on (d): a record is retired only by a success of its own leg, and the stream's proof-of-life / clean-close expiry removes terminal records only — so a transient stream failure (5xx, 401) waits for a new frame, and a failed page fetch waits for another page. Candidate: proof-of-life and clean close expire the stream leg's transient records too; the "not advancing" stall warning is exempt (marked) and keeps waiting for an advancing stream. (d) needs a product decision and is left as a suggestion. Raw: u5*/u1*/u4*/u7*-r4*.console.</p>`;
fs.writeFileSync(`${HTML}/01-after-one-failure.html`, page('After one failure', body));
// screenshots for (d)
{
  const img = (f) => `data:image/png;base64,${fs.readFileSync(`${RIG}/fig/raw/${f}`).toString('base64')}`;
  const cell = (f, name, c, txt) => `<div style="flex:1"><div style="font-weight:600;margin-bottom:6px"><i class="sw" style="background:${c};margin-right:7px"></i>${name}</div><div style="border:1px solid ${C.grid};border-radius:8px;overflow:hidden;height:430px;background:#fff"><img src="${img(f)}" style="width:166%;display:block"></div><div style="color:${C.ink2};font-size:12.5px;margin-top:6px">${txt}</div></div>`;
  fs.writeFileSync(`${HTML}/02-page-failure-panels.html`, page('Page failure', `<h1>Shape (d): one "Older history" fetch failed (404), then turn 2 streamed in live</h1>
<p class="sub">Raw-paging Session (160 paragraphs, materializer off). Each arm's proxy failed exactly one paged <span class="mono">transcript/query</span>; every later request was healthy; turn 2 (<span class="mono">[PGN-…]</span>, bottom of the transcript) then streamed in on all three. Screenshot 5 s after turn 2.</p>
<div style="display:flex;gap:16px">${cell('u7-404-base-after-turn2.png', 'main', C.main, 'red line gone with the first new event')}${cell('u7-404-prev-after-turn2.png', 'prev head e826f590', C.prev, 'cleared by the next summary poll (&lt;4 s)')}${cell('u7-404-head-after-turn2.png', 'new head 9439da72', C.pr, 'red line stays over the live turn until the user pages again')}</div>`));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(HTML).filter((x) => x.endsWith('.html')).sort()) {
  const p = await ctx.newPage(); await p.goto(`file://${HTML}/${f}`); await p.locator('.card').screenshot({ path: `${OUT}/${f.replace('.html', '.png')}` }); console.log('rendered', f); await p.close();
}
await browser.close();
