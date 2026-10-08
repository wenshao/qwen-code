// Evidence cards for the PR 13598 verification report (English only; the
// Chinese text lives in the comment's collapsed block). Renders each card
// with the head worktree's Playwright and screenshots the #card element.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13598-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13598-rig/fig/r4';
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
const no = '<span class="crit">&#10007; NOT FIXED</span>';
const neu = '<span class="crit">&#9888; NEW</span>';
const open = '<span class="crit">&#9888; OPEN</span>';

// ---------- 01 summary ----------
cards['01-summary'] = page(`
<h1>PR #13598 @ e5342cf59c - real-stack re-verification (round 4)</h1>
<p class="sub">Same rig as rounds 1-3 (PR Spring jar + PR Hosted Harness + embedded Runtime Broker + MySQL 8.4.7 + real qwen3.8-max, macOS arm64). A tap on every Harness-to-Broker call; the model gateway logs the role and content of every message the model receives.</p>
<table>
<tr><th style="width:34%">Round-3 finding</th><th>Round 4 at e5342cf59c</th></tr>
<tr><td>${ok} <b>F8 crash inside an automation turn's tool call</b> (definitions that keep firing)</td><td>the next fire's load settles the parked read_file cancelled and releases the wake Broker session: <b>30</b> later runs completed and none failed (09:22-09:51), another Session's read_file Turn took <b>6 s</b>, 0 workspace_busy, 32/32 Broker sessions RELEASED</td></tr>
<tr><td>${ok} <b>F7 202 race, F3 in-process block</b></td><td>the run accepted by the loading fire starts at once (A1 completed 09:22:16, 8 s after the load); <b>no slot</b> skipped as hosted_session_blocked on that stack (56 fired)</td></tr>
<tr><td>${no} <b>F9 crashed prompt reaches the model again</b></td><td>the next run still receives the crashed prompt merged into its own (A2: both Occurrences, the crashed HOLD honoured again: 93.5 s). The new exclusion looks for turn_result records that the history never contains</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:34%">Paths round 3 did not cover</th><th>Measured</th></tr>
<tr><td>${open} <b>overlap skip definition, same crash</b></td><td>Spring skips every slot (11 on S1), so nothing loads the Session; its wake Broker session keeps the <b>Workspace lease</b>: another Session's read_file Turn got <b>1775 &times; workspace_busy over 8 min</b>, until my user Turn loaded S1</td></tr>
<tr><td>${neu} <b>one Broker error during the park settlement</b></td><td>the fail-closed branch keeps the Session blocked but consumes the crashed input, so nothing retries: after <b>two clean Harness restarts</b> the pump still fails "await_runtime is not a model-start phase"; 28 min later the lease is still held, 25 slots skipped</td></tr>
<tr><td>${neu} <b>a user Turn is the first thing to load the crashed Session</b></td><td>that Turn <b>FAILED hosted_turn_failed</b> (await_runtime) while the recovery behind it succeeded; the next Turn worked. <b>2/2</b></td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:34%">Tests</th><th>Result</th></tr>
<tr><td><b>TS Harness, 6 files</b></td><td><b>612/612</b> on a host at load ~8-10, including the reworked F7/F3 test that failed 5/5 in round 3. Java and core sources unchanged since round 3 (1433/0, 150/150). CI: 22 passing, 0 failing</td></tr>
<tr><td><b>Mutation check</b></td><td>removing the unblock is caught; removing the park settlement, failing open in the catch, or removing the F9 exclusion is <b>not caught</b></td></tr>
</table>`, 1240);

// ---------- 02 F9 inert ----------
cards['02-f9-not-fixed'] = page(`
<h1>F9 - the new history exclusion never fires on the real path</h1>
<p class="sub">Messages the model receives after a crashed run, as logged by the gateway (system prompt omitted). The exclusion drops user records whose prompt has an error or cancelled <b>turn_result record</b> in the history it is given.</p>
<div class="two">
<div><p class="lbl hd">head e5342cf59c, stack a4: A2's 09:22 run after the 09:21 crash</p>
<pre>user       USER::init-A2 ...
assistant  READY
user       <span class="crit">schedule:09:21:00Z</span> + schedule:09:22:00Z   <- one message
           the gateway honoured the crashed HOLD::90: 93.5 s</pre>
<p class="lbl hd" style="margin-top:10px">head, stack s4: S2's 09:32 run (a user Turn loaded S2 at 09:31)</p>
<pre>user       USER::init-S2 ...
assistant  READY
user       <span class="crit">schedule:09:21:00Z</span> + USER::s2-user        <- one message
assistant  PONG
user       schedule:09:32:00Z</pre></div>
<div><p class="lbl">why the records never meet the rule</p>
<pre>sink.project() carries branch checkpoints and committed
  messages only; a turn result is a <b>turn.settled</b> journal
  event (managed-session-message-projection.ts)
the tool-profile filter keeps records whose daemonPromptId
  is settled; turn_result records carry no daemonPromptId
the unit test hands the runner a turn_result record (a
  shape no caller builds) and runs without a toolTurn, where
  an older filter already drops unanswered prompts: with the
  new function deleted it still passes (mutation, 34/34)</pre>
<p class="lbl cd" style="margin-top:10px">candidate: same rule, read from turn.settled (stack c5)</p>
<pre>C2 09:41 run   user  schedule:09:41:00Z only     2.6 s
C1 09:41 run   assistant  READY + read_file call (crashed)
               tool       cancelled result
               user       schedule:09:41:00Z        200</pre></div>
</div>
<div class="note">A first attempt that applied the same function to the full projection was still inert (stack c4: the 09:33 run carried both Occurrences), which is how the projection gap above was confirmed.</div>`, 1240);

// ---------- 03 skip ----------
const W = 1176, x0 = 150, x1 = W - 20;
const t0 = 9 * 60 + 20, t1 = 9 * 60 + 35;
const X = (h, m, s = 0) => x0 + ((h * 60 + m + s / 60 - t0) / (t1 - t0)) * (x1 - x0);
const slots = (y, from, to, color, label) => {
  let g = '';
  for (let m = from; m <= to; m++) g += `<rect x="${X(9, m) - 9}" y="${y}" width="18" height="18" rx="3" fill="${color}"/>`;
  return g + (label ? `<text x="${X(9, to) + 16}" y="${y + 14}" fill="${C.text2}" font-size="12">${label}</text>` : '');
};
let axis = '';
for (let m = 20; m <= 35; m++) axis += `<line x1="${X(9, m)}" x2="${X(9, m)}" y1="30" y2="210" stroke="${C.grid}"/><text x="${X(9, m)}" y="226" fill="${C.muted}" font-size="11" text-anchor="middle">09:${String(m).padStart(2, '0')}</text>`;
cards['03-skip-holds-workspace'] = page(`
<h1>Overlap skip: the crashed Session is never loaded, and its wake session keeps the Workspace</h1>
<p class="sub">Stack s4, head e5342cf59c. S1 calls read_file every minute (overlap skip); the Harness is SIGKILLed and restarted at 09:21:13 while S1's turn waits on the tool result. S3 is an ordinary Session on the same Workspace.</p>
<svg width="${W}" height="236" viewBox="0 0 ${W} 236">
${axis}
<text x="0" y="52" fill="${C.text}" font-size="13">S1 slots</text>
${slots(38, 21, 21, C.cand)}${slots(38, 22, 32, C.crit)}${slots(38, 33, 35, C.good)}
<text x="${X(9, 22) - 9}" y="30" fill="${C.crit}" font-size="12">skipped(overlap) x11 - Spring still sees the 09:21 run as running</text>
<text x="0" y="102" fill="${C.text}" font-size="13">S3 read_file</text>
<rect x="${X(9, 24, 23)}" y="88" width="${X(9, 32, 33) - X(9, 24, 23)}" height="18" rx="3" fill="${C.crit}" opacity="0.85"/>
<text x="${X(9, 24, 23) + 8}" y="101" fill="#fff" font-size="12">1775 x 409 workspace_busy (09:24:27 - 09:32:30); lease holder: S1's wake-58cf...</text>
<rect x="${X(9, 32, 33) - 3}" y="88" width="8" height="18" rx="2" fill="${C.good}"/>
<text x="0" y="152" fill="${C.text}" font-size="13">S1 user Turns</text>
<circle cx="${X(9, 32, 30)}" cy="146" r="7" fill="${C.crit}"/><text x="${X(9, 32, 30) - 10}" y="174" fill="${C.crit}" font-size="12" text-anchor="end">09:32:30 loads S1: FAILED hosted_turn_failed (await_runtime)</text>
<circle cx="${X(9, 33, 11)}" cy="146" r="7" fill="${C.good}"/><text x="${X(9, 33, 11) + 12}" y="150" fill="${C.good}" font-size="12">09:33:11 completed</text>
<text x="0" y="200" fill="${C.muted}" font-size="12">legend:</text>
<rect x="60" y="188" width="14" height="14" rx="3" fill="${C.cand}"/><text x="80" y="200" fill="${C.text2}" font-size="12">crashed run</text>
<rect x="170" y="188" width="14" height="14" rx="3" fill="${C.crit}"/><text x="190" y="200" fill="${C.text2}" font-size="12">skipped / refused</text>
<rect x="320" y="188" width="14" height="14" rx="3" fill="${C.good}"/><text x="340" y="200" fill="${C.text2}" font-size="12">ran / completed</text>
</svg>
<div class="note">The author scoped the <b>skip</b> case out as a follow-up. On this stack it is more than one dark definition: until something loads the crashed Session, its wake Broker session holds the Workspace execution lease (no expiry), so every other Session's tool Turn on that Workspace waits. S2 (text, skip) was dark for 10 slots the same way. Both recovered within seconds of the load. The user Turn that did the load failed; the same happened on stack u4 (2/2).</div>`, 1240);

// ---------- 04 fail-closed ----------
cards['04-failed-settlement-wedges'] = page(`
<h1>One Broker error during the park settlement wedges the Session and the Workspace for good</h1>
<p class="sub">Stack f4, head e5342cf59c. F1 calls read_file every minute (overlap allow). Crash inside the tool call as before; while the Harness is down the tap is told to answer the next execution status read with 503 (one was consumed), then all rules are cleared.</p>
<pre>09:21:14  Harness SIGKILL + restart; tap: next GET executions/&lt;id&gt; -&gt; 503
09:22:07  fire loads F1 -&gt; recovery -&gt; stopParkedRuntimeExecutions -&gt; status read <span class="crit">503</span>
          "could not recover the parked runtime" -&gt; runtimePending: Session stays blocked (fail-closed)
          the crashed input is <b>consumed anyway</b>; the fire's 202 run waits
09:23-09:27  fire_run -&gt; 409 hosted_session_blocked x5; F2 (other Session) read_file: <span class="crit">588 x workspace_busy</span>
09:27:05  Harness restart (no faults any more)
09:28:03  fire loads F1 -&gt; nothing to recover (input consumed) -&gt; the pump runs the next input:
          <span class="crit">Monitor wake pump ... failed: await_runtime is not a model-start phase</span>
09:29:27  Harness restart again
09:30:08  fire loads F1 -&gt; <span class="crit">the same failure</span>
09:49     still: wake-9001... READY and the Workspace lease holder; 25 slots skipped(hosted_session_blocked)
          F2: the Turn that was waiting across the restart ended FAILED managed_runtime_recovery_blocked
          (unresolved_after_settle), and every new F2 Turn now fails the same way</pre>
<div class="note">Fail-closed holds in-process, but nothing ever retries the settlement: the pump only re-arms while blocked, the consume write drops the input that would re-trigger recovery on the next load, and the recovery sits under <b>settled !== undefined</b>, which is false once the run is already failed. This is round 3's F8 wedge again, reached through a single transient error.</div>`, 1240);

// ---------- 05 candidate + user turns ----------
cards['05-candidate-and-user-turns'] = page(`
<h1>Candidate for F9, and what the rule does to user Turns once it works</h1>
<p class="sub">candidate-r4.patch (+38/-9, hosted-harness-session.ts): derive the unanswered prompts from <b>turn.settled</b> events (outcome error or cancelled), which the call sites already read, and drop their user records from both history builders.</p>
<div class="two">
<div><p class="lbl cd">candidate, stack c5 - same crash as a4</p>
<pre>09:40:12  Harness SIGKILL + restart (C1 mid read_file, C2 mid HOLD)
09:41:02  C2 09:41 run: <span class="good">only its own prompt</span>, 2.6 s
09:41:07  C1 crashed run failed, read_file settled cancelled,
          wake session RELEASED; 09:41 run completed 09:41:15
09:41:37  C2 user Turn: no crashed prompt in its history
09:41:37  C3 read_file Turn completed in 9 s, 0 workspace_busy</pre></div>
<div><p class="lbl">user Turn A/B: cancelled at 10 s, or failed (gateway 400);
then "What is my locker code? ... reply exactly: UNKNOWN"</p>
<pre>                     head (rule inert)     candidate
cancelled "4711"     model sees it -&gt;      prompt dropped -&gt;
                     <span class="hd">"4711"</span>                <span class="cd">"UNKNOWN"</span>
failed    "9090"     model sees it -&gt;      prompt dropped -&gt;
                     <span class="hd">"9090"</span> (hedged)       <span class="cd">"UNKNOWN"</span></pre></div>
</div>
<div class="note">The rule covers every turn that ended error or cancelled. Turns without a toolTurn already drop such prompts (an older filter in the runner), so this matches that path's design; for Spring Sessions, which all run with a toolTurn, it is a visible change: a cancelled or failed user prompt leaves the model's context, where on head it stays. Worth a line in the PR description; if user Turns should keep it, restrict the set to wake inputs.</div>`, 1240);

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
