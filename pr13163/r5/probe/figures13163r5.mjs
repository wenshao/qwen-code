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

// ---- round 5 (head eb3b9336) ----
const figs = {};
const OUT5 = `${RIG}/fig/out5`;
fs.mkdirSync(OUT5, { recursive: true });
const c = (s) => `<code>${s}</code>`;
const TS = JSON.parse(fs.readFileSync(`${RIG}/out/tsmut10-summary.json`, 'utf8'));
figs['r5-01-results'] = page(
  'Round 5 at eb3b9336: what the four new commits do on the real stack, and the open R6-2 thread',
  'Real stack on macOS: managed-agent-server fat jar (embedded Runtime Broker), packaged Hosted Harness, MySQL 8.4.7, WebShell. Arms: this PR <code>eb3b9336</code>; main at the merge base <code>43a6e1e5</code>; round 4\'s head <code>30f092d0</code> where marked. Each arm uses its own jar and bundle; both opt out of the Linux-only durable local-process default.',
  `<h2>The four new commits</h2>` +
    t(['Commit', 'Measured'], [
      ['<code>df8bdc56</code> F4: cancel keeps the Session lifecycle term (<code>maySubmitShape</code>)', `A creator's cancel on a bound Session that is CLOSED, ARCHIVED or DELETED (state set by SQL) now gets ${ok('409 workspace_unavailable')} on the public and WebShell routes, with ${ok('0 command rows')}; main answers the same. Round 4's head answered 202 and wrote a row per call. Live cancels under revoke / DRAINING / re-registration are unchanged (23/23 batch). Java mutants N29 and N30 that undo it are ${ok('killed')} by the new <code>cancelRefusesABoundSessionThatCanNoLongerExecute</code>.`],
      ['<code>b8f92ced</code> resident reattach: one binding check before both branches; a drifted Session Store address answers 409 (was 404)', `Spring restarted with a different <code>session-store.base-url</code> spelling, then the creator cancels. This PR: every passive load gets 409, the Turn is ${amb('CANCELLING after 120 s')} and the cancel never reaches the Harness. main: the same (its resident load is 409 already_attached). <code>30f092d0</code>: one 404, the Turn is marked ${bad('FAILED at 41.9 s while it keeps running in the Harness')}. None of the three arms stops the Turn; this commit returns to main's retry.`],
      ['<code>b6eff8f4</code> a parked passive recovery holds close()\'s fence (<code>mcpRecovering</code>)', `${amb('Unit probe')}: with two overlapping passive loads, a DELETE is refused while both run, but the first load's <code>finally</code> clears the shared boolean while the second is still adopting; the next DELETE is ${bad('admitted (204) and releases the lease')}, and the second load answers 404. A one-line guard (refuse a passive load while the fence is held, retryable 409) closes it in the same probe: second load 409, DELETE 409, 0 releases. Harness mutants on the fence: see figure 3.`],
      ['<code>b683a3d6</code> owed-adoption notes on the post-await refusals', 'Covered by the Harness mutants in figure 3.'],
      ['6 merges of main', `Hand resolutions in 3. <code>eb3b9336</code> composes the OpenAPI prose: the PR's cancel sentences plus main's cwd_change (v1.32) sentence; the generated client was regenerated and the byte-exact drift gate passes (WebShell ${ok('64/64')}). <code>d210e2d4</code> keeps both the owed-adoption note and main's new stderr line. <code>6739048d</code> touches only WebShell test fixtures. Spec version is main's 1.32.0.`],
    ]) +
    `<h2>The open R6-2 thread (concurrent retries of a refused rename), on the real stack</h2>` +
    t(['K1 → A refused once (row FAILED); K2 → B completes; then two overlapping K1 retries: R2\'s Harness call held 8 s (succeeds), R3 refused (500)', 'main 43a6e1e5', 'this PR eb3b9336'], [
      ['R2 / R3', `${ok('200 A')} / 503`, `${bad('409 session_mutation_superseded')} / 503`],
      ['database title / last title the Harness applied', `${ok('A / A')}`, `${bad('B / A')}`],
      ['one more K1 retry (no fault)', '200 A', '200, database becomes A'],
    ]) +
    `<div class="note">Same result for bound and unbound Sessions. The retry whose Harness write landed is told it was superseded, and the two stores disagree until another retry. The second half of the thread (the guard query is not scoped by operation) is not reachable at this head: <code>abandonSessionMutation</code> has one caller, for RENAME, so an UNARCHIVE command never becomes FAILED and never enters the guard.</div>` +
    `<h2>Still true at eb3b9336</h2>` +
    t(['Scenario', 'main 43a6e1e5', 'this PR eb3b9336'], [
      ['creator cancels under revoke / DRAINING / re-registration / storage change', `revoke and DRAINING: ${bad('409')}, the Turn runs on`, `${ok('202')} → ${ok('CANCELLED')}; batch ${ok('23/23')} (host loaded by the mutation run: 0.4–1.5 s)`],
      ['capability after re-registration (list and get)', `${bad('true')}; submit 202 → FAILED`, `${ok('false')}; submit 409, no rows`],
      ['Spring restarted under a running bound Turn, then cancel', `revoke: ${bad('409')}, RUNNING`, `${ok('CANCELLED')} at 41.5 s / 44.1 s (delivered when the stopped owner's 60 s lease expired)`],
      ['WebShell: revoke + DRAINING + restart, Turn re-claimed', 'no Cancel; runtime_warm_failed', `Cancel → ${ok('CANCELLED')} in 2.0 s; ${amb('runtime_warm_failed banner stays')} (inherited)`],
      ['real model (qwen3.8-max): revoke after step-02, Cancel clicked', dim('no Cancel'), `${ok('1 of 3 CANCELLED')} (1.2 s); ${bad('2 of 3 CANCELLING')} — the model's next write hit the refusal first (#13054); files 2 → 2`],
    ]),
);
figs['r5-02-inherited'] = page(
  'Round 5: inherited problems that decide how well the headline works in practice',
  'The storage row was run on both arms with the same probe; #13413 was A/B-tested in round 4. Neither is caused by this PR.',
  t(['Problem', 'main 43a6e1e5', 'this PR eb3b9336'], [
    ['#13413 Session Store outage latches the Harness writer: Spring restarted < 1 s after a bound Turn started (host under load)', dim('not rerun this round (round 4: same on main)'), `${bad('2 of 2')} restarts latched ("session log writes stopped … /transactions:commit failed"): cancel 204 reaches the Harness, model aborted, Turn stays CANCELLING. With a 3 s gap before the restart: ${ok('2 of 2 CANCELLED')}`],
    ['#13054 wedge pins the storage: after a Turn is wedged ("recovery blocked"), a new Workspace on the same storage runs its first Turn', `${bad('RUNNING after 120 s')}; other storage: COMPLETED in 4.2 s`, `${bad('RUNNING after 120 s')}; other storage: COMPLETED in 3.8 s`],
  ]) +
    `<div class="note bad">The wedged Turn keeps the storage's execution lease, so #13054 blocks every Session on that storage, not just its own. In this rig it made two later probes that reused a storage fail, until I gave each scenario its own storage.</div>`,
);
figs['r5-03-mutation-suites'] = page(
  'Round 5 at eb3b9336: suites, mutation and CI',
  'Mutants are applied one at a time to a clean copy of the head; Java runs the whole managed-agent-server unit suite, Harness mutants run hosted-harness-session.test.ts and hosted-runtime-recovery.test.ts.',
  t(['Check', 'Result'], [
    ['CI-equivalent Java lane (<code>-Pmysql-integration verify checkstyle:check</code>, MySQL 8.4.7, TZ=UTC)', TS.lane],
    ['Harness tests (session + runtime-recovery)', TS.c0],
    ['WebShell (managed page + provider + generated-client drift gate)', ok('64 / 64')],
    ['Java mutants (13)', `${ok('killed 11')}: N6–N11 (cancel and binding checks), N26–N28 (page twin), ${ok('N29, N30')} (F4 fix). ${amb('survive 2')}: N17b (submit read check), N24 (submitted-Turn condition) — same as rounds 3–4. BASE 1031 / 0`],
    [`Harness mutants (${TS.total})`, TS.mut],
    ['CI at eb3b9336', `${ok('25 green')}. ${bad('2 red')}: <code>review-pr</code> and <code>fallback-comment</code> fail with "HTTP 403: Sorry. Your account was suspended" — the review bot's account. Its earlier reviews and comments are no longer visible, and <code>reviewDecision</code> still says CHANGES_REQUESTED with no visible review behind it.`],
  ]),
);
const shotsHead = `<div class="shots">${block('this PR, before the click: runtime_warm_failed, Cancel turn shown', 'g', crop('c17-head-1-before-en', 112, 413) + cut + crop('c17-head-1-before-en', 1470, 1712))}${block('2.0 s after the click: Cancelled; the banner stays', 'g', crop('c17-head-2-after-en', 112, 413))}</div>`;
figs['r5-04-webshell'] = page(
  'WebShell at eb3b9336: revoke + DRAINING + Spring restart, Turn re-claimed, then the creator cancels',
  'Real Managed panel served from this head. Crops of unmodified 2x screenshots; ⋯ marks a cut.',
  shotsHead + `<div class="note">Same as round 4: the cancel works under the refused authority; the environment error comes from the inherited re-claim warm and stays after the Turn ends.</div>`,
);
const browser = await chromium.launch({ headless: true });
for (const [name, html] of Object.entries(figs)) {
  const file = `${OUT5}/${name}.html`;
  fs.writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width: W + 56, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`file://${file}`);
  await p.waitForTimeout(400);
  await p.locator('#card').screenshot({ path: `${OUT5}/${name}.png` });
  await ctx.close();
  console.log(`${OUT5}/${name}.png`);
}
await browser.close();
