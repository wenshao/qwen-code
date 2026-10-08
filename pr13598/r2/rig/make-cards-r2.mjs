// Evidence cards for the PR 13598 verification report (English only; the
// Chinese text lives in the comment's collapsed block). Renders each card
// with the head worktree's Playwright and screenshots the #card element.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13598-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13598-rig/fig/r2';
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
const neu = '<span class="crit">&#9888; NEW</span>';

// ---------- 01 summary ----------
cards['01-summary'] = page(`
<h1>PR #13598 @ 3e65e3ff92 - real-stack re-verification (round 2)</h1>
<p class="sub">Same rig as round 1: PR Spring jar + PR Hosted Harness dist/cli.js + embedded Runtime Broker + MySQL 8.4.7 + real qwen3.8-max, macOS arm64. Every round-1 scenario re-run at the new head; numbers come from tap logs, gateway logs and DB rows.</p>
<table>
<tr><th style="width:36%">Round-1 finding</th><th>Round 2 at 3e65e3ff92</th></tr>
<tr><td>${ok} <b>F1 user Turn starved by a recurring automation</b></td><td>user Turn done in <b>128 s</b> (skip) / <b>129 s</b> (queue_one); round 1: 733 s / 757 s. Slots while it waited: skipped(overlap)</td></tr>
<tr><td>${ok} <b>F4 scanner on the 1-thread default pool</b></td><td>25 s fire delay: /items lag on another Session <b>3 ms / 4 ms</b> (round 1: 20.7 s / 21.3 s); the blocked call sits on <b>managed-automation-1</b></td></tr>
<tr><td>${ok} <b>F5 review P1 + P2</b></td><td>lost no-op retry answers the honored rev 1, later rev 2 kept; reused retire key on Y: 409 idempotency_conflict, Y stays live</td></tr>
<tr><td>${part} <b>F2 Spring restart, fires cannot re-attach</b></td><td>takeover load now 200, but any outage spanning a 20 s activation renewal leaves the journal dead: fire_run <b>503</b> for 18+ min (user Turns too; <b>same on main</b>)</td></tr>
<tr><td>${part} <b>F3 Harness crash mid-run</b></td><td>run settles failed only when something reloads the Session (7 slots skipped first); the Session then stays blocked and the definition goes dark again (<b>28+ min</b>)</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:36%">New in round 2</th><th>Measured</th></tr>
<tr><td>${neu} <b>F6 an automation turn cannot use a Workspace tool</b></td><td>Broker tool-sessions:acquire refuses runtimeSessionId <b>arun_&#8230;:input</b> (400, not path-safe); the run fails, the Session is blocked, later user Turns <b>FAILED hosted_turn_recovery_required</b>. 3/3 on head; candidate +18/-4 fixes it on the same stack</td></tr>
<tr><td>${neu} <b>F7 a blocked Session keeps accepting fires</b></td><td>fire_run answers 202, the run never starts: skip definitions stay skipped(overlap), allow definitions hit count_limit (S5: <b>38 min</b> and counting)</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:36%">Still holds</th><th>Evidence</th></tr>
<tr><td><span class="good">&#10003;</span> <b>Claim protocol end to end</b></td><td>lost create + same key on another Session: 409, owner retry replays; concurrent creates: one relay, one definition; cross-kind reuse: 409</td></tr>
<tr><td><span class="good">&#10003;</span> <b>Scheduling, catch-up, validation, authz</b></td><td>102 non-tool occurrences, 1 model request each; catch-up none / latest / bounded:2 decisions as in round 1; non-ASCII cron digits 400; reader 403, outsider 404</td></tr>
<tr><td><span class="good">&#10003;</span> <b>PR suites</b></td><td>Java 315/315, TS core 150/150, funnel + wake 38/38, live wiring 8/8</td></tr>
</table>`, 1240);

// ---------- 02 F6 ----------
cards['02-tool-wake-turn'] = page(`
<h1>F6 - an automation turn that calls a Workspace tool fails and blocks its Session</h1>
<p class="sub">Manual run of a definition whose prompt asks to read a file (y2 stack, Harness-to-Broker traffic captured by a tap). Also reproduced on T1 and, unprompted, on S5 when the model chose to read AGENTS.md.</p>
<div class="two">
<div><p class="lbl hd">head 3e65e3ff92 - Harness -&gt; Runtime Broker</p>
<pre>03:27:18 POST runtimes:warm
  runtimeSessionId="arun_a6d94c42...:input"   -&gt; 200
03:27:22 POST tool-sessions:acquire
  runtimeSessionId="arun_a6d94c42...:input"
  turnKind="bootstrap"
  -&gt; <span class="crit">400 runtime_broker_invalid_request</span>
     retryable=false</pre>
<p class="lbl" style="margin-top:12px">Harness</p>
<pre>Monitor wake turn arun_a6d94c42...:input is
recovery blocked: Error: Hosted tool turn requires
recovery; its original work was not released.</pre>
<p class="lbl" style="margin-top:12px">Afterwards (T1)</p>
<pre>automation run                       <span class="crit">failed</span>
user Turn 03:25:29  6 x 409 -&gt; <span class="crit">FAILED hosted_turn_recovery_required</span>
qwen_tool_execution rows             0</pre></div>
<div><p class="lbl cd">candidate (+18/-4, Harness only) - same stack, same prompt</p>
<pre>tool runtime id  wake-09f80a1d...  (sha-256 of the input id)
qwen_tool_execution  read_file  <span class="good">success</span>
  "hello from the candidate rig\\n"
automation runs  03:48:56 <span class="good">completed</span>
                 03:49:17 <span class="good">completed</span>   (scheduled)
                 03:50:07 <span class="good">completed</span>   (scheduled)
user Turn after  <span class="good">COMPLETED</span></pre>
<p class="lbl" style="margin-top:12px">Why</p>
<pre>HostedWorkspaceToolTurn uses the turn id as the
Runtime Session id; a wake turn's id is the input id
  automationInputId = runId + ":input"
RuntimeBrokerService.acquire requires a path-safe id
  [A-Za-z0-9._-]{1,512}     (since #12868)
Monitor notifications use "&lt;id&gt;:notify:&lt;n&gt;" too
  (not verified here)</pre></div>
</div>
<div class="note">Round 1 missed this: my prompts there were "Reply with exactly: TICK" and never led the model to a tool. The PR's suites pass on head and the same Harness suites pass on the candidate (493/493), so nothing pins it; it needs a live-wiring test where a wake turn calls a tool.</div>`, 1240);

// ---------- 03 F3 + F7 ----------
cards['03-blocked-session'] = page(`
<h1>F3 + F7 - a blocked Session keeps taking fires, and the definition stays dark</h1>
<p class="sub">X1 (x2 stack): 1-minute skip definition, model call held 90 s, Harness SIGKILLed at 03:15:35 and restarted 10 s later. S5 (h2 stack): overlap allow, blocked by F6 at 03:13.</p>
<div class="two">
<div><p class="lbl">X1 - head 3e65e3ff92</p>
<pre>03:15:04 fire_run 202, model call in flight
03:15:35 Harness SIGKILL, restart 03:15:45
03:16-03:22  7 slots skipped(overlap)
         run rev 2 <span class="warn">running</span>; nothing reloads X1
03:22:29 user Turn: 409, load 200, prompt 202
         Harness: input needs recovery, not a re-drive
         run -&gt; <span class="good">failed</span>   (the new F3 path)
         user Turn COMPLETED 03:22:33
03:23:05 fire_run <span class="crit">202</span> -&gt; run running, <span class="crit">no model call</span>
03:24:45 user Turn -&gt; <span class="crit">FAILED hosted_turn_recovery_required</span>
03:28    Harness restart: same input classified
         "needs recovery" again on reload
03:32:17 a user Turn sent 03:28:08 COMPLETED,
         the 03:23 run still never starts
03:24-03:51  28 slots skipped(overlap)</pre></div>
<div><p class="lbl">S5 - head 3e65e3ff92, overlap allow</p>
<pre>03:12 fired  completed
03:13 fired  <span class="crit">failed</span>   (F6: model read AGENTS.md)
03:14 fired  202 -&gt; <span class="warn">running</span>, never started
03:15 fired  202 -&gt; <span class="warn">running</span>, never started
03:16 fired  202 -&gt; <span class="warn">running</span>, never started
03:17 fired  202 -&gt; <span class="warn">running</span>, never started
03:18 skipped count_limit
  ... every minute ...
03:55 skipped count_limit   (still, 38 min)</pre>
<p class="lbl" style="margin-top:12px">Why</p>
<pre>fire_run commits a run + input while
session.blocked is set; the wake pump never
runs a blocked Session's input. The crashed
input is never consumed when its run settles
failed, so every reload re-blocks the Session.</pre></div>
</div>
<div class="note">The Session-level block after a crash predates this PR (round 1 control: a crash in a user Turn blocks the Session too). What this PR adds is the producer: the scanner keeps committing runs into a Session that cannot run them, and those runs count as active forever.</div>`, 1240);

// ---------- 04 F2 boundary ----------
cards['04-restart'] = page(`
<h1>F2 - the takeover re-attach works, but a Spring outage longer than one renewal kills the journal</h1>
<p class="sub">The Hosted Harness renews each Session's activation every 20 s through the Session Store, which Spring serves. Harness kept running in every case below.</p>
<div class="two">
<div><p class="lbl">y2 - Spring down 44 s (03:43:21-03:44:05), head</p>
<pre>03:44:08 /load        -&gt; <span class="good">200</span>   (takeover, round 1: 409)
03:44:08 fire_run     -&gt; <span class="crit">503 automation_operation_failed</span>
03:44:13 fire_run     -&gt; 503
03:44:18 fire_run     -&gt; 503   ... deferred with backoff
Harness: fire_run of session 142cd018... found the
journal dead: session log writes stopped after an
earlier failure: Managed Session Store POST
/transactions:commit failed: ... fetch failed.</pre>
<p class="lbl" style="margin-top:12px">base = main 464f486e20 - Spring down 45 s, user Turn only</p>
<pre>03:46:08 .. 03:47:12  /prompt -&gt; <span class="crit">503</span> x6, still retrying</pre></div>
<div><p class="lbl">h2 - Spring down 3 min 50 s (03:33:30-03:37:20), head</p>
<pre>catch-up decisions (60 s tolerance), as in round 1:
  none        missed x3 + timely slot
  latest      missed x2 + 1 catch_up
  bounded:2   missed x1 + 2 catch_up
but every one of them:
  /load 200, then fire_run <span class="crit">503</span>, firing, attempts 10-11
03:55 (18 min later) still 503
  later slots skipped(overlap) / count_limit
S4 user Turn 03:39:12 -&gt; /prompt <span class="crit">503</span> every 60 s,
  still ACCEPTED at 03:55</pre></div>
</div>
<div class="note">The dead-journal behavior is on main too (base row), so it is not this PR's bug. It does bound F2's fix: the takeover load only helps a restart that completes between two renewals (under 20 s). Round 1's candidate check (fire 202, 32 s after the kill) did not hit this; I did not record the renewal timing then.</div>`, 1240);

// ---------- 05 fixed ----------
cards['05-fixed'] = page(`
<h1>F1, F4, F5 and the claim protocol on the real stack</h1>
<p class="sub">head 3e65e3ff92 unless noted. F1 and F4 rows compare with the round-1 head (bc6e076b9d) and the round-1 candidate patch.</p>
<table>
<tr><th style="width:30%">Scenario</th><th style="width:17%">round-1 head</th><th style="width:17%">round-1 candidate</th><th>3e65e3ff92</th></tr>
<tr><td><b>F1 skip, 100 s turns</b><br>user Turn mid-run</td><td>733 s, 18 x 409</td><td>128 s</td><td><b class="good">128 s</b> - sent 03:12:30, 7 x 409, admitted 03:14:35; 03:13 + 03:14 skipped(overlap)</td></tr>
<tr><td><b>F1 queue_one</b><br>one input already queued</td><td>757 s</td><td>190 s</td><td><b class="good">129 s</b> - sent 03:13:30, 8 x 409, admitted 03:15:36; 03:14 + 03:15 skipped(overlap)</td></tr>
<tr><td><b>F4 /items lag</b>, one fire_run held 25 s</td><td>20,747 / 21,320 ms</td><td>5 / 5 ms</td><td><b class="good">3 / 4 ms</b> - jstack: managed-automation-1 in HttpClient.send, scheduling-1 idle</td></tr>
</table>
<p class="lbl" style="margin-top:14px">F5 and the new claim protocol - public routes, tap drops the Harness answer after commit</p>
<pre>P1  create A rev1 | update U (no-op) <span class="warn">lost</span> 503 | update B 202 rev2 | retry U -&gt; <span class="good">202 replay=true rev1 "goal A"</span> | GET -&gt; rev2 "goal B"
P2  retire X key R <span class="warn">lost</span> 503 | retire Y key R -&gt; <span class="good">409 idempotency_conflict</span>, Y live | retry X key R -&gt; 202 replay=true, X retired
I3  create K on XA <span class="warn">lost</span> 503 | create K on XB -&gt; <span class="good">409</span> | retry on XA -&gt; 202 replay=true | one definition, on XA
I4  create K on XA and XB at once (relay held 3 s) -&gt; XA 202 in 3045 ms, <span class="good">XB 409 in 26 ms</span>, one relay, one definition
I5  retire Y with a key that created another definition -&gt; <span class="good">409 idempotency_conflict</span>, Y live
I9  cron "&#1635; * * * *" (ARABIC-INDIC) and "&#65299; * * * *" (fullwidth) -&gt; <span class="good">400</span>; "3 * * * *" -&gt; 202
I8  manual run during a run -&gt; 409 automation_run_skipped (overlap); same key again -&gt; 202 replay=true, outcome skipped</pre>
<div class="note">Journal and mirror agree after P1 (rev 2 both) and P2 (X rev 2 retired, Y rev 1 live). The per_run refusal (409 automation_mode_disabled) is decided in Spring before the claim, so the claim-release path for it was not exercised end to end.</div>`, 1240);

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
