// VERIFICATION RIG ONLY (PR #13247 round 5): evidence card from the round-5 ledgers.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13247-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/r5/fig`; fs.mkdirSync(OUT, { recursive: true });
const R = (p) => JSON.parse(fs.readFileSync(`${RIG}/r5/results/${p}`, 'utf8'));
const sc = (p) => { const r = R(p); return `${r.pass}/${r.pass + r.fail}`; };
const W = 1000;
const css = `body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
#card{width:${W}px;padding:22px 26px 24px;background:#0d1117} h1{font-size:19px;margin:0 0 4px;font-weight:650}
.sub{font-size:12.5px;color:#9da7b3;margin:0 0 14px;line-height:1.45} h2{font-size:14px;margin:14px 0 7px}
table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:10px;table-layout:fixed}
th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4;overflow-wrap:anywhere}
th{background:#161b22;color:#9da7b3;font-weight:600} td.n{font-family:ui-monospace,Menlo,monospace}
.ok{color:#3fb950;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#1f2630;padding:1px 4px;border-radius:4px}
.note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22}`;
const row = (c, cls = []) => `<tr>${c.map((x, i) => `<td class="${cls[i] ?? ''}">${x}</td>`).join('')}</tr>`;
const ok = (t) => `<span class="ok">${t}</span>`, warn = (t) => `<span class="warn">${t}</span>`, dim = (t) => `<span class="dim">${t}</span>`;
const v2 = fs.existsSync(`${RIG}/out/r5m-verify-2.log`) ? (fs.readFileSync(`${RIG}/out/r5m-verify-2.log`, 'utf8').match(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/m) ?? []) : [];
const merged = v2.length ? `${v2[1]} run, ${Number(v2[2]) + Number(v2[3])} failures/errors` : 'rerun pending';
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card">
<h1>PR #13247 · round 5 — <code>f583ec3774</code> (V46, contract v1.32.0)</h1>
<p class="sub">Since round 4 the PR only merged main (#13265 H3 background Shell and Monitor took V45 → W2 renumbered to V46, contract 1.31 → 1.32). The W2 resolver, coordinator, service, lexical rule and tests are unchanged. Main has moved 6 commits since (incl. #13291 durable local tool outcomes); verified on <code>head ⊕ main f765bcf5d3</code> (clean merge, uniqueness check passes).</p>
<table><colgroup><col style="width:740px"><col style="width:260px"></colgroup><tr><th>scenario (head ⊕ main unless noted)</th><th>result</th></tr>
${row(['S1 · S4 races · S9/S13/S17 · S14 Action gate · S8 opt-in off · S19 · S20 same-tenant burst', ok(`${sc('r5t/s1-basic.json')} · ${sc('r5t/s4-races.json')} · ${sc('r5t/s9-later-turns-nolock.json')}/${sc('r5t/s13-reverse-race.json')}/${sc('r5t/s17-interplay.json')} · ${sc('r5t/s14-actions.json')} · ${sc('r5t/s8-optin-off.json')} · ${sc('r5t/s19-barrier-population.json')} · ${sc('r5t/s20-tenant-burst.json')}`)], ['', 'n'])}
${row(['S2 / S2b (expected updates) · S3 probe verdicts incl. structural ancestors', ok(`50 · 13/14 · ${sc('r5t/s3-settlement.json')}`)], ['', 'n'])}
${row(['F1 stays fixed (S11 3/3, G0 typed) · S23 G0 into 111/444/000 typed, 0 leases · S22 acquire legacy verdicts · S15b · S16', ok(`3/3 · ${sc('r5t/s23-g0-modes.json')} · ${sc('r5t/s22-acquire-legacy.json')} · ${sc('r5t/s15b-mount-root.json')} · ${sc('r5t/s16-destroyed-current.json')}`)], ['', 'n'])}
${row(['S5 retry / kill -9 in commit and claim / facts move · S7 main jar V45 → V46 → rollback → roll-forward', ok(`11/11 · ${sc('u5/s7-upgrade-r5m.json')}`) + dim(' (D1 from DB row)')], ['', 'n'])}
${row(['<code>clean verify checkstyle:check</code> (SpotBugs) · Hosted IT H2 / MySQL', ok('head 1009 run, 0 failures · 3/3 · 3/3') + '<br>' + ok(`merge ${merged} · 3/3 · 3/3`) + dim('<br>(1st merge run: 4 errors = port bind in Issue13180HardenedVerificationTest; 3/3 reruns on merge and on main)')], ['', 'n'])}
${row(['<b>F2</b> ENAMETOOLONG retryable: "a"×300 holds the Session (S21)', warn('still 124 s') + dim(' unchanged')], ['', 'n'])}
${row(['<b>T3</b> acquire-path access checks pinned only by the real stack (R6/R7)', warn('still open') + dim(' — round-4 candidate still applies cleanly')], ['', 'n'])}
${row(['V46 also claimed by open #13260 and #13354', warn('merge-time race')], ['', 'n'])}
</table>
<div class="note">Not testable yet: #13265's <code>child_run</code>/<code>monitor_run</code> domains are still off in production config. When they are enabled, a background Shell outlives its Turn while the W2 barrier only counts active Turns, open operations and requested Actions — the handshake (and the "fresh Runtime Session per Turn" premise) should be re-checked then.</div>
</div>`;
const browser = await chromium.launch();
const pg = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 900 } });
fs.writeFileSync(`${OUT}/r5-01-overview.html`, html);
await pg.goto(`file://${OUT}/r5-01-overview.html`);
await pg.locator('#card').screenshot({ path: `${OUT}/r5-01-overview.png` });
console.log(`${OUT}/r5-01-overview.png`);
await browser.close();
