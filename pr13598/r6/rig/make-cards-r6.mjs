// Evidence cards for the PR 13598 verification report (English only; the
// Chinese text lives in the comment's collapsed block). Renders each card
// with the head worktree's Playwright and screenshots the #card element.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13598-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13598-rig/fig/r6';
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
const held = '<span class="good">&#10003; HOLDS</span>';
const red = '<span class="crit">&#10007; RED</span>';
const neu = '<span class="warn">&#9888; NEW</span>';
const open = '<span class="crit">&#9888; OPEN</span>';

// ---------- 01 summary ----------
cards['01-summary'] = page(`
<h1>PR #13598 @ 786c319111 - real-stack re-verification (round 6)</h1>
<p class="sub">macOS stacks with the PR Spring jar + PR Hosted Harness + real qwen3.8-max as before, plus - new this round - a Linux durable local-process stack (container on an arm64 Linux host, scripted model) for the cold-Broker case, run on round 5's build and on this head.</p>
<table>
<tr><th style="width:34%">Round-5 item</th><th>Round 6 at 786c319111</th></tr>
<tr><td>${ok} <b>cold Broker (18:33 review P1)</b></td><td>Linux durable, Harness + Spring JVM SIGKILLed mid read_file, workers alive. Round 5 build: release answers <b>503 runtime_reconciliation_required</b> forever, 27 slots skipped, lease held, another Session's read_file Turn refused 3737 times. This head: <b>acquire -&gt; status -&gt; acquire -&gt; release 200</b>, the next run completed, and 14 more after it</td></tr>
<tr><td>${ok} <b>the user Turn that loads a crashed Session early</b></td><td><b>4/4 completed</b> (10 s, 20 s, 80 s, 10 s after the restart) with the new hosted_turn_recovery_in_progress; after the park settles the Turn can still wait one capped 60 s backoff</td></tr>
<tr><td>${held} <b>F8 allow, F9, skip + reconcile_run, live runs, Broker fault</b></td><td>same results as round 5 with qwen3.8-max: crashed prompt out of the next request, 1 slot skipped under skip, 3 reconcile calls against a live run left it alone, a 5.5-min Broker fault recovered without a restart</td></tr>
<tr><td>${open} <b>the 09:51 review's two runtime P1s</b></td><td>Shell under Tool v3 publication (still refused, now at the checkpoint check) and a RELEASING session read as released: <b>not exercised here</b> - Tool publication needs an OSS endpoint, and RELEASING needs a worker-side release failure</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:34%">New this round</th><th>Measured</th></tr>
<tr><td>${red} <b>CI on this head</b></td><td>three jobs fail on three tests this PR owns: <b>publicAutomationRunStateValidatesAsLegallyNull</b> (its fixture says object "automation_run"; the schema requires "agent.automation.run") in both Java managed-agent jobs, and the two core tests whose "disabled" probe child_acceptance is enabled since the H4b merge. main is green on the same workflows</td></tr>
<tr><td>${neu} <b>blocked fires now defer</b></td><td>after a 5.5-min Broker fault, the deferred 10:05 and 10:07 slots ran at 10:09:35 and 10:09:25 (out of order), while the fresh 10:08 slot was skipped count_limit</td></tr>
<tr><td>${neu} <b>closing a Session with a live definition</b></td><td>(first close test, Linux durable) the close completes in 1 s, but the definition stays <b>live</b> and the scanner writes skipped(session_not_active) every slot until someone retires it by hand</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:34%">Tests</th><th>Result</th></tr>
<tr><td><b>Java / TS / mutation</b></td><td>Java module 1555: <b>1 failure</b> (the contract fixture, also alone) + 1 timing error that passes alone; AutomationScannerTest 49/49. TS Harness 6 files 654/655 (a monitor-wake timeout that passes alone). Mutation: round 5's fail-open survivor is now caught; <b>reconcile_run without its live-turn guard is still not caught</b></td></tr>
</table>`, 1240);

// ---------- 02 cold broker ----------
cards['02-cold-broker-linux'] = page(`
<h1>Cold Broker on Linux durable local-process: round 5's build wedges, this head recovers</h1>
<p class="sub">Container on an arm64 Linux host (MySQL 8.0, scripted model). K2 runs read_file every minute (overlap allow). The tap holds the execution poll; 8 s later the Harness process group and the Spring JVM (embedded Broker) are SIGKILLed - the runtime workers share Spring's process group and are left alive. Spring restarts, then the Harness. K3 is another Session on the Workspace.</p>
<div class="two">
<div><p class="lbl hd">round 5 build decc116727 (stack k5)</p>
<pre>09:50:14  SIGKILL Harness + Spring JVM; 3 workers alive
09:50:27  Spring healthy, Harness restarted
09:51     skipped(managed_session_writer_conflict)
09:52:03  fire loads K2; aftermath:
          GET executions/&lt;id&gt;            200
          POST tool-sessions/wake-5b71.. <span class="crit">503 runtime_reconciliation_required</span>
          ... again every ~0.75 s, forever
09:53-10:19  <span class="crit">27 slots skipped(hosted_session_blocked)</span>
09:59:59  K3 read_file Turn: <span class="crit">3737 x workspace_busy</span>, still RUNNING
end       wake-5b716f.. READY, Workspace lease holder</pre></div>
<div><p class="lbl cd">this head 786c319111 (stack k6)</p>
<pre>10:01:12  SIGKILL Harness + Spring JVM; workers alive
10:01:24  Spring healthy, Harness restarted
10:02:04  fire loads K2; aftermath:
          POST tool-sessions:acquire     <span class="good">200</span>  (adopt first)
          GET executions/&lt;id&gt;            200
          POST tool-sessions:acquire     200
          POST tool-sessions/wake-28a9.. <span class="good">200</span>  (release)
10:02:07  crashed run failed / outcome_unknown
10:02:12  the 10:02 run completed
10:03-10:16  14 more runs completed, 0 workspace_busy,
          every wake session RELEASED, no lease holder</pre></div>
</div>
<div class="note">This is the 18:33 review's cold-Broker P1, reproduced on the real stack before the fix and gone after it. The 09:51 review's follow-up - a session left RELEASING also answers runtime_session_not_acquirable, so skipping release there can lose it - needs a worker-side release failure that this rig cannot inject.</div>`, 1240);

// ---------- 03 early user turn ----------
cards['03-early-user-turn'] = page(`
<h1>The user Turn that loads a crashed Session: no longer fails, can wait one extra minute</h1>
<p class="sub">Stack a6, qwen3.8-max. A manual read_file run is crashed inside the tool call; a user Turn is the first thing to load the Session. Round 5: 3/3 failed when sent within 20 s.</p>
<pre>Turn  sent after restart  park settled   prompt admitted   result
U5    10 s                10:07:28       10:09:29          <span class="good">COMPLETED</span> 10:09:44  (a 2nd restart at 10:08:26 cost one retry)
U6    20 s                10:09:21       10:09:54          <span class="good">COMPLETED</span> 10:09:58
U7    80 s                10:12:14       10:12:17          <span class="good">COMPLETED</span> 10:12:23
U8    10 s (clean)        10:20:38       10:21:38          <span class="good">COMPLETED</span> 10:21:46

U8, Spring log: retry=1 generation change, retry=2..6 /load 409 (dead writer lease),
                10:20:38 load 200 + prompt 409 hosted_turn_recovery_in_progress -&gt; retry=7 delayMs=60000
                10:21:38 admitted</pre>
<div class="note">The new refusal code is retried outside the budget, so nothing fails. But the coordinator's backoff is already at its 60 s cap after the dead-writer-lease retries, while the pump settles the park within one 500 ms pass: U8 waited 60 s with nothing left to wait for. A short fixed retry delay for hosted_turn_recovery_in_progress would remove it.</div>`, 1240);

// ---------- 04 deferred ----------
cards['04-deferred-slots'] = page(`
<h1>Blocked fires now defer: after an outage the old slots run late and out of order</h1>
<p class="sub">Stack f6, qwen3.8-max. F1 calls read_file every minute (overlap allow, concurrency 4). Crash inside the tool call at 10:03:17, then every execution status read refused (503) until 10:08:42, with a Harness restart at 10:07:33.</p>
<pre>slot   outcome   attempts  run started   note
10:03  fired     0         10:03:03      the crashed run (failed)
10:04  fired     1         10:04:08      accepted, waited for recovery, completed 10:08:48
10:05  fired     7         <span class="warn">10:09:35</span>      deferred while blocked, re-driven
10:06  fired     6         10:08:25      accepted by the load after the restart, completed 10:08:54
10:07  fired     6         <span class="warn">10:09:25</span>      deferred while blocked, re-driven
10:08  <span class="crit">skipped count_limit</span>            the deferred 10:05/10:07 count as active
10:09  fired     0         10:09:00
10:10  fired     0         10:10:01

model requests after recovery, in order: 10:06, 10:09, 10:07, 10:05, 10:10 (Occurrence of each prompt)</pre>
<div class="note">Round 5 recorded the blocked slots skipped(hosted_session_blocked) and moved on. This head (R3-11) defers them and re-drives until they fire, up to MAX_FIRE_ATTEMPTS. So an outage is replayed afterwards: four slots ran within about one minute after recovery, not in slot order, each prompt carrying its original Occurrence, and the slot that was actually due was the one refused. Whether that is the intended semantics for catch_up none is the maintainer's call; dropping a deferred fire once a later slot is due would keep the old meaning.</div>`, 1240);

// ---------- 05 close + CI ----------
cards['05-close-and-ci'] = page(`
<h1>Closing a Session with a live definition, and the red CI on this head</h1>
<div class="two">
<div><p class="lbl hd">stack k6 (Linux durable): close K2, whose read_file definition fires every minute</p>
<pre>10:16:40  POST /close -&gt; 202; Session CLOSED in 1 s
10:17     skipped(session_not_active)
10:18     skipped(session_not_active)
10:19     skipped(session_not_active)
10:19:30  GET definition: <span class="warn">state live, enabled true</span>
10:19:39  retire by hand -&gt; 202 retired (R3-12 local retire)
10:20-    no more occurrences</pre></div>
<div><p class="lbl">CI at 786c319111 (main green on the same workflows)</p>
<pre>Java (MySQL 8.4 + MariaDB jobs), 1 of 1555:
  publicAutomationRunStateValidatesAsLegallyNull
  "/object: must be the constant value
   'agent.automation.run'"  - the fixture says
   "object":"automation_run"; fails alone too
TS (ubuntu), 2 of 35908:
  refuses a record of a disabled domain ...
  refuses a registered domain that is not enabled
  - the probe child_acceptance is enabled since
    the H4b merge (09:51 review, P1 3)</pre></div>
</div>
<div class="note">Close itself is fine. A definition of a CLOSED Session can never fire again, yet it stays live in the public API and costs one ledger row per slot - 1,440 a day for a per-minute definition - until retired by hand. Retiring it locally when the scanner sees a terminal Session would close that. The three red tests are test-only, but they keep both Java managed-agent jobs and the unit lane red.</div>`, 1240);

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
