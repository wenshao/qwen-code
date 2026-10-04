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

// ---- round 4 (head 30f092d0) ----
const figs = {};
const OUT4 = `${RIG}/fig/out4`;
fs.mkdirSync(OUT4, { recursive: true });
const c = (s) => `<code>${s}</code>`;
figs['r4-01-results'] = page(
  'Round 4 at 30f092d0: the page-capability regression, R4-1, the author\'s runtime_warm_failed, and triage F4 on the real stack',
  'Real stack on macOS: managed-agent-server fat jar (embedded Runtime Broker), packaged Hosted Harness, MySQL 8.4.7, WebShell from the same tree. Arms: this PR <code>30f092d0</code>, its merge base with main <code>aca4d03c</code>, and <code>288e7feb</code> (the head before the last fix). Each arm uses its own jar and bundle. Both arms opt out of the durable local-process default (Linux-only).',
  `<h2>What moved since round 3 (52704a9d)</h2>` +
    t(['Change', 'Measured'], [
      ['<code>30f092d0</code> page twin of the submit capability now compares the registry generation and storage', `After a re-registration, alice's Sessions show <code>workspaceTurns</code> = ${ok('false / false')} on sessions/query and sessions/get, and submit gets ${ok('409, no rows')}. A Session in an untouched Workspace keeps ${ok('true')}. After restore it is back to true. Java mutants N26 (generation), N27 (storage) and N28 (both) are all ${ok('killed')}.`],
      ['<code>288e7feb</code> (before that fix)', `${bad('true / true')} after a re-registration or storage change, but submit is refused 409. The page offers a composer the server will refuse.`],
      ['main <code>aca4d03c</code>', `${bad('true / true')}, and submit is ${bad('accepted')}: 202, then the new Turn FAILS with workspace_unavailable.`],
      ['<code>a18ea0e4</code> R4-1: a passive recovery records the lease it adopted before any read that can fail', `Harness mutants are ${ok('killed')}: T4 (resident callback) by the 4 resident-adoption tests, T7 (cold-load callback) by the 2 cold-adoption tests, T8 (the report in ${c('recoverHostedRuntimeTurn')}) by 6, and T9 (owed-adoption note in the resident catch) by 2. ${amb('Not driven end to end')}: that needs a takeover with a Runtime execution in flight.`],
      ['6 merges of main', `Hand resolutions are in only two of them. <code>762f4a2d</code> keeps main's drive-load redrive and routes passive loads to the PR's stricter resident path. Its ${c('leaseAlreadyHeld')} only gates the non-passive compensation release, so a passive load does not need it. <code>04b778a2</code> drops ${c('isSessionCreator')} and keeps main's batch reads. The regression came in with <code>04b778a2</code>, which merged main #13217. That brought a batched page twin that never had the PR's binding check. CI caught it at <code>288e7feb</code>, the head pushed together with that merge.`],
    ]) +
    `<h2>Still true at 30f092d0</h2>` +
    t(['Scenario', 'main aca4d03c', 'this PR 30f092d0'], [
      ['creator cancels under revoke / DRAINING / re-registration / storage change', `revoke and DRAINING: ${bad('409')}, then the Turn runs on (FAILED or COMPLETED after ~30 s)`, `${ok('202')} in 5–7 ms → ${ok('CANCELLED')} in 248–265 ms (early restore: 1.08 s), model aborted, 0 tool executions`],
      ['bob / carol / mallory; creator without read', dim('—'), `${ok('409 / 409 / 404; 404')}. The Turn is not stopped.`],
      ['Spring restarted under a running bound Turn, then the creator cancels', `revoke: ${bad('409')}, RUNNING after 150 s. Grants intact: 202 → ${bad('CANCELLING')} after 150 s.`, `passive ${c('load 200')} → ${c('POST /cancel 204')} → ${ok('CANCELLED')} at 3.07 s (revoke) / 2.84 s (grants intact)`],
      ['real model (qwen3.8-max): revoke after step-02, Cancel clicked in the WebShell', dim('no Cancel shown'), `${ok('2 / 2 CANCELLED')} in 1.17 s / 1.20 s; step files 2 → 2`],
      ['c1 / c5 / c7 / c8 / c3 batch', '—', ok('23 / 23 sections pass')],
    ]) +
    `<h2>The author's runtime_warm_failed: inherited; the cancel now works through it</h2>` +
    t(['Revoke + DRAINING, restart Spring, leave the Turn running past the 60 s lease, then cancel', 'main aca4d03c', 'this PR 30f092d0'], [
      ['environment events of the Turn', `provisioning, ready, then ${bad('failed {runtime_warm_failed}')} (seq 15), before any cancel`, `the same: ${bad('failed {runtime_warm_failed}')} (seq 15), before any cancel`],
      ['cause (Spring log, both arms)', `re-claim → ${c('HarnessCoordinator.runClaimed')} → ${c('warmRuntime')} → Broker warm: "Workspace execution authority is unavailable."`, `the same`],
      ['WebShell after the cancel', `${bad('no Cancel button')}. The API cancel gets 409, and the Turn stays RUNNING.`, `Cancel shown → 202 → ${ok('CANCELLED')} in 1.6 s; ${amb('"Preparation failed / runtime_warm_failed" stays')}`],
      ['same without the Spring restart', dim('—'), `no environment.failed; cancel → CANCELLED in 295 ms`],
    ]) +
    `<div class="note">A re-claim of a Turn that is not cancelling warms the Runtime again, and the warm uses the authority that admits new work. Under a refused grant, that appends environment.failed after the Turn's own environment.ready. The two events use separate keys (runtime:ready / runtime:failed), and the WebShell shows the latest one. The PR does not change this path, so the error is inherited. A follow-up could skip the warm when re-claiming an already-warm Turn, or clear the banner once the Turn is terminal.</div>` +
    `<h2>Inherited, newly found: a Session Store outage while the Harness writes wedges the Turn</h2>` +
    t(['A bound Turn streams a text delta every 200 ms; Spring (which hosts the Session Store) restarts mid-stream', 'main aca4d03c', 'this PR 30f092d0'], [
      ['Harness', `"session log writes stopped after an earlier failure: Managed Session Store request failed: fetch failed"; turn could not settle`, 'the same'],
      ['Turn 35 s after the stream ended / creator cancel / next submit', `${bad('RUNNING')} / 202 → ${bad('CANCELLING')} after 60 s / 409 turn_active`, `${bad('RUNNING')} / 202 → ${bad('CANCELLING')} after 60 s / 409 turn_active`],
    ]) +
    `<div class="note bad">Once a write fails, the Harness's session writer stops for good. The Turn in flight can then never settle (complete or cancel), and the Session refuses new Turns. Same on main, so it is not caused by this PR. I found no issue tracking it. One of my UI runs hit this race by chance: Spring stopped about 0.5 s after the Turn started. That is why the run stayed CANCELLING. The rerun with a 3 s gap is the one shown in figure 2.</div>`,
);
figs['r4-03-triage-and-suites'] = page(
  'Round 4 at 30f092d0: triage F1–F5 on the real stack, suites and mutation',
  'Triage verify at 30f092d0 reports F1–F5 (F4 raised to Medium from a unit probe with a RUNNING Turn under a DELETED Session). These rows add what the real stack shows.',
  `<h2>Triage findings</h2>` +
    t(['Finding', 'Real stack / this round'], [
      ['F4 <code>requireCanceller</code> drops the lifecycle checks (ACTIVE, not deleted, qwen-code, context ref)', `A Session cannot leave ACTIVE while a Turn is active. An unbound close or delete gets ${ok('409 turn_active')}. A bound close goes through the same ${c('validateOperationStart')} check; this macOS rig refuses it earlier with workspace_unavailable. So through the public API, a live Turn never meets a non-ACTIVE Session. What is reachable: once the Turn has ended, set the bound Session to CLOSED, ARCHIVED or DELETED by SQL, since this rig cannot close a bound Session. The creator's cancel then gets ${amb('202')} on the public and WebShell routes and writes ${amb('2 command rows')}, even though GET says 404 for DELETED. On main it gets 409 workspace_unavailable and writes 0 rows. Unbound Sessions already answer 202 and write a row on both arms. The triage fix, ${c('maySubmitShape(session)')} in ${c('requireCanceller')}, would restore main's answer without touching the revoke, DRAINING and re-registration cancels, because those Sessions stay ACTIVE.`],
      ['F1 resident passive catch swallows the cause', `${amb('unchanged')}: ${c('} catch {')} at hosted-harness-session.ts:1606, no stderr line`],
      ['F2 / F3 unpinned operands', `${amb('confirmed')}: T5 (drop ${c('!resident.active')}) and T6 (drop the post-await ${c('sessions.get')} re-check) both pass 219/219 on a quiet host`],
      ['F5 contract tightened without a version bump', `${amb('unchanged')}: ${c('info.version')} is still 1.29.0`],
      ['also observed', `An unbound DELETED Session's submit now answers 404 session_not_found (main: 409 session_not_active). That matches GET.`],
    ]) +
    `<h2>Suites, mutation and CI</h2>` +
    t(['Check', 'Result'], [
      ['CI-equivalent lane (<code>-Pmysql-integration verify checkstyle:check</code>, MySQL 8.4.7, TZ=UTC)', ok('646 unit (1 skipped) + 52 IT, 0 failures, 0 Checkstyle violations')],
      ['Harness tests (session + runtime-recovery)', `${ok('219 / 219')} on a quiet host (216 / 219 under mutation load, the 3 failures all in recovery/takeover tests, as in round 3)`],
      ['WebShell (managed page + provider)', ok('62 / 62')],
      ['Java mutants (10)', `${ok('killed 7')}: N6 (canRead), N9 (singular bindingCurrent), N10 (its storage_id), N11 (its generation), N26, N27, N28 (page twin). ${amb('survive 2')}: N17b (submit read check), N24 (submitted-Turn condition), same as round 3. BASE 646 / 0`],
      ['Harness mutants (9)', `${ok('killed 7')}: T1–T4, T7–T9. ${amb('survive 2')}: T5, T6 (= F2, F3)`],
      ['CI at 30f092d0', `${ok('26 green')} (Hosted MySQL, MariaDB, web-shell E2E Smoke and visuals included), <code>review-pr</code> pending. The triage bot approved this head; its verify run reports findings (F1–F5).`],
      ['inherited wedge #13054 (tool call hits the refusal)', `still present: "recovery blocked" at +6 s, then cancel 202 → ${bad('CANCELLING')} after 70 s, then 409 turn_active`],
    ]),
);
const crop = (name, y0, y1, x0 = 526, wsrc = 1810, wout = W / 2 - 8) => `<div class="strip" style="width:${wout}px;height:${Math.round((y1 - y0) * (wout / wsrc))}px;background-image:url('file://${RAW}/${name}.png');background-size:${Math.round(2360 * (wout / wsrc))}px auto;background-position:-${Math.round(x0 * (wout / wsrc))}px -${Math.round(y0 * (wout / wsrc))}px"></div>`;
const block = (label, tone, inner) => `<div class="shot"><div class="label ${tone}">${label}</div>${inner}</div>`;
const cut = '<div class="dim" style="text-align:center;font-size:12px">⋯</div>';
figs['r4-02-webshell'] = page(
  'WebShell, the author\'s scenario: revoke + DRAINING + Spring restart, Turn re-claimed, then the creator acts',
  'Real Managed panel. vite serves each arm\'s own WebShell against its own stack. These are crops of unmodified 2x screenshots; ⋯ marks a cut. The environment error appeared before any click on both arms.',
  `<div class="shots">${block('main aca4d03c: runtime_warm_failed, no Cancel; the Turn keeps running', 'r', crop('c17-base-1-before-en', 112, 413) + cut + crop('c17-base-1-before-en', 1470, 1712))}${block('this PR, before the click: the same error, Cancel turn shown', 'g', crop('c17-head-1-before-en', 112, 413) + cut + crop('c17-head-1-before-en', 1470, 1712))}</div>` +
    `<div class="shots" style="margin-top:14px">${block('main aca4d03c: nothing to click; the API cancel gets 409 and the Turn stays RUNNING', 'r', crop('c17-base-2-after-en', 112, 413) + cut + crop('c17-base-2-after-en', 1470, 1712))}${block('this PR, 1.6 s after the click: Cancelled; the stale banner stays', 'g', crop('c17-head-2-after-en', 112, 413))}</div>` +
    `<div class="note">Cancel works under the refused authority on this PR. The "Preparation failed / runtime_warm_failed" banner is the inherited re-claim warm described in figure 1, and it stays after the Turn is terminal.</div>`,
);
const browser = await chromium.launch({ headless: true });
for (const [name, html] of Object.entries(figs)) {
  const file = `${OUT4}/${name}.html`;
  fs.writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width: W + 56, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`file://${file}`);
  await p.waitForTimeout(400);
  await p.locator('#card').screenshot({ path: `${OUT4}/${name}.png` });
  await ctx.close();
  console.log(`${OUT4}/${name}.png`);
}
await browser.close();
