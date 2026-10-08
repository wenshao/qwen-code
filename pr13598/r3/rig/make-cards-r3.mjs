// Evidence cards for the PR 13598 verification report (English only; the
// Chinese text lives in the comment's collapsed block). Renders each card
// with the head worktree's Playwright and screenshots the #card element.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13598-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13598-rig/fig/r3';
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
<h1>PR #13598 @ 1734df7be4 - real-stack re-verification (round 3)</h1>
<p class="sub">Same rig as rounds 1-2 (PR Spring jar + PR Hosted Harness + embedded Runtime Broker + MySQL 8.4.7 + real qwen3.8-max, macOS arm64), now with a Harness-to-Broker tap on every stack and every automation prompt asking the model to call read_file.</p>
<table>
<tr><th style="width:34%">Round-2 finding</th><th>Round 3 at 1734df7be4</th></tr>
<tr><td>${ok} <b>F6 automation turn cannot use a Workspace tool</b></td><td>Broker id is now <b>wake-&lt;sha256(runId:input)&gt;</b>. A read_file definition ran every minute for 38 min: <b>38/38 runs completed</b>, 39/39 wake read_file executions success, 39 wake Broker sessions released</td></tr>
<tr><td>${part} <b>F7 blocked Session keeps accepting fires</b></td><td>later fires: <b>409 hosted_session_blocked</b>, recorded skipped. But the fire that triggers the first load after a crash still gets 202 before the pump blocks the Session; that run waits for the next Harness restart (<b>3/3</b>)</td></tr>
<tr><td>${part} <b>F3 Harness crash mid-run</b></td><td>the crashed input is consumed, so a restart no longer re-blocks. In-process the Session stays blocked until a Harness restart: XA dark <b>9 slots</b>, a user Turn FAILED hosted_turn_recovery_required</td></tr>
<tr><td><span class="good">&#10003;</span> <b>F1, F5, claim protocol</b></td><td>user Turn during a HOLD run: <b>129 s</b> (round 2: 128 s); P1/P2 answers as in round 2; cross-Session reuse 409, one relay under a 3 s hold, non-ASCII cron 400, per_run 409</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:34%">New in round 3</th><th>Measured</th></tr>
<tr><td>${neu} <b>F8 Harness crash while an automation turn waits on a Workspace tool</b></td><td>the Session never runs again: every user Turn <b>FAILED hosted_turn_failed</b> ("await_runtime is not a model-start phase"), also after a second restart; the wake Broker session keeps the <b>Workspace execution lease</b>, so tool Turns of other Sessions spin on 409 workspace_busy (1448 refusals in 6.5 min). 2/2 repros. The same crash in a user Turn completes 69 s after the crash. Harness-only candidate (+36) fixes it on the same stack</td></tr>
<tr><td>${neu} <b>F9 the crashed run's prompt reaches the model again</b></td><td>its unanswered user record stays in history and is merged into the next prompt: the next scheduled run (3/3) and even a user's own Turn (the gateway honoured the crashed prompt's HOLD::80)</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:34%">Suites</th><th>Result</th></tr>
<tr><td><b>Java / TS</b></td><td>Java module <b>1433/0</b> (1 skipped); TS core 150/150; Harness 4 files 530/533 on a loaded host: 2 pass alone, the new <b>F7/F3 test fails 5/5</b> alone (SessionTranscriptChangedError on the consume write, racing its 50 ms replay polls; green with 2 s polls and on CI)</td></tr>
</table>`, 1240);

// ---------- 02 F8 ----------
cards['02-crash-inside-tool-call'] = page(`
<h1>F8 - a Harness crash inside an automation turn's tool call wedges the Session and the Workspace</h1>
<p class="sub">The tap holds the Harness's poll for the read_file result; the Harness is SIGKILLed and restarted while the turn waits. Same crash in three places: an automation turn on head, a user Turn on head (control), an automation turn on the candidate.</p>
<div class="two" style="grid-template-columns:1.25fr 1fr">
<div><p class="lbl hd">head 1734df7be4 - automation turn (stack w3)</p>
<pre>05:22:57 manual run W1: wake turn calls read_file
05:23:05 Harness SIGKILL + restart
05:25:51 W2 (another Session, same Workspace) read_file
         acquire -&gt; <span class="crit">409 workspace_busy</span> x1448, 05:25:54-05:32:24
         (never gave up; ended when I restarted the Harness)
05:28:05 W1 user Turn -&gt; <span class="crit">FAILED hosted_turn_failed</span>
         await_runtime is not a model-start phase
05:32:24 Harness restart #2
05:35:55 W1 user Turn -&gt; <span class="crit">FAILED hosted_turn_failed</span> (same)
end      wake-310b... <span class="crit">READY</span>; Workspace lease holder: wake-310b...</pre>
<p class="lbl" style="margin-top:10px">stack z3: same crash, minute <i>allow</i> definition, so a fire loads the Session</p>
<pre>05:39:09 crashed run failed; Session blocked
05:40:39 Z3 read_file Turn: <span class="crit">416 x workspace_busy</span> in 2 min
05:44:01 after restart #2: wake pump <span class="crit">failed: await_runtime</span>
end      wake-29e8... READY; Workspace lease holder: wake-29e8...</pre></div>
<div><p class="lbl">control - head, the same crash in a USER Turn (stack v3)</p>
<pre>05:30:51 V1 user Turn calls read_file
05:30:54 Harness SIGKILL + restart
05:30:59 /load 409 x4 (dead writer lease)
05:32:00 /load 200, /managed-runtime/continue 200
05:32:03 Turn <span class="good">COMPLETED</span>
end      runtime session <span class="good">RELEASED</span>; lease <span class="good">free</span></pre>
<p class="lbl cd" style="margin-top:10px">candidate (+36, Harness only) - automation turn (stack c3)</p>
<pre>05:58:00 C1 wake turn calls read_file
05:58:11 Harness SIGKILL + restart
05:59:06 crashed run failed; parked read_file
         settled cancelled; wake session <span class="good">RELEASED</span>
05:59:11 05:59 run <span class="good">completed</span> (read_file success)
06:00:05 06:00 run <span class="good">completed</span>
06:00:50 C3 read_file Turn <span class="good">COMPLETED</span> in 7 s
         0 x workspace_busy; lease free</pre></div>
</div>
<div class="note">Why: the F3 path settles the run and writes a turn_result, but nothing settles the parked Runtime execution, so the Session stays at <b>await_runtime</b> and no turn can start; and nothing releases the wake Broker session, whose Workspace execution lease has no expiry. A user Turn gets this from the takeover (<b>recoverHostedRuntimeTurn</b> / <b>continue</b>); a wake turn never does. The candidate calls the existing <b>stopParkedRuntimeExecutions</b> + <b>settleParkedTurnCancelled</b>, releases the Broker session, then clears <b>session.blocked</b>.</div>`, 1240);

// ---------- 03 F3 + F7 slot strip ----------
const K = {
  crash: [C.crit, 'fired, Harness crashed in the turn'],
  overlap: ['#5a5955', 'skipped: overlap'],
  writer: ['#45443f', 'skipped: writer conflict'],
  blocked: [C.warn, 'skipped: hosted_session_blocked'],
  stranded: [C.cand, 'fired 202, waited for the next restart'],
  ok: [C.good, 'fired, completed'],
};
const slots = ['05:23','05:24','05:25','05:26','05:27','05:28','05:29','05:30','05:31','05:32','05:33','05:34','05:35'];
const rowsF3 = [
  ['XA  skip', ['crash','overlap','overlap','overlap','overlap','overlap','overlap','blocked','overlap','blocked','ok','overlap','ok']],
  ['XB  allow', ['crash','writer','stranded','blocked','blocked','blocked','blocked','blocked','blocked','blocked','ok','ok','ok']],
];
const cw = 74, x0 = 96, rh = 34;
let svg = `<svg width="${x0 + cw * slots.length + 4}" height="${38 + rh * rowsF3.length + 26}" xmlns="http://www.w3.org/2000/svg">`;
slots.forEach((s, i) => { svg += `<text x="${x0 + i * cw + cw / 2}" y="16" fill="${C.muted}" font-size="12" text-anchor="middle">${s}</text>`; });
rowsF3.forEach(([label, cells], r) => {
  const y = 26 + r * rh;
  svg += `<text x="0" y="${y + 19}" fill="${C.text}" font-size="13" font-weight="600">${label}</text>`;
  cells.forEach((k, i) => { svg += `<rect x="${x0 + i * cw + 1}" y="${y}" width="${cw - 2}" height="${rh - 8}" rx="4" fill="${K[k][0]}"/>`; });
});
// restart markers
const mark = (t, label) => { const i = slots.indexOf(t.slice(0,5)); const frac = Number(t.slice(6,8)) / 60; const x = x0 + (i + frac) * cw; svg += `<line x1="${x}" x2="${x}" y1="22" y2="${26 + rh * rowsF3.length}" stroke="${C.text}" stroke-width="2" stroke-dasharray="3 3"/><text x="${x + 4}" y="${26 + rh * rowsF3.length + 16}" fill="${C.text2}" font-size="12">${label}</text>`; };
mark('05:23:35', 'crash + restart');
mark('05:32:24', 'restart #2');
svg += '</svg>';
const legend = Object.values(K).map(([c, l]) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;color:${C.text2};font-size:12.5px"><span style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></span>${l}</span>`).join('');
cards['03-blocked-session'] = page(`
<h1>F3 / F7 - after a crash, fires are now refused, but the Session stays blocked until a restart</h1>
<p class="sub">Stack x3, head. Two minute definitions with 80 s turns; the Harness was SIGKILLed at 05:23:35 with both 05:23 runs mid-turn, and restarted at once.</p>
${svg}
<div style="margin:6px 0 4px">${legend}</div>
<div class="two" style="margin-top:10px">
<div><p class="lbl">XA (overlap skip)</p>
<pre>05:24-05:29 skipped(overlap): Spring still sees the 05:23
         run running, then the user Turn below
05:28:05 user Turn loads the Session, completes 05:29:33;
         the pump settles the 05:23 run <b>failed</b>, consumes it,
         and leaves the Session <span class="warn">blocked</span>
05:30, 05:32 fire_run -&gt; <span class="good">409 hosted_session_blocked</span>
05:30:43 user Turn -&gt; <span class="crit">FAILED hosted_turn_recovery_required</span>
05:33 first run after restart #2: completed</pre></div>
<div><p class="lbl">XB (overlap allow)</p>
<pre>05:25:00 fire loads the Session; fire_run -&gt; <span class="cd">202</span>
         the pump then settles 05:23 failed and blocks
         the 05:25 run: <span class="cd">running/unbound</span> for 8 min
05:26-05:32 fire_run -&gt; <span class="good">409 hosted_session_blocked</span>
05:33:03 after restart #2 the 05:25 run starts,
         completed 05:34:25
same race on z3: Z1 and Z2 05:39 runs (3/3)</pre></div>
</div>
<div class="note">Nothing but a reload clears <b>session.blocked</b> (only <b>settleCancelledHookTurn</b> does, for hooks), and nothing reloads a cached Session except a Harness restart or a close. The candidate in card 2 clears it once the crash is fully settled, which also lets the 202-accepted run start.</div>`, 1240);

// ---------- 04 F9 ----------
cards['04-crashed-prompt-replayed'] = page(`
<h1>F9 - the crashed run's prompt is sent to the model again with the next turn</h1>
<p class="sub">The F3 path writes a turn_result for the crashed input, but its user record stays in the transcript with no answer. The model client merges it with the next user message, so the next turn carries both instructions. Messages after the system prompt, as logged by the model gateway.</p>
<div class="two">
<div><p class="lbl hd">head, stack z3 - the 05:39 run after the 05:38 crash</p>
<pre>user       USER::init-Z2 ...
assistant  READY
user       <span class="crit">schedule:05:38:00Z</span> + schedule:05:39:00Z   <- one message</pre>
<p class="lbl hd" style="margin-top:10px">head, stack x3 - a user's own Turn after the 05:23 crash</p>
<pre>req 40  05:28:05  XA user Turn "Reply with exactly: USER-A1"
        last user message begins with the crashed run's text:
        "Scheduled automation: crash skip ... Occurrence:
         schedule:2026-10-08T05:23:00Z ..."
        the gateway honoured that prompt's <span class="crit">HOLD::80</span>:
        the request took 87.6 s, the user Turn 88 s</pre></div>
<div><p class="lbl cd">candidate, stack c3 - text crash (C2): unchanged</p>
<pre>user       USER::init-C2 ...
assistant  READY
user       <span class="crit">schedule:05:58:00Z</span> + schedule:05:59:00Z   <- one message</pre>
<p class="lbl cd" style="margin-top:10px">candidate, stack c3 - tool crash (C1)</p>
<pre>user       schedule:05:58:00Z
assistant  tool_call read_file
tool       tool_result (cancelled by the settle)
user       schedule:05:59:00Z</pre></div>
</div>
<div class="note">The run record says <b>failed / outcome_unknown</b>, yet its instructions are executed again inside the next run, or inside whatever the user types next. For an automation with side effects that is a second execution the ledger never shows. Seen 4/4 where a turn followed a text crash (XA, XB, Z2, C2). The candidate does not address this; options are an answer record for the crashed turn or leaving its user record out of the next turn's history.</div>`, 1240);

// ---------- 05 fixed + regressions ----------
cards['05-fixed'] = page(`
<h1>What round 3 confirms on the real stack</h1>
<p class="sub">Head 1734df7be4 unless noted; stack h3.</p>
<pre>F6  T1 '* * * * *' read_file run, 05:20-05:57: occurrences fired 38, runs completed 38
    wake read_file executions: success 39 (T1 + manual T2), each returned "BEACON-h3-9691"
    Broker runtimeSessionId = wake-sha256(runId + ':input'), e.g. arun_3e737d29...:input -&gt; wake-af4de998...
    05:20:06 manual T2 acquire -&gt; 409 workspace_busy x11 while T1 held the shared Workspace, then 200
    every wake Broker session RELEASED (39)
F1  S1 HOLD::100 run from 05:20:03; user Turn sent 05:20:30 -&gt; 409 x7 (backoff) -&gt; 202 at 05:22:37
    -&gt; COMPLETED 05:22:39 (129 s); the 05:21 and 05:22 slots skipped(overlap)
F5  P1  update U lost (503) | update B 202 rev 2 | retry U -&gt; 202 replay=true rev 1 | GET rev 2 goal B
    P2  retire X key R lost | retire Y key R -&gt; 409 idempotency_conflict, Y live | retry X -&gt; 202 replay, X retired
I   two Sessions, one key, relay held 3 s: B 409 in 27 ms, A 202 in 3078 ms, one relay
    cron '&#1637; * * * *' -&gt; 400 invalid_automation; session_mode per_run -&gt; 409 automation_mode_disabled
F7  9 later fires into blocked Sessions (x3) -&gt; 409 hosted_session_blocked, slot skipped with that reason
F3  crashed inputs consumed: a restart after the settle no longer re-blocks (XA fired again at 05:33)</pre>
<div class="note">Not re-measured: F4 (scheduler code unchanged since round 2). Not runnable on this rig: Session close (L3 needs Linux durable local-process), monitor wake turns (Spring creates only hosted-workspace-files/1 Sessions).</div>`, 1240);

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
