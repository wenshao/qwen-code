// Evidence cards for the PR 13598 verification report (English only; the
// Chinese text lives in the comment's collapsed block). Renders each card
// with the head worktree's Playwright and screenshots the #card element.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13598-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13598-rig/fig/r5';
mkdirSync(OUT, { recursive: true });

// Reference palette, dark mode (validated: #3987e5 / #d95926 pass all checks on #1a1a19).
const C = {
  surface: '#1a1a19', panel: '#222220', text: '#ffffff', text2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a',
  head: '#3987e5', cand: '#d95926', good: '#0ca30c', warn: '#fab219', crit: '#d03b3b',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const page = (body, width) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:${C.surface};font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:${C.text}}
  #card{width:${width}px;padding:28px 32px 26px;box-sizing:border-box;background:${C.surface}}
  h1{font-size:23px;margin:0 0 4px;font-weight:650}
  .sub{color:${C.text2};font-size:14px;margin:0 0 18px}
  h2{font-size:16px;margin:18px 0 8px;font-weight:650}
  pre{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.5;background:${C.panel};color:${C.text2};
      padding:10px 12px;border-radius:6px;margin:0;white-space:pre;overflow:hidden}
  .note{border-left:3px solid ${C.muted};padding:6px 12px;margin:14px 0 0;color:${C.text2};font-size:14px;line-height:1.5}
  .crit{color:${C.crit}} .good{color:${C.good}} .warn{color:${C.warn}} .hd{color:${C.head}} .cd{color:${C.cand}}
  table{border-collapse:collapse;width:100%;font-size:13.5px}
  td,th{padding:6px 8px;border-bottom:1px solid ${C.grid};text-align:left;vertical-align:top;color:${C.text2}}
  th{color:${C.muted};font-weight:600;font-size:12.5px}
  td b{color:${C.text};font-weight:600}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .lbl{font-size:12.5px;color:${C.muted};margin:0 0 4px}
  svg text{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif}
</style></head><body><div id="card">${body}</div></body></html>`;

const cards = {};

const ok = '<span class="good">&#10003; FIXED</span>';
const part = '<span class="warn">&#9680; PARTLY</span>';
const held = '<span class="good">&#10003; HOLDS</span>';
const info = '<span class="warn">&#9432; NOT THIS PR</span>';

// ---------- 01 summary ----------
cards['01-summary'] = page(`
<h1>PR #13598 @ decc116727 - real-stack re-verification (round 5)</h1>
<p class="sub">Same rig as rounds 1-4 (PR Spring jar + PR Hosted Harness + embedded Runtime Broker + MySQL 8.4.7 + real qwen3.8-max, macOS arm64); every Harness-Broker call and every model message logged. Six stacks: four crash the Harness while a wake turn waits on read_file, one keeps runs alive across slots, one has no automation.</p>
<table>
<tr><th style="width:34%">Round-4 finding</th><th>Round 5 at decc116727</th></tr>
<tr><td>${ok} <b>F9 crashed prompt reaches the model again</b></td><td>the next run's request carries only its own prompt (a5, s5); after a read_file crash the call and its cancelled result stay paired without the crashed prompt</td></tr>
<tr><td>${ok} <b>overlap skip keeps the Workspace</b></td><td>the scanner's <b>reconcile_run</b> settled the crash at the first slot after the dead writer lease lapsed and fired that same slot: <b>1 slot</b> skipped per definition; another Session's read_file Turn took <b>11 s</b></td></tr>
<tr><td>${ok} <b>one Broker error wedges for good</b></td><td>a 3.5-min Broker fault (352 refused status reads) with a Harness restart inside it: the input stayed pending, the first load after the fault settled everything; a 37 s fault without restart: recovered ~1 s after it ended</td></tr>
<tr><td>${part} <b>the user Turn that loads a crashed Session</b></td><td>80 s after the crash: refused 409 before admission, retried, completed. Within ~20 s of the crash: <b>FAILED hosted_turn_recovery_required, 3/3</b> - the dead writer lease's /load 409s had already spent Spring's pre-admission budget</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:34%">New checks</th><th>Measured</th></tr>
<tr><td>${held} <b>reconcile_run against live runs</b></td><td>6 calls against an 80 s text run and a read_file wait spanning the slot: answered in 28-53 ms, nothing settled, every run completed</td></tr>
<tr><td>${held} <b>allow definitions, same crash</b></td><td>29 later runs completed, 0 workspace_busy, no slot skipped; cancelled / failed user prompts leave the model context, as decision 15 says</td></tr>
<tr><td><span class="crit">&#9888; OPEN</span> <b>the two P1s of the 18:33 review</b></td><td>Shell under Tool v3 publication, and the settlement on a cold Broker (a Spring/Broker restart with the Runtime alive): <b>not reachable on this rig</b> (files-only Sessions; durable Runtimes are Linux-only), neither confirmed nor ruled out</td></tr>
<tr><td>${info} <b>a user Turn waiting on workspace_busy across a Harness restart</b></td><td>the takeover declines it (unresolved_after_settle, #13174) and the Session then refuses every Turn (managed_runtime_recovery_blocked); reproduced with two user Turns and no automation</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:34%">Tests</th><th>Result</th></tr>
<tr><td><b>Java / TS / mutation</b></td><td>Java module <b>1462 / 0 failures / 0 errors</b> (1 skipped), AutomationScannerTest 47/47; TS Harness 6 files 635/638 at load 25-50, the 3 failures pass alone; mutation: 5 of 7 caught - <b>not caught</b>: failing open when the settlement throws, and reconcile_run repairing while a turn holds the slot; CI 25 passing, 0 failing</td></tr>
</table>`, 1240);

// ---------- 02 skip + live ----------
const W = 1176, x0 = 150, x1 = W - 20;
const t0 = 18 * 60 + 39, t1 = 18 * 60 + 47;
const X = (h, m, s = 0) => x0 + ((h * 60 + m + s / 60 - t0) / (t1 - t0)) * (x1 - x0);
let axis = '';
for (let m = 39; m <= 47; m++) axis += `<line x1="${X(18, m)}" x2="${X(18, m)}" y1="30" y2="182" stroke="${C.grid}"/><text x="${X(18, m)}" y="198" fill="${C.muted}" font-size="11" text-anchor="middle">18:${String(m).padStart(2, '0')}</text>`;
const sq = (m, y, color) => `<rect x="${X(18, m) - 9}" y="${y}" width="18" height="18" rx="3" fill="${color}"/>`;
let s1 = sq(40, 40, C.cand) + sq(41, 40, C.crit);
for (let m = 42; m <= 47; m++) s1 += sq(m, 40, C.good);
cards['02-skip-reconcile'] = page(`
<h1>Overlap skip after a crash: reconcile_run frees the slot chain and the Workspace</h1>
<p class="sub">Stack s5. S1 calls read_file every minute (overlap skip); the Harness is SIGKILLed and restarted at 18:40:20 while S1 waits on the tool result. S3 is another Session on the same Workspace.</p>
<svg width="${W}" height="206" viewBox="0 0 ${W} 206">
${axis}
<text x="0" y="54" fill="${C.text}" font-size="13">S1 slots</text>${s1}
<text x="${X(18, 41) + 14}" y="34" fill="${C.crit}" font-size="12">18:41:00 reconcile_run -&gt; 409 (dead writer lease): skipped(overlap)</text>
<text x="${X(18, 42) + 14}" y="76" fill="${C.good}" font-size="12">18:42:01 reconcile_run -&gt; 202: crashed run failed, park settled, lease released; the same slot fires</text>
<text x="0" y="122" fill="${C.text}" font-size="13">S3 read_file</text>
<rect x="${X(18, 41, 55)}" y="108" width="${X(18, 42, 6) - X(18, 41, 55)}" height="18" rx="3" fill="${C.warn}"/>
<text x="${X(18, 42, 6) + 8}" y="121" fill="${C.text2}" font-size="12">sent 18:41:55, 16 x workspace_busy, completed 18:42:06 (11 s)</text>
<text x="0" y="168" fill="${C.muted}" font-size="12">legend:</text>
<rect x="60" y="156" width="14" height="14" rx="3" fill="${C.cand}"/><text x="80" y="168" fill="${C.text2}" font-size="12">crashed run</text>
<rect x="170" y="156" width="14" height="14" rx="3" fill="${C.crit}"/><text x="190" y="168" fill="${C.text2}" font-size="12">skipped</text>
<rect x="260" y="156" width="14" height="14" rx="3" fill="${C.good}"/><text x="280" y="168" fill="${C.text2}" font-size="12">fired and completed</text>
</svg>
<p class="lbl" style="margin-top:6px">stack l5 - reconcile_run against runs that are alive (no crash)</p>
<pre>18:42:00  L1 (80 s text run, skip)              reconcile_run -&gt; 202 34 ms   run completed 18:42:27
18:44:01  L1                                    reconcile_run -&gt; 202 31 ms   run completed 18:44:24
18:45:02  L4 (read_file poll held 18:44:59-18:45:24) reconcile_run -&gt; 202 43 ms   run completed 18:45:31
18:46-18:50  L1 x3                              202 in 28-53 ms, each run completed
totals    L1 5 completed / 0 failed, L4 7 completed / 0 failed</pre>
<div class="note">S2 (text, skip) behaved the same: one slot skipped, then the 18:42 run. The route repairs only when no turn holds the slot (<b>session.active</b>), so a live run is reported, never settled.</div>`, 1240);

// ---------- 03 fault ----------
cards['03-settlement-under-fault'] = page(`
<h1>A Broker fault during the settlement no longer wedges anything</h1>
<p class="sub">Stack f5. F1 calls read_file every minute (overlap allow). Crash inside the tool call; while the Harness is down the tap starts refusing every execution status read with 503.</p>
<pre>18:40:14  Harness SIGKILL; tap: refuse GET executions/&lt;id&gt; (503)
18:41:08  fire loads F1: run settled failed; stopParkedRuntimeExecutions -&gt; <span class="crit">503</span>, retried every pass
          journal: settleRun only - <b>no consume</b> while the park is unsettled
18:42-18:44  fires -&gt; 409 hosted_session_blocked (3 slots)
18:44:36  Harness restart with the fault still on (352 refused status reads by now)
18:45:04  slot skipped(managed_session_writer_conflict): the dead writer lease
18:45:46  fault cleared
18:46:05  fire loads F1: <span class="good">cancelled tool_result, checkpoint results_ready, then the consume</span>
          wake session released 18:46:06; the run accepted at 18:41 completed 18:46:13
18:52     second fault, no restart: a 30 s Broker silence sends a live turn to recovery,
          then 40 status reads refused (18:52:36-18:53:13)
18:53:14  <span class="good">released ~1 s after the fault ended</span>; 18:54-18:59 all fired and completed</pre>
<div class="note">F1 totals: 13 completed, 2 failed (the crashed and the timed-out run), 4 slots skipped as hosted_session_blocked while the Broker was failing, lease free at the end. The order in the journal is the one round 4 asked for: settle the park, then consume.</div>`, 1240);

// ---------- 04 early user turn ----------
cards['04-early-user-turn'] = page(`
<h1>The user Turn that loads a crashed Session: fixed late, still failing early</h1>
<p class="sub">Stacks u5 / a5. A manual read_file run is crashed inside the tool call; then a user Turn is the first thing to load the Session. Spring's /load answers 409 until the dead Harness's writer lease lapses (~60 s); each 409 is a pre-admission retry.</p>
<pre>Turn  sent after restart  /load 409s  then                                   result
U3    10 s                5          load 200 -&gt; prompt 409 in 58 ms (probe)   <span class="crit">FAILED hosted_turn_recovery_required</span>
U5    10 s                5          load 200 -&gt; prompt 409 in 49 ms (probe)   <span class="crit">FAILED hosted_turn_recovery_required</span>
U6    20 s                4          load 200 -&gt; prompt 409 in 44 ms (probe)   <span class="crit">FAILED hosted_turn_recovery_required</span>
U7    80 s                0          load 200 -&gt; prompt 409 -&gt; retry 2.3 s later  <span class="good">COMPLETED 18:57:15</span>

Spring log for U5: retry=1 HostedHarnessGenerationException, retry=2..6 DaemonHttpException (/load 409),
                   then "Managed Turn coordination exhausted retries" on the probe's 409.
In every case the recovery behind the load succeeded (run failed/unknown, wake session released).</pre>
<div class="note">The probe moved the failure from post-admission (round 4, hosted_turn_failed) to pre-admission, where a retry can pay it - but only if budget is left. A user Turn sent within ~20 s of a crash meets a budget the dead writer lease already spent. Settling the wake park inside load before it answers 200, or a refusal code the coordinator retries outside the budget, would close the window.</div>`, 1240);

// ---------- 05 F9 + control ----------
cards['05-f9-and-control'] = page(`
<h1>F9 on the real path, and one restart behaviour that is not this PR's</h1>
<div class="two">
<div><p class="lbl hd">a5: the first runs after the 18:40:13 crash (gateway log)</p>
<pre>A2 18:41 run   user  USER::init-A2      assistant  READY
               user  schedule:18:41:00Z only           6.9 s
A1 18:41 run   assistant  READY + read_file call (crashed)
               tool       cancelled result
               user       schedule:18:41:00Z         200</pre>
<p class="lbl hd" style="margin-top:10px">a5: user Turns, then "What is my locker code?"</p>
<pre>cancelled at 10 s  "4711"  -&gt;  "UNKNOWN"
failed (gateway 400) "9090" -&gt;  "UNKNOWN"
decision 15 covers it; the PR body still says
"no user-visible surface"</pre></div>
<div><p class="lbl">x5: no automation at all</p>
<pre>18:47:19  X1 user read_file Turn; tap holds its poll
18:47:23  X2 user read_file Turn: waits on workspace_busy
18:47:32  Harness SIGKILL + restart
18:48:42  X2 <span class="crit">FAILED managed_runtime_recovery_blocked</span>
          takeover declined: unresolved_after_settle
18:48:46  X1 completed through the takeover
18:50:03  X2 follow-up Turn: <span class="crit">FAILED</span> at once</pre>
<p class="lbl" style="margin-top:10px">the same on f5 (F2) here and on round 4's f4</p></div>
</div>
<div class="note">The decline comes from #13174's takeover (the waiting Turn never reached a checkpoint of its own), not from this branch. It matters here because wake sessions now hold the Workspace lease during automation tool calls, so more user Turns will be waiting when a Harness restarts. Worth its own issue.</div>`, 1240);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1300, height: 900 } });
const pg = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  const file = `${OUT}/${name}.html`;
  writeFileSync(file, html);
  await pg.goto('file://' + file);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, 'clipped-pre:', clipped);
}
await browser.close();
