// Evidence cards for the PR 13598 verification report (English only; the
// Chinese text lives in the comment's collapsed block). Renders each card
// with the head worktree's Playwright and screenshots the #card element.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13598-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13598-rig/fig/r7';
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

const fixed = '<span class="good">&#10003; FIXED</span>';
const isnew = '<span class="crit">&#9888; NEW</span>';
const pass = '<span class="good">&#10003; PASS</span>';

// ---------- 02 P1-1: Shell under Tool v3 publication ----------
cards['02-p1-1-shell-publication'] = page(`
<h1>P1-1: a wake turn's Shell under Tool v3 publication</h1>
<p class="sub">Linux durable stack, Spring Tool publication on (fake Aliyun OSS over TLS), shell-profile Sessions. Same scripted model, same prompts; only the build differs.</p>
<table>
<tr><th style="width:30%"></th><th style="width:35%">round 6 build <span class="hd">786c319111</span></th><th style="width:35%">this head <span class="cd">9f809670c7</span></th></tr>
<tr><td><b>user Turn</b> Shell (control)</td><td>success</td><td>success</td></tr>
<tr><td>Shell output published to the fake OSS (PUT + read-back)</td><td>user Turn only</td><td>user Turn + 3/3 wake runs</td></tr>
<tr><td><b>wake turn</b> Shell, <code>deferred_v3</code> (with <code>captureBytes</code>), 3 manual runs</td><td class="crit"><b class="crit">3/3 not_started</b>, run <b class="crit">failed</b><br>reference.promptId = <code>wake-fe4db09…</code></td><td class="good"><b class="good">3/3 success</b>, run <b class="good">completed</b><br>reference.promptId = <code>arun_24adf75…:input</code></td></tr>
<tr><td><b>wake turn</b> Shell, plain <code>deferred</code> (no <code>captureBytes</code>), 1 manual run</td><td class="crit">execution <b class="crit">UNKNOWN</b> right after <code>:start</code>; the aftermath failed <b class="crit">1065</b> times in 14 min ("Runtime execution outcome is unknown") and the lease stayed held</td><td class="good">success; run completed; lease released</td></tr>
</table>
<h2>The prepare request, as bundled</h2>
<div class="two"><div><p class="lbl">786c319111</p><pre>request("/executions:prepare", {
  turnId: this.identity.runtimeSessionId,
  ...
  reference: {
    sessionId: this.identity.runtimeSessionId,
    promptId: this.identity.runtimeSessionId,</pre></div>
<div><p class="lbl">9f809670c7</p><pre>request("/executions:prepare", {
  turnId,          // the logical prompt id
  ...
  reference: {
    sessionId: this.identity.runtimeSessionId,
    promptId: turnId,</pre></div></div>
<div class="note">A user Turn's Runtime Session id equals its prompt id, so only wake turns (<code>arun_…:input</code> mapped to <code>wake-&lt;sha256&gt;</code>) diverged. The deferred_v3 row turns on this prepare; the plain deferred row on the same pair in the Shell publisher's register reference (d3663df6f7, unpinned until 586a24e82a). Spring never sends <code>captureBytes</code> in this tree; the rig adds it to the shell-profile create body at the Spring&#8594;Harness tap, the field the Harness API accepts.</div>
`, 1240);

// ---------- 03 P1-2: RELEASING on a cold Broker ----------
cards['03-p1-2-cold-releasing'] = page(`
<h1>P1-2: a Runtime Session left RELEASING, then a cold Broker</h1>
<p class="sub">R1 runs read_file every minute (allow). Harness SIGKILLed mid read_file; this stack's runtime workers SIGSTOPped so the aftermath's release times out (30 s) and the row stays RELEASING; then Spring (embedded Broker) and the Harness are restarted, workers resumed.</p>
<div class="two">
<div><p class="lbl">round 6 build <span class="hd">786c319111</span> (stack c6)</p><pre>15:05:40 acquire  409 runtime_session_not_acquirable
         (no release: the 409 was taken as "released")
15:05:42 acquire  409 workspace_busy   x995 by 15:10:29

row  wake-b5c513f1  <span class="crit">RELEASING</span>   lease <span class="crit">held</span>
runs 4 running unbound, 7 slots skipped count_limit
R2 read_file user Turn  <span class="crit">RUNNING</span> (sent 15:09:13)</pre></div>
<div><p class="lbl">this head <span class="cd">9f809670c7</span> (stack c7)</p><pre>15:05:40 acquire  409 runtime_session_not_acquirable
15:05:40 release  <span class="good">200</span>   wake-b5c513f1
15:05:43 acquire  200, prepare 200, release 200
         ... every later slot the same

row  wake-b5c513f1  <span class="good">RELEASED</span>   lease <span class="good">free</span>
runs 9 completed after the restart
R2 read_file user Turn  <span class="good">completed in 8 s</span></pre></div>
</div>
<div class="note">Both stacks ran side by side on the same host. The 3 "missed" slots on each come from a window when the host was saturated by unrelated jobs; they are the same on both arms.</div>
`, 1240);

// ---------- 04 NEW: RELEASING on a live Broker ----------
cards['04-new-warm-releasing'] = page(`
<h1>Found and fixed in c6402589ad: RELEASING on a live Broker</h1>
<p class="sub">Same fault without the Spring restart. The Broker keeps the session context in process, so a RELEASING row answers acquire with <b>runtime_session_not_ready</b>, which the aftermath at 9f809670c7 did not accept. It threw before reaching the release, every pass.</p>
<div class="two">
<div><p class="lbl">this head <span class="cd">9f809670c7</span> (stack e7; round 6 build e6 is identical)</p><pre>14:44:39 release  err (worker stopped, 30 s)
14:44:40 acquire  409 runtime_session_not_ready  x333
         + 339 workspace_busy (R1 runs, R2 user Turn)
14:45:41 workers resumed - nothing changes
14:48:58 <span class="warn">my one manual release</span> -&gt; 200
14:49:00 R2 completes; the stuck run settles 14:49:01

e6 (786c319111): 1008 not_ready + 1790 busy over
12 min, R2 waited 10 min, freed the same way</pre></div>
<div><p class="lbl">same logic as c6402589ad, patched into the bundle (stack e7p)</p><pre>15:23:42 release  err (worker stopped, 30 s)
15:23:42 acquire  409 runtime_session_not_ready
15:24:13 release  err (30 s)    -- retried
15:24:43 release  err (30 s)    -- retried
15:24:44 workers resumed
15:24:44 release  <span class="good">200</span>  (within 1 s)
15:24:48 next runs: acquire 200, prepare, release
R2 user Turn <span class="good">completed in 8 s</span>
cold restart on the same patch (c7p): <span class="good">as c7</span>
bundled from c6402589ad (e7f, c7f): <span class="good">same</span></pre></div>
</div>
<h2>Why the pin test passed at 9f809670c7</h2>
<pre>'finishes the release after a transient release failure, in the very next pass'
  vi.spyOn(HostedWorkspaceBroker.prototype, 'acquire') ... 409 'runtime_session_not_acquirable'
     -&gt; a live Broker answers a RELEASING session with 409 'runtime_session_not_ready'
        (RuntimeBrokerService.requireReadySessionRecord)</pre>
<div class="note">c6402589ad: both adopt sites go through <code>isReleasedOrReleasingAdoptRefusal</code>, which accepts both codes, as <code>hosted-mcp-session.ts</code> already does (#13109). The pin is now <code>it.each</code> over both answers; the not_ready case goes red without the change. The Broker's release of a RELEASING row is idempotent once nothing is active.</div>
`, 1240);

// ---------- 01 summary ----------
const openTag = '<span class="warn">&#9888; OPEN</span>';
const unchanged = '<span class="warn">&#9888; UNCHANGED</span>';
cards['01-summary'] = page(`
<h1>PR #13598 round 7 @ 9f809670c7, plus fixes up to 3d8f482b0a</h1>
<p class="sub">Real-stack verification. Linux durable stack (arm64 container) for the two runtime P1s, before and after; macOS with real qwen3.8-max for the regression pass.</p>
<table>
<tr><th style="width:190px">Item</th><th style="width:110px">Status</th><th>Evidence</th></tr>
<tr><td><b>P1-1</b> wake Shell under Tool v3 publication</td><td>${fixed}</td><td>deferred_v3: round 6 build 3/3 not_started (run failed), this head 3/3 success. Plain deferred: round 6 build UNKNOWN + 1065 aftermath failures with the lease held; this head completes</td></tr>
<tr><td><b>P1-2</b> RELEASING, then a cold Broker</td><td>${fixed}</td><td>round 6 build: 409 not_acquirable, no release, row RELEASING, lease held, 995 workspace_busy in 5 min. This head: release 200 at once, 9 runs complete, user Turn 8 s</td></tr>
<tr><td><b>Found</b>: RELEASING on a live Broker</td><td>${fixed} c6402589ad</td><td>acquire answered 409 runtime_session_not_ready and the aftermath never released: wedged until a manual release (both builds). With the fix: release within 1 s of the worker resuming; cold path unchanged; bundled from c6402589ad itself: same, warm and cold</td></tr>
<tr><td>qwen3.8-max regression</td><td>${held}</td><td>allow crash mid read_file: the crashed run settles 53 s after restart, 6 later runs complete, 0 aftermath failures. Early user Turn completes (round 6 caveat stays: one 60 s backoff)</td></tr>
<tr><td>Round 6: CI red (3 tests)</td><td>${fixed}</td><td>Java contract fixture and both core tests pass locally and on CI</td></tr>
<tr><td>Round 6: deferred burst, close with a live definition</td><td>${unchanged}</td><td>scanner and close code unchanged since round 6; not re-run</td></tr>
<tr><td>CI at 66af9bc185</td><td>${fixed} 3d8f482b0a</td><td>22 passed; 1 failed: Hosted process fault gates (Checkstyle NewlineAtEndOfFile, dropped by the 9f809670c7 merge). 3d8f482b0a restores it; locally the check fails without, passes with. CI on 3d8f482b0a still running</td></tr>
<tr><td>Tests (local, load 50-70)</td><td>${pass}</td><td>Java 1594 run, 1 load error passing alone; TS CLI 666/668, core 225/226, each failure a timeout passing on CI or alone. New commits: 399/399, 243/243</td></tr>
<tr><td>Mutation</td><td>${fixed} 586a24e82a</td><td>P1-2 and P1-1-in-prepareV3 reverts caught. The P1-1 publisher-register revert passed every test, yet breaks the real stack; now pinned. Round 6's reconcile_run survivor still survives</td></tr>
</table>
`, 1240);

// ---------- 05 real model + tests ----------
cards['05-real-model-and-tests'] = page(`
<h1>qwen3.8-max regression, tests and mutation</h1>
<p class="sub">macOS stack m7: the 9f809670c7 jar and dist, MySQL 8.4.7, real qwen3.8-max behind the logging gateway (19 model requests, all 200; 7 carried a read_file result).</p>
<h2>A1: read_file every minute (allow), Harness SIGKILLed mid read_file at 15:32:16</h2>
<pre>arun_8d1f88550  failed     15:32:03 - 15:33:10   (the crashed run settles; aftermath failures: 0)
arun_b01a759bf  completed  15:33:10 - 15:33:19
arun_3737cadfa  completed  15:34:01 - 15:34:11   ... 6 runs after the crash, all completed, lease free</pre>
<h2>U1: manual read_file run crashed mid tool, then a user Turn 10 s after the restart</h2>
<pre>15:36:07.8 prompt 409, then load 409 at +1, +4, +9, +19, +35 s
15:37:18.1 load 200 (+70 s)
15:37:18.7 prompt 409        the park settles at 15:37:19 (run failed)
15:38:19.1 prompt 202        <span class="warn">one capped 60 s backoff after the park settled</span>
15:38:23   turn completed</pre>
<h2>Tests</h2>
<table>
<tr><th>Suite</th><th>Result</th></tr>
<tr><td><b>Java</b>, managed-agent-server @ 66af9bc185</td><td>1594 run, 0 failures, 1 error under load (RuntimeBrokerFlywaySchemaTest, concurrent H2) - 4/4 alone</td></tr>
<tr><td><b>Checkstyle</b></td><td>NewlineAtEndOfFile at 66af9bc185 (CI fault gates job); 0 violations at 3d8f482b0a</td></tr>
<tr><td><b>TS CLI</b>, 5 files @ 66af9bc185</td><td>666/668 - two timeouts (chunked takeover, monitor-wake page); pass on CI</td></tr>
<tr><td><b>TS core</b>, 6 files</td><td>225/226 - slots contract timed out once, 12/12 alone</td></tr>
<tr><td><b>c6402589ad</b>: harness-session + runtime-recovery</td><td>399/399; eslint, prettier, tsc clean</td></tr>
<tr><td><b>586a24e82a</b>: tool-turn + workspace-broker</td><td>243/243</td></tr>
</table>
<h2>Mutation (sources only, each restored)</h2>
<table>
<tr><th>Mutant</th><th>Result</th></tr>
<tr><td>P1-1 reverted in prepareV3</td><td><span class="good">caught</span> (reserves a Tool v3 original under the logical turn id ...)</td></tr>
<tr><td>P1-1 reverted at the publisher register</td><td><span class="crit">not caught</span> at 9f809670c7 (243/243); the real stack breaks (wake Shell UNKNOWN, run failed). <span class="good">Pinned in 586a24e82a</span></td></tr>
<tr><td>P1-2 reverted (skip release on not_acquirable)</td><td><span class="good">caught</span> by 2 tests</td></tr>
<tr><td>c6402589ad reverted</td><td><span class="good">caught</span> by the new not_ready case</td></tr>
<tr><td>reconcile_run while a turn holds the slot (round 6)</td><td><span class="warn">still not caught</span> (337/337)</td></tr>
</table>
`, 1240);

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
