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
const crop = (name, y0, y1, x0 = 526, wsrc = 1810, wout = W / 2 - 8) => `<div class="strip" style="width:${wout}px;height:${Math.round((y1 - y0) * (wout / wsrc))}px;background-image:url('file://${RAW}/${name}.png');background-size:${Math.round(2360 * (wout / wsrc))}px auto;background-position:-${Math.round(x0 * (wout / wsrc))}px -${Math.round(y0 * (wout / wsrc))}px"></div>`;
const block = (label, tone, inner) => `<div class="shot"><div class="label ${tone}">${label}</div>${inner}</div>`;
const cut = '<div class="dim" style="text-align:center;font-size:12px">⋯</div>';

// ---- round 7 (head f2864f6a, macOS) ----
const figs = {};
const OUT7 = `${RIG}/fig/out7`;
fs.mkdirSync(OUT7, { recursive: true });
const c = (s) => `<code>${s}</code>`;
figs['r7-01-results'] = page(
  'Round 7 at f2864f6a (macOS): the cold-cancel regression and its fix, R1-5, and round 6\'s rename finding',
  'Real stack on macOS: managed-agent-server fat jar (embedded Runtime Broker), packaged Hosted Harness, MySQL 8.4.7, WebShell. Arms: this PR <code>f2864f6a</code>; <code>2748c36d</code> (the head before the last fix); main at the merge base <code>9d4e1e1c</code>. Each arm uses its own jar and bundle; all opt out of the Linux-only durable local-process default.',
  `<h2>Cancel after a Spring restart (cold attachment cache), creator still reads the Workspace</h2>` +
    t(['Case', 'main 9d4e1e1c', '2748c36d', 'this PR f2864f6a'], [
      ['can_create revoked', `cancel ${bad('409')}; Turn RUNNING after 150 s`, `202; every load ${bad('409')}, 0 POST /cancel; ${bad('CANCELLING after 150 s')}`, `202; passive load 200 → cancel 204 → ${ok('CANCELLED')} at 42.6 s / 43.1 s (2 of 2 clean runs); a third run ${amb('hit #13413')}`],
      ['grants intact', `202; load ${bad('409')}; ${bad('CANCELLING after 150 s')}`, `same as revoked: ${bad('CANCELLING after 150 s')}`, `${ok('CANCELLED')} at 42.0 s`],
    ]) +
    `<div class="note ok">The G3 re-merge (504ecd96) sent a cold reattach for a still-running owner into the ownerless settlement arm, which refuses a live owner. f2864f6a adds <code>resident.active === undefined</code> to that arm, so the live owner takes the passive reattach again. The 42 s is the stopped owner's 60 s lease running out before delivery, as in rounds 5 and 6. The Harness mutant that removes the predicate is killed by the new "aborted live turn … Java-style cold reattach" test.</div>` +
    `<h2>R1-5: the creator approves, the first delivery gets a retryable 503, can_create is revoked during the backoff</h2>` +
    t(['', 'main 9d4e1e1c', 'this PR f2864f6a'], [
      ['answer operation', `${bad('COMPLETED')}: the retry delivers the answer after the revocation (resolve 200), Action <code>decided</code>`, `${ok('FAILED workspace_unavailable')} 1.4 s after the revocation; Action stays <code>requested</code>`],
      ['creator cancels afterwards', `${bad('409')}; Turn RUNNING`, `202 → ${ok('CANCELLED')} in 0.46 s; no file written`],
    ]) +
    `<h2>Renames (bound and unbound give the same result)</h2>` +
    t(['Sequence', 'main 9d4e1e1c', 'this PR f2864f6a'], [
      ['R6-2: K1 fails, K2 → B completes, two overlapping K1 retries (one held 8 s and succeeds, one refused)', 'R2 200 A; DB A / Harness A', `R2 ${ok('200 A')}; DB A / Harness A — ${ok('fixed')} (round 5: 409, DB B / Harness A)`],
      ['Round 6\'s V48 case: K1 #1 reaches the Harness, answer held 7 s; #2 fails; K2 → Bravo; #3 (after Bravo) fails; then #1\'s answer arrives', `#1 200 Alpha; ${bad('DB Alpha / Harness Bravo')}; next K1 retry is a replay that never reaches the Harness`, `${amb('the same as main')}: #1 200 Alpha; ${bad('DB Alpha / Harness Bravo')}; next retry is a replay (Harness calls 4 → 4)`],
    ]) +
    `<div class="note">Round 6 measured 409 for #1 at 25eb9ae2 (the stores then converged on the next retry). The stored V48 boundary is moved by #3's revival, so at this head the guard lets #1 complete. Round 6's per-attempt-boundary prototype is not applied; ManagedAgentStore and ManagedAgentService are unchanged since 13df2a65.</div>`,
);
figs['r7-02-suites'] = page(
  'Round 7 at f2864f6a: regression set, real model, suites, mutation and CI',
  'Mutants are applied one at a time to a clean copy of the head. Java runs the whole managed-agent-server unit suite; Harness mutants run hosted-harness-session.test.ts and hosted-runtime-recovery.test.ts.',
  t(['Check', 'Result'], [
    ['cancel matrix (revoke / DRAINING / re-registration / storage change, non-creators)', ok('23 / 23 sections pass')],
    ['capability after re-registration; F4 (cancel on CLOSED / ARCHIVED / DELETED bound Session)', `${ok('false, submit 409')}; ${ok('409, 0 command rows')}`],
    ['round 5 fence probe (two overlapping passive loads, DELETE after the first finishes)', `${ok('409, 0 releases')}, second load 200 (round 5: 204 and a release)`],
    ['WebShell: revoke + DRAINING + restart, Turn re-claimed', `Cancel → ${ok('CANCELLED')} in 1.8 s; ${amb('runtime_warm_failed banner stays')} (inherited)`],
    ['real model (qwen3.8-max): revoke after step-02, Cancel clicked', `${ok('2 of 3 CANCELLED')} (1.23–1.24 s); ${bad('1 CANCELLING')} — the model's next write hit the refusal first (#13054); files 2 → 2`],
    ['CI-equivalent Java lane (MySQL 8.4.7, TZ=UTC)', ok('1263 unit (1 skipped) + 53 IT, 0 failures, 0 Checkstyle violations')],
    ['Harness tests (session + runtime-recovery); WebShell', `${ok('288 / 288')} (quiet host); ${ok('83 / 83')} incl. the generated-client drift gate`],
    ['Java mutants (12)', `${ok('killed 10')}: N6, N8, N9, N21, N22, N29, ${ok('N31, N32')} (R1-5), ${ok('N33')} (R1-1 snapshot), N34 (cancel back to the new-work attachment). ${amb('survive 2')}: N24 (as before), ${amb('N35')} — <code>cancelManagedRuntime</code> back to the new-work attachment has no test`],
    ['Harness mutants (8)', `${ok('killed 8')}: T17 (f2864f6a predicate), T13 / T14 / T18 (counted fence), T10 / T11 / T2 (store and tenant checks), T4 (lease callback)`],
    ['CI at f2864f6a', `${ok('26 green')} incl. MariaDB and Hosted MySQL process gates; <code>review-pr</code> pending. The review bot approved this head at 07:49 UTC`],
  ]),
);
figs['r7-03-webshell'] = page(
  'WebShell at f2864f6a: revoke + DRAINING + Spring restart, Turn re-claimed, then the creator cancels',
  'Real Managed panel served from this head. Crops of unmodified 2x screenshots; ⋯ marks a cut.',
  `<div class="shots">${block('before the click: runtime_warm_failed, Cancel turn shown', 'g', crop('c17-head-1-before-en', 112, 413) + cut + crop('c17-head-1-before-en', 1470, 1712))}${block('1.8 s after the click: Cancelled; the banner stays', 'g', crop('c17-head-2-after-en', 112, 413))}</div>`,
);
const browser = await chromium.launch({ headless: true });
for (const [name, html] of Object.entries(figs)) {
  const file = `${OUT7}/${name}.html`;
  fs.writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width: W + 56, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`file://${file}`);
  await p.waitForTimeout(400);
  await p.locator('#card').screenshot({ path: `${OUT7}/${name}.png` });
  await ctx.close();
  console.log(`${OUT7}/${name}.png`);
}
await browser.close();
