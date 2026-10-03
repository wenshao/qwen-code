// VERIFICATION RIG ONLY (PR #13163): lays the measured results and the raw page screenshots out as evidence figures.
// Every number comes from the probe ledgers under out/<db>/; image regions are unmodified crops of fig/raw/*.png.
// usage: node figures13163.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13163-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/out`;
fs.mkdirSync(OUT, { recursive: true });
const W = 1080;
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W + 56}px;padding:22px 28px 24px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  h2{font-size:14.5px;margin:16px 0 8px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:6px;table-layout:fixed}
  td,th{overflow-wrap:anywhere}
  tr > :first-child{width:26%}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.amb{color:#d29922;font-weight:600}.dim{color:#8b949e}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#1f2630;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22;width:${W - 22}px}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}
  .shots{display:flex;gap:16px}
  .shot{flex:1}
  .label{font-size:13px;font-weight:600;padding:6px 10px;border-radius:6px 6px 0 0;display:inline-block}
  .label.g{background:#173a25;color:#8fe3a8}.label.r{background:#3d1f22;color:#ffb3ad}
  .strip{background-repeat:no-repeat;background-color:#fff;border:1px solid #30363d}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const t = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${/^\s*<span class="(ok|bad|amb|dim)">/.test(c) || /^[0-9+]/.test(c) ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const ok = (s) => `<span class="ok">${s}</span>`;
const bad = (s) => `<span class="bad">${s}</span>`;
const amb = (s) => `<span class="amb">${s}</span>`;
const dim = (s) => `<span class="dim">${s}</span>`;

const figs = {};
const OUT3 = `${RIG}/fig/out3`;
fs.mkdirSync(OUT3, { recursive: true });
figs['r3-01-results'] = page(
  'Round 3 at c11d0b5c: the bot\'s round-3 Criticals, the new WebShell Cancel, the cold-cache fix, and what still limits the headline',
  'Same real stack, rebuilt three times as the head moved (41cb6519 → 60030e4b → c11d0b5c, the last a merge of main <code>2a6879e6</code>); every row below was re-run on <code>c11d0b5c</code> unless it says otherwise. Each arm uses its own Harness bundle. Base: main <code>ba097945</code> / <code>2a6879e6</code>. Fake model holds the model call; real model is qwen3.8-max. On macOS the durable local-process default from #13211 is opted out on both arms.',
  `<h2>Bot round 3 (at 3363fff4) against this head</h2>` +
    t(['Finding', 'Measured at <code>c11d0b5c</code>'], [
      ['R3-1 replay answered to non-creator readers', `${ok('fixed')}: bob / carol replaying alice's submit and rename keys get 409 / 409 (round 2: 202 / 200); mallory 404 / 404; alice after <code>can_create</code> revoked still 202 / 200`],
      ['R3-2 WebShell hides Cancel when <code>workspaceTurns</code> is false', `${ok('fixed')}: creator sees "Cancel turn" with the composer hidden under revoke, DRAINING and re-registration; click → 202 → ${ok('CANCELLED')} in ~1.6 s, no file (3/3 at 41cb6519; revoke re-run on c11d0b5c)`],
      ['R3-3 cancel "reuses the attachment" only while it is resident', `${ok('fixed in 60030e4b')}: after a Spring restart the cancel re-attaches through a cancellation-only authority and a passive load the Harness now answers; see below`],
      ['R3-4 README carried two cancel rules', ok('fixed: both paragraphs state the same rule')],
    ]) +
    `<h2>Still true from round 2</h2>` +
    t(['Scenario', 'Result at <code>c11d0b5c</code>'], [
      ['creator cancel under revoke / DRAINING / re-registration / storage change', `${ok('202')} in 5–11 ms → ${ok('CANCELLED')} in 256–278 ms, no file; restored-1-s variants also CANCELLED (main <code>2a6879e6</code>: 409, then COMPLETED and wrote the file)`],
      ['re-registration admission; rename 4xx/5xx/drop + same key', `${ok('409, no rows')}; ${ok('503 + FAILED → 200 replay')}`],
      ['lost cancel delivery', `re-sent at ${ok('19.5 s')} → CANCELLED, no file`],
    ]) +
    `<h2>New measurements this round</h2>` +
    t(['Scenario', 'main', 'this PR <code>c11d0b5c</code>'], [
      ['reader bob opens the running bound Turn and clicks Cancel', dim('no Cancel (the control needs <code>workspaceTurns</code>, false for a reader)'), `Cancel ${amb('shown')}; click → 409; page shows "Hosted Workspace execution is not available."; Turn keeps running`],
      ['late rename: K1→A held in the Harness call, K1 retried and refused, K2→B completes, then K1\'s held call lands (bound and unbound)', `K1 → 200; ${bad('database title reverts to A')}; Harness last wrote A`, `K1 → 409 session_mutation_superseded; ${ok('database keeps B')}; ${amb('Harness last wrote A')} (author's P2)`],
      ['Spring restarted while a bound Turn runs, then the creator cancels (grants intact)', `202 → ${bad('CANCELLING')} 150 s; 0 POST /cancel; every re-load 409 (also on <code>2a6879e6</code>)`, `202 → passive <code>load 200</code> → POST /cancel 204 → ${ok('CANCELLED')} at 2.8 s, model aborted, no file (41cb6519 behaved like main)`],
      ['same, <code>can_create</code> revoked', dim('cancel refused 409'), `202 → ${ok('CANCELLED')} at 2.8 s, no file`],
    ['Spring restarted, no cancel', dim('not run'), `${amb('RUNNING')} after 150 s; the model\'s write never runs (the embedded Broker restarted with Spring). Recovery after Broker/worker death is out of scope (#13083)`],
      ['<b>real model</b>, WebShell: revoke after step-02, creator clicks Cancel', dim('no Cancel shown'), `7 runs across the three heads: ${ok('3 CANCELLED')} in ~1.2 s; ${bad('4 CANCELLING')} — the model\'s next write hit the refusal before the click (Harness "recovery blocked"); files 2 → 2 in all seven`],
    ]) +
    `<div class="note">At 41cb6519 the restart case was wider than the README and #13269 described (the cancel was lost even with grants intact, because every re-load got 409). 60030e4b fixed exactly that: the Harness answers a passive load of a resident Session with the original client, and the connector re-attaches for the persisted cancellation without the new-work grants. In none of these runs was an extra file written.</div>` +
    `<h2>Suites and mutation</h2>` +
    t(['Check', 'Result'], [
      ['CI-equivalent lane (<code>-Pmysql-integration verify checkstyle:check</code>, MySQL 8.4.7, TZ=UTC)', ok('562 unit (1 skipped) + 52 IT, 0 failures, 0 Checkstyle violations')],
      ['Harness <code>hosted-harness-session.test.ts</code>', `${ok('180/180')} (one run under mutation load: 175/180, all in the takeover group; that group also fails 1–3 cases per run on main <code>2a6879e6</code> under load, and passed 2/2 on the head)`],
      ['WebShell vitest (managed page + provider + schema)', ok('61/61')],
      ['CI at <code>c11d0b5c</code>', `${ok('19 green')}, 3 pending at writing (Hosted MySQL, web-shell E2E Smoke, visuals), 1 failed: <code>assign</code> (not a code check); serve A/B: no response changes`],
      ['Java mutants on the PR delta (13)', `${ok('killed 11 of 13')}: N6 canRead clause and N10 storage_id (both survived rounds 1–2, now pinned), N7, N8, N18b, N19, N20, N21, N22 cold cancel back to the grant check, N23 CANCELLING condition, N25 cancel back to the new-work attach. ${bad('survive 2')}: N17b submit read check (only matters for a creator who lost read replaying her own submit), N24 the cancellation authority\'s "submitted Turn" condition`],
      ['WebShell mutants (2) / Harness TS mutants (3)', `${ok('killed 2 / 3')}: re-coupling <code>canCancel</code>; dropping the Cancel outside the composer / passive load answers 409 again; skip the tenant–Workspace–store check; skip the profile conflict check`],
    ]),
);
const crop = (name, y0, y1, x0 = 526, wsrc = 1810, wout = W / 2 - 8) => `<div class="strip" style="width:${wout}px;height:${Math.round((y1 - y0) * (wout / wsrc))}px;background-image:url('file://${RAW}/${name}.png');background-size:${Math.round(2360 * (wout / wsrc))}px auto;background-position:-${Math.round(x0 * (wout / wsrc))}px -${Math.round(y0 * (wout / wsrc))}px"></div>`;
const block = (label, tone, inner) => `<div class="shot"><div class="label ${tone}">${label}</div>${inner}</div>`;
figs['r3-02-webshell'] = page(
  'WebShell at c11d0b5c: Cancel stays reachable for the creator when new work is refused',
  'Real Managed panel (vite from this head) against the real stack. Crops of unmodified 2x screenshots; ⋯ marks a cut.',
  `<div class="shots">${block('creator, can_create revoked: no composer, "Cancel turn" shown', 'g', crop('c13-revoke-1-before-en', 120, 345) + '<div class="cut">⋯</div>' + crop('c13-revoke-1-before-en', 1440, 1700))}${block('after the click: Cancelled, control removed', 'g', crop('c13-revoke-2-after-en', 120, 345))}</div>` +
    `<div class="shots" style="margin-top:14px">${block('reader bob: Cancel shown, click → 409 message, Turn keeps running', 'r', crop('c13-reader-2-after-en', 100, 420, 0, 2360) + '<div class="cut">⋯</div>' + crop('c13-reader-2-after-en', 1500, 1720, 0, 2360))}${block('real model (qwen3.8-max) after the revoke: Cancel shown', 'g', crop('c15-real-1-revoked-en', 120, 345) + '<div class="cut">⋯</div>' + crop('c15-real-1-revoked-en', 780, 1000) + '<div class="cut">⋯</div>' + crop('c15-real-1-revoked-en', 1440, 1700))}</div>` +
    `<div class="note">Creator under revoke, DRAINING and re-registration: Cancel shown and the click ends the Turn CANCELLED in ~1.6 s, no file (3/3 at 41cb6519; revoke re-run here). Real model: 3 of 7 clicks ended the Turn in ~1.2 s; in the other 4 the model's next write had already hit the refusal, so the Turn stayed CANCELLING (inherited Harness wedge, #13054). The reader sees the same button; the server's 409 is the gate and the page reports it with the generic "Hosted Workspace execution is not available."</div>`,
);
const browser = await chromium.launch({ headless: true });
for (const [name, html] of Object.entries(figs)) {
  const file = `${OUT3}/${name}.html`;
  fs.writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width: W + 56, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`file://${file}`);
  await p.waitForTimeout(300);
  await p.locator('#card').screenshot({ path: `${OUT3}/${name}.png` });
  await ctx.close();
  console.log(`${OUT3}/${name}.png`);
}
await browser.close();
