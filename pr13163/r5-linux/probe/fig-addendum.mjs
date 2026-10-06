// VERIFICATION RIG ONLY (PR #13163 R5): the measured results as one evidence figure. Every number comes from the
// probe logs under logs/ (copied from the rig's out/<db>/) and the mutation ledgers.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/root/git/v13163-head/package.json');
const { chromium } = require('playwright');
const TD = JSON.parse(fs.readFileSync('td2.json', 'utf8'));
const W = 1080;
const css = `body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI","Noto Sans CJK SC",sans-serif;color:#e6edf3}
#card{width:${W + 56}px;padding:22px 28px 24px}
h1{font-size:19px;margin:0 0 4px;font-weight:650}.sub{font-size:13px;color:#9da7b3;margin:0 0 12px;line-height:1.45}
h2{font-size:14.5px;margin:16px 0 8px}
table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:6px;table-layout:fixed}td,th{overflow-wrap:anywhere}
th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}th{background:#161b22;color:#9da7b3;font-weight:600}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.amb{color:#d29922;font-weight:600}.dim{color:#8b949e}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#1f2630;padding:1px 4px;border-radius:4px}
.note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22;width:${W - 22}px}
.note.bad{border-left-color:#f85149}.note.ok{border-left-color:#3fb950}`;
const t = (head, rows, widths) => `<table>${widths ? `<colgroup>${widths.map((w) => `<col style="width:${w}%">`).join('')}</colgroup>` : ''}<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const ok = (s) => `<span class="ok">${s}</span>`, bad = (s) => `<span class="bad">${s}</span>`, amb = (s) => `<span class="amb">${s}</span>`, dim = (s) => `<span class="dim">${s}</span>`, c = (s) => `<code>${s}</code>`;
const body =
  `<h2>1. Merging main again: the break at eb3b9336, and the fix in 25eb9ae2</h2>` +
  t(['Tree', 'Measured'], [
    [`<code>eb3b9336</code> + main <code>d092d5b4</code> (#13166, #13342)`, `Git conflicts only in ${c('hosted-harness-session.test.ts')}, but the cleanly merged ${c('hosted-harness-session.ts')} does ${bad('not compile')}: ${c('TS2552')} ×3 at :1718, :1719, :1731. #13166 replaced the ${c('HOSTED_WORKSPACE_*_PROFILE')} imports with ${c('isHostedWorkspaceProfile')} / ${c('isHostedWorkspaceShellProfile')}; the three uses sit in this PR's own resident reattach branch, which main never had.`],
    [`<code>25eb9ae2</code> (pushed after round 5)`, `Resolves exactly that: the three checks now use the two helpers, and the test helper takes both new parameters. ${ok('build (tsc) clean')} · Harness tests ${ok('246 / 246')} · WebShell managed tests ${ok('78 / 78')} (incl. the generated-client drift gate) · real-stack subset ${ok('same as eb3b9336')} (sections 2–4).`],
    [`mutants at <code>25eb9ae2</code>`, `The five fence mutants that die at eb3b9336 still die. ${amb('Reverting the merge fix to /1-only survives')} (both the profile default and the ${c('captureBytes')} check): no test runs a ${c('/2')} profile through the resident reattach branch.`],
  ], [26, 74]) +
  `<h2>2. Linux with the durable local process (round 5's "not covered")</h2>` +
  t(['Scenario', 'main 43a6e1e5', 'this PR (eb3b9336 · 25eb9ae2)'], [
    ['creator cancels under create revoked / DRAINING / re-registration', `${bad('409 / 409')} → Turn FAILED at +30.6 s / re-registration 202`, `${ok('202')} → ${ok('CANCELLED')} at +589 / +373 / +610 ms · +701 / +649 / +415 ms`],
    ['real close → archive → DELETE through the public API, then the creator cancels the old Turn', `${ok('409 workspace_unavailable')}, 0 command / 0 Turn rows`, `${ok('identical')} on both heads (round 4 could only set these states by SQL)`],
    ['W2 cwd change child → child2, later Turn, then create revoked + DRAINING, creator cancels', `${bad('409')}, the Turn keeps running`, `${ok('CANCELLED')} at +547 ms · +362 ms; after a dispatcher restart +44.0 s; next Turn writes into child2`],
    ['dispatcher restart (cold Java attachment cache), Session Store on a second replica', `revoked: ${bad('409')}, RUNNING at +90 s · grants intact: 202, ${c('load 409')}, ${bad('CANCELLING')} at +90 s`, `${c('load 200')} → ${c('cancel 204')} → ${ok('CANCELLED')} at +43.7 / +43.5 s · +43.5 s (the wait is the stopped replica's dispatch lease)`],
    ['the same restart with the Session Store inside the restarted Spring', dim('—'), `${bad('3 / 3 CANCELLING')}: every POST /cancel got 204, but the Harness had logged "session log writes stopped … fetch failed" (#13413)`],
  ], [30, 30, 40]) +
  `<h2>3. Parked recovery still needs the grants that admit new work</h2>` +
  t(['A recovery-blocked Turn (first write lands, create revoked, second write refused); dispatcher restarts; creator cancels', 'measured'], [
    ['create still revoked', `passive load → Broker acquire ${bad('409 workspace_unavailable, retryable=false')} ×7 over ~2 min → ${bad('CANCELLING')}`],
    ['create restored before the cancel', `acquire 200, ${c('load 200')}, then every ${c('POST /managed-runtime/cancel')} → 409 hosted_turn_recovery_required → ${bad('CANCELLING')}: the resident Session stays blocked (#13054)`],
  ], [45, 55]) +
  `<div class="note bad">The Broker resolves every acquire through ${c('WorkspaceRuntimeResolver.resolve')} → ${c('authorize')} → ${c('authorizePassiveAttachment')} (can_create on an ACTIVE registry row). This PR's ${c('authorizeCancellation')} covers only the Java → Harness attachment, so a cancel that has to re-adopt the Runtime lease cannot finish under the refusals this PR is about. That is inside the excluded #13054 case, but "parked recovery adopts the original Runtime lease" holds only while the grants are intact.</div>` +
  `<h2>4. b6eff8f4's fence on the real stack</h2>` +
  t(['Same parked Turn, create restored; a tap holds the acquire answer from the Broker; DELETE /session/:id is sent straight to the Harness', 'this PR', 'this PR without the fence line'], [
    ['one passive load (eb3b9336), DELETE while it adopts', TD.head, TD.h1],
    ['two overlapping passive loads (25eb9ae2): DELETE while both adopt, then 190 ms after the first answers', `${ok('409 hosted_turn_active')}, then ${bad('204')}: the first load's ${c('finally')} lifted the fence; the Broker released the lease while the second load was still adopting (it answered 409); the cancel ended ${bad('FAILED hosted_harness_rejected')}`, dim('—')],
  ], [36, 34, 30]) +
  `<div class="note">The overlapping-load row confirms round 5's fence-candidate finding on the real stack; 25eb9ae2 does not include that guard. The R6-2 rename race gives round 5's result on this rig too, at both heads: 409 session_mutation_superseded, API title "Bravo", Harness title "Alpha".</div>`;
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>Round 5 addendum: the new head 25eb9ae2, and Linux with the durable local process</h1><p class="sub">Real stack on Linux aarch64: managed-agent-server fat jar (embedded Runtime Broker, durable local process on), packaged Hosted Harness, MySQL 8.0.45, a scripted OpenAI-compatible model, and taps in front of the Harness and the Broker. Arms: this PR at <code>eb3b9336</code> (the head round 5 tested) and at <code>25eb9ae2</code> (current head); main <code>43a6e1e5</code> (main side of eb3b9336's merge, includes W2); and this PR's bundle without b6eff8f4's fence line. Each arm uses its own jar and bundle. Harness mutation on Linux x86_64.</p>${body}</div>`;
fs.writeFileSync('fig/r5-linux-01-results.html', html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W + 56, height: 900 }, deviceScaleFactor: 2 });
await p.goto(`file://${path.resolve('fig/r5-linux-01-results.html')}`);
await p.waitForTimeout(400);
await p.locator('#card').screenshot({ path: 'fig/r5-linux-01-results.png' });
await b.close();
console.log('ok');
