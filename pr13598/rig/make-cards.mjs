// Evidence cards for the PR 13598 verification report (English only; the
// Chinese text lives in the comment's collapsed block). Renders each card
// with the head worktree's Playwright and screenshots the #card element.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/pr13598-head/package.json');
const { chromium } = require('playwright');
const OUT = '/Users/wenshao/git/pr13598-rig/fig';
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

// ---------- 01 summary ----------
cards['01-summary'] = page(`
<h1>PR #13598 @ bc6e076b9d - real-stack verification</h1>
<p class="sub">Spring control plane (PR jar) + Hosted Harness (PR dist/cli.js) + Runtime Broker + MySQL 8.4.7 + real qwen3.8-max, macOS arm64. Every number below comes from run logs, tap records and DB rows.</p>
<table>
<tr><th style="width:52%">Holds on the real stack</th><th>Evidence</th></tr>
<tr><td><span class="good">&#10003; PASS</span> <b>Scheduled fire, one model turn per run</b></td><td>every-minute definitions fired 4-5 s after each slot (5 s scan); every fired occurrence = exactly 1 model request</td></tr>
<tr><td><span class="good">&#10003; PASS</span> <b>Manual run + Idempotency-Key replay</b></td><td>same run id, X-Qwen-Idempotent-Replay: true, no second model call</td></tr>
<tr><td><span class="good">&#10003; PASS</span> <b>Overlap skip / queue_one ledger</b></td><td>skip: fire, skip, fire...; queue_one: 2 fired then skipped(overlap); manual run during a run: 409 automation_run_skipped</td></tr>
<tr><td><span class="good">&#10003; PASS</span> <b>Lost fire answer re-driven</b></td><td>tap dropped the 202 after commit; re-drive 5 s later answered the same run (settled); 1 model call</td></tr>
<tr><td><span class="good">&#10003; PASS</span> <b>Catch-up none / latest / bounded:2</b></td><td>3 min 51 s outage, 60 s tolerance: missed x3 / missed x2 + 1 catch_up / missed x1 + 2 catch_up</td></tr>
<tr><td><span class="good">&#10003; PASS</span> <b>Disable span, validation, authz, gating</b></td><td>re-enable resets armed_at (no fires for the disabled minutes); tz/cron/per_run/64 KiB refused; reader 403, outsider 404; flag off: reads 200, writes 409</td></tr>
</table>
<table style="margin-top:14px">
<tr><th style="width:52%">Findings</th><th>Measured</th></tr>
<tr><td><span class="crit">&#9888; F1</span> <b>User Turn starved by a recurring automation</b></td><td>skip definition (100 s turns): user Turn waited <b>733 s</b>, 18 x 409 hosted_turn_active, admitted only after disable. Candidate: <b>128 s</b></td></tr>
<tr><td><span class="crit">&#9888; F2</span> <b>Spring restart: fires cannot re-attach</b></td><td>plain load 409 hosted_session_already_attached for 7+ min; claim stuck firing, later slots skipped(overlap). Candidate: takeover load, fires at once</td></tr>
<tr><td><span class="crit">&#9888; F3</span> <b>Harness crash mid-run: run never settles</b></td><td>run stays running (rev 2); its definition skipped 11 slots in a row (14:31-14:41), still skipping at my last read</td></tr>
<tr><td><span class="warn">&#9888; F4</span> <b>Scanner shares the 1-thread default scheduler</b></td><td>one 25 s fire answer delayed /items of another Session by <b>20.7 s / 21.3 s</b> (control 3-210 ms). Candidate: <b>5 ms</b></td></tr>
<tr><td><span class="warn">&#9888; F5</span> <b>Open review P1 + P2 reproduce end to end</b></td><td>retrying a lost no-op update overwrote a later revision (rev 3); reused key retired X's answer for Y, mirror retired while journal live</td></tr>
</table>`, 1240);

// ---------- 02 starvation timeline ----------
function lane(y, label, color, runs, refusals, admitted, end, note) {
  const x0 = 210, W = 900, maxS = 780;
  const X = (s) => x0 + (s / maxS) * W;
  let g = `<text x="0" y="${y + 17}" fill="${C.text}" font-size="14" font-weight="600">${esc(label[0])}</text>
<text x="0" y="${y + 35}" fill="${C.text2}" font-size="12">${esc(label[1])}</text>`;
  for (const [a, b] of runs) {
    const xa = Math.max(X(a), x0), xb = Math.min(X(b), x0 + W);
    if (xb > xa) g += `<rect x="${xa}" y="${y + 4}" width="${xb - xa - 2}" height="22" rx="4" fill="${color}"/>`;
  }
  for (const r of refusals) g += `<line x1="${X(r)}" x2="${X(r)}" y1="${y + 30}" y2="${y + 44}" stroke="${C.crit}" stroke-width="2"/>`;
  g += `<circle cx="${X(admitted)}" cy="${y + 37}" r="6" fill="${C.good}" stroke="${C.surface}" stroke-width="2"/>`;
  g += `<text x="${Math.min(X(end) + 12, x0 + W - 4)}" y="${y + 20}" fill="${C.text}" font-size="13" font-weight="600" text-anchor="${X(end) + 160 > x0 + W ? 'end' : 'start'}">${esc(note)}</text>`;
  return g;
}
{
  const t = (hms) => { const [h, m, s] = hms.split(':').map(Number); return h * 3600 + m * 60 + s; };
  // head S2: user Turn submitted 14:07:20; automation c1 (skip, 100 s hold) runs from the model log.
  const h0 = t('14:07:20');
  const headRuns = [['14:07:05', 102.9], ['14:09:00', 102.3], ['14:11:00', 101.6], ['14:13:01', 102.7], ['14:15:01', 101.0], ['14:17:02', 101.5]].map(([s, d]) => [t(s) - h0, t(s) - h0 + d]);
  const headRef = ['14:07:20','14:07:22','14:07:25','14:07:30','14:07:38','14:07:54','14:08:26','14:09:27','14:10:27','14:11:28','14:12:28','14:13:28','14:14:29','14:15:29','14:16:30','14:17:30','14:18:30'].map((s) => t(s) - h0);
  const c3 = t('14:50:21');
  const c3Runs = [[t('14:50:04') - c3, t('14:50:04') - c3 + 102.0]];
  const c3Ref = ['14:50:21','14:50:22','14:50:25','14:50:30','14:50:38','14:50:54','14:51:26'].map((s) => t(s) - c3);
  const c4 = t('14:51:15');
  const c4Runs = [[t('14:50:04') - c4, t('14:50:04') - c4 + 102.2], [t('14:51:47') - c4, t('14:51:47') - c4 + 101.4]];
  const c4Ref = ['14:51:15','14:51:17','14:51:20','14:51:25','14:51:33','14:51:49','14:52:22','14:53:22'].map((s) => t(s) - c4);
  const x0 = 210, W = 900, maxS = 780; const X = (s) => x0 + (s / maxS) * W;
  let axis = '';
  for (let s = 0; s <= 780; s += 60) axis += `<line x1="${X(s)}" x2="${X(s)}" y1="20" y2="292" stroke="${C.grid}" stroke-width="1"/><text x="${X(s)}" y="310" fill="${C.muted}" font-size="11.5" text-anchor="middle">${s}</text>`;
  const svg = `<svg width="1180" height="360" viewBox="0 0 1180 360">
${axis}
<text x="${x0 + W / 2}" y="332" fill="${C.muted}" font-size="12" text-anchor="middle">seconds since the user Turn was submitted</text>
${lane(30, ['Head - overlap skip', 'S2, 1-minute cron, 100 s turns'], C.head, headRuns, headRef, t('14:19:31') - h0, t('14:19:33') - h0, '733 s')}
<line x1="${X(664)}" x2="${X(664)}" y1="26" y2="80" stroke="${C.text2}" stroke-dasharray="4 3"/><text x="${X(664) - 6}" y="92" fill="${C.text2}" font-size="11.5" text-anchor="end">definition disabled (664 s)</text>
${lane(120, ['Candidate - overlap skip', 'T3, same definition shape'], C.cand, c3Runs, c3Ref, t('14:52:27') - c3, t('14:52:29') - c3, '128 s')}
${lane(210, ['Candidate - queue_one', 'T4, one input already queued'], C.cand, c4Runs, c4Ref, t('14:54:22') - c4, t('14:54:25') - c4, '190 s')}
</svg>`;
  cards['02-user-turn-starvation'] = page(`
<h1>F1 - a recurring automation starves the Session's user Turn</h1>
<p class="sub">Bars: automation turns (real qwen3.8-max, gateway holds the call 100 s). Red ticks: the dispatcher's POST /prompt retries answered 409 hosted_turn_active. Green dot: the Turn is admitted.</p>
${svg}
<div class="note">Head: each retry lands inside the next automation turn (the backoff caps at 60 s and the cron re-fires at :00), so the Turn was admitted only after I disabled the definition. A queue_one definition on S3 starved its user Turn for 757 s; there the wake pump started each queued input in the same second the previous run ended (its first run was stretched by my 130 s hold, above the model client's 120 s timeout). Candidate: a waiting public Turn makes the scanner record skipped(overlap); the remaining wait is the in-flight run plus the dispatcher backoff.</div>`, 1240);
}

// ---------- 03 scheduler thread ----------
{
  const rows = [
    ['Head, no slow fire', [210, 3, 3], C.head],
    ['Head, one fire answered 25 s late', [20747, 21320], C.head],
    ['Candidate, one fire answered 25 s late', [5, 5], C.cand],
    ['Candidate, no slow fire', [4], C.cand],
  ];
  const x0 = 330, W = 760, max = 22000; const X = (v) => x0 + (v / max) * W;
  let s = '';
  rows.forEach(([label, vals, color], i) => {
    const y = 26 + i * 64;
    s += `<text x="0" y="${y + 24}" fill="${C.text}" font-size="14">${esc(label)}</text>`;
    vals.forEach((v, j) => {
      const yy = y + j * 15;
      s += `<rect x="${x0}" y="${yy + 6}" width="${Math.max(X(v) - x0, 3)}" height="11" rx="3" fill="${color}"/>`;
      s += `<text x="${Math.max(X(v), x0 + 3) + 8}" y="${yy + 16}" fill="${C.text2}" font-size="12.5">${v.toLocaleString('en-US')} ms</text>`;
    });
  });
  for (let v = 0; v <= 20000; v += 5000) s += `<line x1="${X(v)}" x2="${X(v)}" y1="18" y2="282" stroke="${C.grid}"/><text x="${X(v)}" y="298" fill="${C.muted}" font-size="11.5" text-anchor="middle">${v / 1000} s</text>`;
  const svg = `<svg width="1180" height="312" viewBox="0 0 1180 312">${s}</svg>`;
  cards['03-scheduler-thread'] = page(`
<h1>F4 - the scanner blocks the one-thread default scheduler</h1>
<p class="sub">A user Turn on an unrelated Session: delay between its terminal event on /events and its assistant item on /items (each bar = one probe). The tap delayed one automation fire_run answer by 25 s.</p>
${svg}
<p class="lbl">jcmd Thread.print during the delay (head) - the only "scheduling-1" thread, which also runs MessageMaterializer (100 ms), HarnessCoordinator.recoverExpiredTurns, SessionLifecycleCoordinator.recoverOperations and ActionResponseCoordinator.recover:</p>
<pre>"scheduling-1" #57 ... WAITING (parking)
    at jdk.internal.net.http.HttpClientImpl.send(HttpClientImpl.java:934)
    at com.alibaba.qwen.code.daemon.HostedHarnessClient.runAutomationOperation(HostedHarnessClient.java:336)
    at ...managedagent.harness.QwenHostedHarnessConnector.runAutomationOperation(QwenHostedHarnessConnector.java:407)
    at ...managedagent.service.AutomationScanner.fire(AutomationScanner.java:375)
    at ...managedagent.service.AutomationScanner.decide(AutomationScanner.java:322)
    at ...managedagent.service.AutomationScanner.scan(AutomationScanner.java:92)</pre>
<div class="note">Candidate: a dedicated managedAutomationScheduler (pool 1), the same pattern as runtimeRecoveryScheduler and managedToolOutputScheduler. The scanner itself stays sequential (a later fire still waits), but nothing else does.</div>`, 1240);
}

// ---------- 04 spring restart ----------
cards['04-spring-restart'] = page(`
<h1>F2 - after a Spring restart the scanner cannot re-attach its Sessions</h1>
<p class="sub">Spring killed (SIGKILL) and restarted at 14:20:51 with the Harness still running. Spring -> Harness traffic from the tap; ledger rows from MySQL.</p>
<div class="two">
<div><p class="lbl"><span class="hd">Head</span> - tap, 14:21:04 to 14:23:25</p>
<pre>14:21:04 POST /session/0dfcb4f5/load   <span class="crit">409</span>  (S1, a1)
14:21:04 POST /session/0bf53086/load   <span class="crit">409</span>  (S4, h)
14:21:04 POST /session/20d974b9/load   <span class="crit">409</span>  (S5, j3)
   ... same three every tick, backoff 2-64 s ...
14:21:32 POST /session/20d974b9/load   <span class="good">200</span>  &lt;- user Turn (takeover)
14:21:45 POST .../20d974b9/automations/operations fire_run 202
14:22:20 POST /session/0bf53086/load   <span class="crit">409</span>
14:23:14 POST /session/0dfcb4f5/load   <span class="good">200</span>  &lt;- user Turn (takeover)
14:23:25 POST .../0dfcb4f5/automations/operations fire_run 202
14:23:25 POST /session/0bf53086/load   <span class="crit">409</span>  (S4 had no user Turn)

{"error":"hosted_session_already_attached",
 "code":"hosted_session_already_attached"}</pre></div>
<div><p class="lbl"><span class="hd">Head</span> - S4 ledger and the public API meanwhile</p>
<pre>schedule:14:21:00Z  scheduled  <span class="warn">firing</span>   attempts 7
schedule:14:22:00Z  scheduled  skipped  overlap
schedule:14:23:00Z  scheduled  skipped  overlap
schedule:14:24:00Z  scheduled  skipped  overlap
(stuck until I restarted the Harness at 14:28)

POST /v1/agent-automations/{a1}       (update)
  -&gt; <span class="crit">409 hosted_session_already_attached</span>
POST /v1/agent-automations/{h}/runs   (manual)
  -&gt; <span class="crit">409 automation_run_skipped: overlap</span></pre>
<p class="lbl" style="margin-top:12px"><span class="cd">Candidate</span> - Spring killed 14:48:32, next fire</p>
<pre>14:49:04.341 POST /session/e98658ee/load      <span class="good">200</span>
14:49:04.357 POST .../automations/operations fire_run <span class="good">202</span></pre></div>
</div>
<div class="note">A user Turn re-attaches through recoverManagedRuntime (the takeover load). runAutomationOperation uses attachment(..., true), whose plain load the Harness refuses while the dead process's attachment is registered, so every fire, mutation and manual run on that Session fails until a user Turn happens to take it over.</div>`, 1240);

// ---------- 05 crash mid-run ----------
cards['05-harness-crash-mid-run'] = page(`
<h1>F3 - a Harness crash during an automation turn leaves its run running forever</h1>
<p class="sub">S6: manual run of a 1-minute skip definition at 14:29:23 (model call held 45 s); Harness SIGKILLed at 14:29:38 and restarted 5 s later.</p>
<div class="two">
<div><p class="lbl">Harness log, on both reloads of S6 (after each Harness restart)</p>
<pre>qwen serve: Monitor wake turn
  arun_fd2db8f7...:input needs recovery, not a re-drive.</pre>
<p class="lbl" style="margin-top:12px">qwen_managed_session_extension_record</p>
<pre>automation_run arun_fd2db8f7...  rev 2  <span class="warn">running</span>  settled_at -</pre>
<p class="lbl" style="margin-top:12px">Public cancel paths for that run</p>
<pre>POST /tasks/{taskId}/cancel           -&gt; 404 not_found
POST /events agent.session.cancel
     turn_id=arun_...:input            -&gt; 404 turn_not_found
task.action_capabilities               =  []</pre></div>
<div><p class="lbl">GET /v1/agent-automations/{k1}/runs</p>
<pre>manual:key-k1-manual        manual     fired   <span class="warn">running</span>
schedule:14:31:00Z  scheduled  skipped  overlap
schedule:14:32:00Z  scheduled  skipped  overlap
schedule:14:33:00Z  scheduled  skipped  overlap
   ...  every minute  ...
schedule:14:41:00Z  scheduled  skipped  overlap
(11 consecutive slots; still skipping at my last read,
 although user Turns on S6 worked again from 14:39)</pre></div>
</div>
<div class="note">Control on S7: the same crash during a user Turn ends that Turn FAILED (managed_runtime_recovery_blocked) about 60 s after the restart, so the Session-level blocking is not specific to automation. What is new is the run: nothing settles a dispatched run whose turn died mid-flight, and countActive keeps counting it. The design's fault list covers crashes between commits but not a crash inside the turn; acceptance asks that every fired run end settled, failed or cancelled.</div>`, 1240);

// ---------- 06 idempotency ----------
cards['06-idempotency-lost-answer'] = page(`
<h1>F5 - both open review findings reproduce through the public API</h1>
<p class="sub">Lost answers made with the tap: the Harness commits, the tap drops its 202, Spring answers 503 automation_operation_unknown ("retry the same key").</p>
<p class="lbl">P1 - no-op update U lost, another key revises, the client retries U as told (definition P on S5)</p>
<pre>14:13:01 define_schedule op=8ebcb11e  202 rev 1 goal=P-A  replayed=false       create
14:13:12 define_schedule op=2954b1a5  202 rev 1 goal=P-A  replayed=true   <span class="crit">DROPPED</span>   update U {goal:P-A}  -&gt; client 503
14:13:13 define_schedule op=902e41cf  202 rev 2 goal=P-B  replayed=false       update V {goal:P-B}
14:13:13 define_schedule op=2954b1a5  202 <span class="crit">rev 3 goal=P-A  replayed=false</span>       retry U  -&gt; client 202, B overwritten
GET /v1/agent-automations/{P} -&gt; definition_revision 3, goal P-A</pre>
<p class="lbl" style="margin-top:12px">P2 - retire X with key R lost, then retire Y with the same key R</p>
<pre>14:13:27 retire_schedule target=X op=88994386  202 answered X cancelled  <span class="crit">DROPPED</span>  -&gt; client 503
14:13:27 retire_schedule target=Y op=88994386  202 <span class="crit">answered X</span> cancelled  replayed=true
client: 202 replay=true  id=X (not Y)
Y: control-plane mirror <span class="crit">retired</span> (run/update -&gt; 409 automation_retired)
   journal record revision 1, still live - unchanged after 40 min of scans and 3 restarts</pre>
<div class="note">Same verdict as the 13:25 review threads; this adds the end-to-end path (public route, Spring command ledger, real Harness funnel, MySQL Session Store).</div>`, 1240);

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
