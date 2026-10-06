// VERIFICATION RIG ONLY (PR #13163 R6): the measured results as one evidence figure. Every number comes from the probe
// logs under logs/ (copied from the rig's out/<db>/), the round-5 addendum logs, and the mutation/prototype ledgers.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/root/git/qwen-code-x9/package.json');
const { chromium } = require('playwright');
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
  `<h2>1. Round 5's two open items, on the real stack</h2>` +
  t(['Scenario', '25eb9ae2 (round 5 addendum)', '13df2a65 (this round)'], [
    ['Parked Turn, create restored, creator cancels after a dispatcher restart; two overlapping passive loads (acquire answers held 5 s / 15 s); DELETE /session/:id while both adopt, then right after the first answers',
      `409, then ${bad('204')}; Broker ${bad('release')}; second load 409; both Runtime Sessions RELEASED; Turn ${bad('FAILED hosted_harness_rejected')}`,
      `${ok('409 hosted_turn_active')} both times (2 / 2 runs); ${ok('no release')}; second load 200; adopted Runtime Session ${ok('READY')}; Turn stays CANCELLING on ${c('hosted_turn_recovery_required')}, the same #13054 bound as a single parked load`],
    ['R6-2: K1 fails, K2 "Bravo" completes; two same-key K1 retries overlap (first delayed 4 s, second answers 500)',
      `first retry ${bad('409 session_mutation_superseded')}; API "Bravo", Harness last "Alpha"`,
      `first retry ${ok('200 "Alpha"')}; API "Alpha", Harness last "Alpha"`],
  ], [40, 28, 32]) +
  `<h2>2. New: the V48 boundary belongs to the key, not to the attempt (title only)</h2>` +
  t(['K1 attempt #1 reaches the Harness (applied, answer held 9 s) → #2 same key fails → K2 "Bravo" completes → #3 same key, sent after Bravo, fails → the answer to #1 arrives', '25eb9ae2', '13df2a65', '13df2a65 + per-attempt boundary (no V48)'], [
    ['attempt #1 answer', `409 superseded`, `${amb('200 "Alpha"')} (boundary moved to @13 by the failed #3)`, `409 superseded`],
    ['API title / Harness last title', `Bravo / Bravo`, `${bad('Alpha / Bravo')}`, `Bravo / Bravo`],
    ['one more K1 retry', `200 "Alpha", reaches the Harness → ${ok('Alpha / Alpha')}`, `${bad('replay only')} (row COMPLETED), Harness untouched → ${bad('Alpha / Bravo stays')}`, `200 "Alpha", reaches the Harness → ${ok('Alpha / Alpha')}`],
    ['R6-2 sequence (section 1) on the same arm', dim('409, Bravo / Alpha'), ok('200, Alpha / Alpha'), ok('200, Alpha / Alpha')],
  ], [37, 18, 25, 20]) +
  `<div class="note">${c('beginSessionMutation')} and ${c('completeSessionMutation')} run inside one request (${c('ManagedAgentService.renameSession')}). Returning ${c('session.lastSequence()')} (read under the Session lock) from begin and passing it to complete gives each attempt its own boundary: both interleavings come out right on the real stack, and no column is needed. Prototype: ${c('ManagedSessionLifecycleTest')} + 3 neighbouring classes ${ok('112 / 112')} (with an added r63 case), full module suite: #13542 plus one mock stub that still named the 7-argument completion (re-stubbed, included in the 112), Checkstyle clean.</div>` +
  `<h2>3. V47 + V48 on real MySQL 8.0.45 (rolling upgrade from 25eb9ae2)</h2>` +
  t(['Step', 'Measured'], [
    ['Old jar writes K1 FAILED (Harness 500) and K2 COMPLETED; replica A and the Harness move to 13df2a65, the Session Store replica stays on 25eb9ae2', `Flyway validated 48, applied ${ok('V47 + V48 in 0.23 s')}; column ${c('bigint NULL')}; legacy rows ${c('NULL')}`],
    ['Two overlapping same-key K1 retries on the legacy row (after the old writer lease lapsed)', `revival writes boundary @13; the attempt that held the successful Harness write completes ${ok('200 "Alpha"')} (the cold load swapped which retry got it); API / Harness ${ok('Alpha / Alpha')}; a fresh rename ${ok('200 "Charlie"')} @14`],
  ], [45, 55]) +
  `<h2>4. Tests and mutation at 13df2a65</h2>` +
  t(['Area', 'Result'], [
    ['Harness tests (3 files)', `${ok('248 / 248')}. Counted fence: reverting to set/clear (${ok('killed')}), clearing outright in ${c('finally')} (${ok('killed')}), dropping the fence (${ok('killed')}, 10), MCP cancel never releasing the counter (${ok('killed')}); monitor wake ${c('> 0')} → ${c('> 1')} ${amb('survives')}. Round 5's /2-profile mutants ${amb('still survive')}`],
    ['Java (managed-agent-server, full suite)', `1053 run; ${amb('1 error = #13542')} (main, from #13355). V48 boundary: no refresh on revival, no boundary on insert, ${c('COALESCE')} order swapped, revival off by one — ${ok('all killed')} by ${c('latestRenameAttemptCompletesAfterItsSiblingRetires')}; NULL-with-no-requested-event treated as superseded ${amb('survives')}`],
    ['Real-stack regression set', `cancel under revoke / DRAINING / re-registration ${ok('202 → CANCELLED')} +414–665 ms; reader / stranger refused; W2 child2 cancel ${ok('CANCELLED')}; close → archive → delete refusals unchanged; cold-cache cancel ${ok('CANCELLED')} +43.8 s; WebShell en / zh ${ok('Cancel shown, CANCELLED in 1.66 s')}`],
  ], [24, 76]);
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>Round 6: real-stack re-verification at 13df2a65</h1><p class="sub">Same Linux aarch64 rig as the round 5 addendum: managed-agent-server fat jar (embedded Runtime Broker, durable local process on), packaged Hosted Harness, MySQL 8.0.45, Session Store on a second replica, a scripted OpenAI-compatible model, and taps in front of the Harness and the Broker. Arms: 13df2a65 (current head), 25eb9ae2 (previous head), and 13df2a65 with a per-attempt rename boundary prototype. Each arm uses its own jar and bundle.</p>${body}</div>`;
fs.writeFileSync('fig/r6-linux-01-results.html', html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W + 56, height: 900 }, deviceScaleFactor: 2 });
await p.goto(`file://${path.resolve('fig/r6-linux-01-results.html')}`);
await p.waitForTimeout(400);
await p.locator('#card').screenshot({ path: 'fig/r6-linux-01-results.png' });
await b.close();
console.log('ok');
