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
  'Round 3 at 41cb6519: the bot\'s round-3 Criticals, the new WebShell Cancel, and what still limits the headline',
  'Same real stack, rebuilt for this head (Harness bundle unchanged: CLI/Harness/Broker identical to round 2). Arms: this head and its merge base <code>ba097945</code> (main with #13112). Fake model holds the model call; real model is qwen3.8-max.',
  `<h2>Bot round 3 (at 3363fff4) against this head</h2>` +
    t(['Finding', 'Measured at <code>41cb6519</code>'], [
      ['R3-1 replay answered to non-creator readers', `${ok('fixed')}: bob / carol replaying alice's submit and rename keys get 409 / 409 (round 2: 202 / 200); mallory 404 / 404; alice after <code>can_create</code> revoked still 202 / 200`],
      ['R3-2 WebShell hides Cancel when <code>workspaceTurns</code> is false', `${ok('fixed')}: creator sees "Cancel turn" with the composer hidden under revoke, DRAINING and re-registration; click → 202 → ${ok('CANCELLED')} in ~1.6 s, no file (3/3)`],
      ['R3-3 cancel "reuses the attachment" only while it is resident', `${amb('documented, deferred to #13269')} — measured scope is wider, see below`],
      ['R3-4 README carried two cancel rules', ok('fixed: both paragraphs state the same rule')],
    ]) +
    `<h2>Still true from round 2</h2>` +
    t(['Scenario', 'Result at <code>41cb6519</code>'], [
      ['creator cancel under revoke / DRAINING / re-registration / storage change', `${ok('202')} in 7–24 ms → ${ok('CANCELLED')} ≤ 0.55 s, no file; restored-1-s variants also CANCELLED`],
      ['re-registration admission; rename 4xx/5xx/drop + same key', `${ok('409, no rows')}; ${ok('503 + FAILED → 200 replay')}`],
      ['lost cancel delivery', `re-sent at ${ok('19.5 s')} → CANCELLED, no file`],
    ]) +
    `<h2>New measurements this round</h2>` +
    t(['Scenario', 'main <code>ba097945</code>', 'this PR <code>41cb6519</code>'], [
      ['reader bob opens the running bound Turn and clicks Cancel', dim('no Cancel (the control needs <code>workspaceTurns</code>, false for a reader)'), `Cancel ${amb('shown')}; click → 409; page shows "Hosted Workspace execution is not available."; Turn keeps running`],
      ['late rename: K1→A held in the Harness call, K1 retried and refused, K2→B completes, then K1\'s held call lands (bound and unbound)', `K1 → 200; ${bad('database title reverts to A')}; Harness last wrote A`, `K1 → 409 session_mutation_superseded; ${ok('database keeps B')}; ${amb('Harness last wrote A')} (author's P2)`],
      ['Spring restarted while a bound Turn runs, then the creator cancels (grants intact)', `202 → ${bad('CANCELLING')} 150 s; 0 POST /cancel; every re-load 409`, `202 → ${bad('CANCELLING')} 150 s; 0 POST /cancel; every re-load <code>409</code> (Harness still holds the session)`],
      ['same, <code>can_create</code> revoked', dim('cancel refused 409'), `202 → ${bad('CANCELLING')}; restoring the grant does not help`],
      ['<b>real model</b>, WebShell: revoke after step-02, creator clicks Cancel', dim('no Cancel shown'), `run 1: ${ok('CANCELLED')} in 1.2 s, files 2 → 2; runs 2–3: the next write raced the revoke → Harness "recovery blocked" → ${bad('CANCELLING')}; files 2 → 2 in all three`],
    ]) +
    `<div class="note">The restart case is wider than the README and #13269 describe ("while that authority refuses"): the cancel is lost after a Spring restart even with grants intact, because the new owner cannot re-load a Session the Harness still holds (409 on every attempt), so neither recovery nor the cancel gets through. Same behaviour on main; not introduced here. In none of these runs was an extra file written.</div>` +
    `<h2>Suites and mutation</h2>` +
    t(['Check', 'Result'], [
      ['CI-equivalent lane (<code>-Pmysql-integration verify checkstyle:check</code>, MySQL 8.4.7, TZ=UTC)', ok('551 unit + 51 IT, 0 failures, 0 Checkstyle violations')],
      ['WebShell vitest (managed page + provider)', ok('58/58')],
      ['CI at <code>41cb6519</code>', ok('21/21 jobs green')],
      ['Java mutants on the PR delta (10)', `${ok('killed 6')}: N7 creator clause, N8 cancel through submit gate, N18b rename read check, N19 / N20 <code>requireBoundCreator</code> (submit / rename), N21 supersession guard. ${bad('survive 3')}: N6 <code>requireCanceller</code> canRead clause, N10 <code>bindingCurrent</code> storage_id, N17b submit read check (now only matters for a creator who lost read replaying her own submit)`],
      ['WebShell mutants (2)', `${ok('killed 2')}: re-coupling <code>canCancel</code> to <code>workspaceTurns</code>; dropping the Cancel button outside the composer`],
    ]),
);
const crop = (name, y0, y1, x0 = 526, wsrc = 1810, wout = W / 2 - 8) => `<div class="strip" style="width:${wout}px;height:${Math.round((y1 - y0) * (wout / wsrc))}px;background-image:url('file://${RAW}/${name}.png');background-size:${Math.round(2360 * (wout / wsrc))}px auto;background-position:-${Math.round(x0 * (wout / wsrc))}px -${Math.round(y0 * (wout / wsrc))}px"></div>`;
const block = (label, tone, inner) => `<div class="shot"><div class="label ${tone}">${label}</div>${inner}</div>`;
figs['r3-02-webshell'] = page(
  'WebShell at 41cb6519: Cancel stays reachable for the creator when new work is refused',
  'Real Managed panel (vite from this head) against the real stack. Crops of unmodified 2x screenshots; ⋯ marks a cut.',
  `<div class="shots">${block('creator, can_create revoked: no composer, "Cancel turn" shown', 'g', crop('c13-revoke-1-before-en', 120, 345) + '<div class="cut">⋯</div>' + crop('c13-revoke-1-before-en', 1440, 1700))}${block('after the click: Cancelled, control removed', 'g', crop('c13-revoke-2-after-en', 120, 345))}</div>` +
    `<div class="shots" style="margin-top:14px">${block('reader bob: Cancel shown, click → 409 message, Turn keeps running', 'r', crop('c13-reader-2-after-en', 100, 420, 0, 2360) + '<div class="cut">⋯</div>' + crop('c13-reader-2-after-en', 1500, 1720, 0, 2360))}${block('real model (qwen3.8-max) after the revoke: Cancel shown', 'g', crop('c15-real-1-revoked-en', 120, 345) + '<div class="cut">⋯</div>' + crop('c15-real-1-revoked-en', 780, 1000) + '<div class="cut">⋯</div>' + crop('c15-real-1-revoked-en', 1440, 1700))}</div>` +
    `<div class="note">Creator under revoke, DRAINING and re-registration: Cancel shown and the click ends the Turn CANCELLED in ~1.6 s, no file (3/3). Real model: the click ended run 1 in 1.2 s; in runs 2–3 the model's next write had already hit the refusal, so the Turn stayed CANCELLING (inherited Harness wedge, #13054). The reader sees the same button; the server's 409 is the gate and the page reports it with the generic "Hosted Workspace execution is not available."</div>`,
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
