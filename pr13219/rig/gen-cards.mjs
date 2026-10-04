// Evidence cards for PR #13219 -> fig/out/*.png (Playwright element shots).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13219-rig';
const require = createRequire(`${RIG}/src-head/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out`;
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{display:inline-block;padding:28px 32px;background:#0d1117;max-width:1760px}
h1{font-size:26px;margin:0 0 4px}
.sub{color:#8b949e;font-size:15px;margin-bottom:18px}
table{border-collapse:collapse;font-size:15px}
th{color:#8b949e;font-weight:600;text-align:left;padding:7px 12px;border-bottom:1px solid #30363d}
td{padding:8px 12px;border-bottom:1px solid #21262d;vertical-align:top;line-height:1.35}
td.s{color:#e6edf3;font-weight:600;width:300px}
.bad{color:#ff7b72}.good{color:#7ee787}.warn{color:#e3b341}.mute{color:#8b949e}
code{font-family:ui-monospace,Menlo,monospace;font-size:13.5px;background:#161b22;padding:1px 5px;border-radius:4px}
.note{border-left:4px solid #e3b341;padding:8px 14px;margin-top:16px;color:#c9d1d9;font-size:15px;max-width:1600px;line-height:1.45}
.note.red{border-color:#ff7b72}.note.green{border-color:#7ee787}
pre{font-family:ui-monospace,Menlo,monospace;font-size:14px;line-height:1.45;margin:0;white-space:pre;color:#c9d1d9}
.shots{display:flex;gap:18px}
.shot{width:560px}
.crop{width:560px;height:516px;overflow:hidden;border:1px solid #30363d;border-radius:6px;background:#fff}
.crop img{width:938px;margin-left:-369px;margin-top:-71px}
.cap{font-size:14.5px;margin:8px 0 2px;line-height:1.4}
`;
const card = (id, inner) => `<div class="card" id="${id}">${inner}</div>`;
const row = (cells, cls = []) => `<tr>${cells.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('')}</tr>`;

const fig1 = card('fig1', `
<h1>PR #13219 on a real stack — the six claims, base vs head</h1>
<div class="sub">Spring jar + packaged Hosted Harness + embedded Broker + MySQL 8.4 (fresh DB per run), fault taps on Spring→Harness and Harness→Session&nbsp;Store. base = main <code>6136786</code>, head = <code>bc1a436</code>. Fast retry config for both arms: backoff 200 ms → 1 s, budgets 3 (post-admission, operations), 2 (pre-admission).</div>
<table>
<tr><th>scenario</th><th>base (main)</th><th>head (PR)</th></tr>
${row(['Admitted Turn, <code>/prompt</code> 503 forever', '<span class="bad">32 attempts in 60 s, Turn ACCEPTED, never terminal</span><br><span class="mute">self-heals once the fault clears</span>', '<span class="good">FAILED <code>hosted_harness_unavailable_after_admission</code> after 4 attempts (3.2 s)</span>'], ['s'])}
${row(['Named load refusal after admission', '<span class="bad">31 refused loads in 60 s, ACCEPTED</span>', '<span class="good">FAILED <code>managed_session_open_failed</code>, 8.9 s after restart; message names the refusal</span>'], ['s'])}
${row(['Projection gap in the middle (seq 4–5 deleted)', '<span class="bad">projection 0/7 forever; 189 stack traces in 20 s; <code>/items</code> empty</span>', '<span class="good">one ERROR <code>missingSequences=4-5 nextEvent=6</code>; 7/7; both items completed</span>'], ['s'])}
${row(['Lost <code>turn.completed</code> (seq 7), then a follow-up', '<span class="bad">6/12 forever; 159 throws; turn-1 text stuck <code>in_progress</code>; follow-up never projected</span>', '<span class="good">heals <code>7-7</code>; orphaned item settled <code>failed</code>; follow-up completed; 12/12</span>'], ['s'])}
${row(['One unreadable event row, 150 s', '<span class="bad">1377 WARN + stack, 9.6 MB of log</span>; repaired row caught up in 25 ms', '<span class="good">11 lines (0.1 → 51.4 → 102.7 s), one ERROR, 96 KB</span>; <span class="warn">repaired row waited 12.5 s for the next tick (≤ 60 s)</span>'], ['s'])}
${row(['Close while the writer is live, Harness <code>DELETE</code> 503 for 25 s', 'kept retrying (16), then COMPLETED + SEALED', '<span class="good">kept waiting past the budget (17 &gt; 3)</span>, then COMPLETED + SEALED'], ['s'])}
${row(['Action answer, <code>resolve</code> 503', 'kept retrying; delivered by itself ≤ 8 s after the fault cleared', '<span class="good">FAILED <code>action_response_delivery_failed</code>, <code>java_durable</code> (4 s)</span>; same key + body → 202 <code>replayed</code>, delivered in 1 s; other body → 409'], ['s'])}
${row(['Seal 503 forever, production defaults', '12 seal calls in 367 s, no renewal; close still retrying', '<span class="good">renew + seal at 58.5 s and 95.2 s; no renewal after 95 s (10 seals by 125 s, past 2 leases); lease lapses ≈ 156 s</span>; close FAILED at 307 s'], ['s'])}
${row(['Startup: pre=6 &gt; post=5, post=-1, op=-1', 'boots', '<span class="good">refuses, naming the values</span> (defaults, pre=post, op=0 boot)'], ['s'])}
</table>
<div class="note green">Every behaviour the PR describes reproduces on the real stack. The cost side is the subject of the next three figures: what a terminal state leaves behind.</div>`);

const fig2 = card('fig2', `
<h1>F1 — after a post-admission terminal, later Turns on the Session fail without reaching the Harness</h1>
<div class="sub">Spring's <code>HostedHarnessClient.activePrompts</code> keeps the prompt whose <code>/prompt</code> answer was ambiguous. Nothing clears it (no <code>turn_complete</code> will ever arrive for it), so <code>submitTurn</code> refuses every new promptId locally with <code>DaemonException: Hosted Harness session already has a running turn</code>, which the coordinator records as <code>hosted_harness_unavailable_after_admission</code>.</div>
<table>
<tr><th>scenario (Harness healthy for every follow-up)</th><th>base</th><th>head</th><th>head + candidate (Spring jar only)</th></tr>
${row(['Turn 1: <code>/prompt</code> 503 ×4, then fault cleared; follow-ups A, B; restart Spring; follow-up C', '<span class="mute">n/a — turn 1 never ends; follow-up 409 <code>turn_active</code></span>', '<span class="bad">A, B FAILED, <b>0</b> prompt requests sent</span><br>C COMPLETED only after restarting Spring', '<span class="good">A, B, C COMPLETED (1 request each)</span>'], ['s'])}
${row(['Turn 1: 503 without the boot-id header → <code>hosted_harness_protocol_error</code> (pre-existing terminal)', '<span class="bad">A accepted, then retried forever with 0 requests; B, C 409</span> until Spring restarts', '<span class="bad">A, B FAILED with 0 requests</span>; C ok after restart', '<span class="good">A, B, C COMPLETED</span>'], ['s'])}
${row(['Harness admitted turn 1 (runs 15 s) but Spring saw 503', 'turn 1 ACCEPTED, 22 idempotent re-admissions (model called once)', '<span class="bad">turn 1 FAILED ≈ 3 s after admission while still running; A and B (after it finished) FAILED</span>', 'A refused while <code>/status</code> says active (correct); <span class="good">B COMPLETED</span>'], ['s'])}
</table>
<div class="note red">The mechanism exists on main for the protocol-error terminal; this PR adds a common new entry point (any transient 5xx/timeout that outlasts the budget) and turns the wedge into repeated terminal failures whose code blames the Harness. With production defaults turn 1 failed at 305.6 s (11 attempts); the follow-up, sent after the fault cleared, then climbed the same 1 s → 60 s ladder logging <code>failure=DaemonException</code> with 0 requests to the Harness. Candidate (+17/−6 src, +51 test): when a different prompt is pinned, ask <code>GET /session/:id/status</code> once — the client already drops the entry on <code>hasActivePrompt=false</code>. New test fails on head, passes on candidate; qwencode suite 173/173.</div>`);

const fig3 = card('fig3', `
<h1>F2 — a budget-terminated close leaves the Session in <code>closing</code> with no API way out</h1>
<div class="sub">Unbound ACTIVE Session, Harness SIGKILLed, close requested (writer lease 20 s, operation budget 3). Then the Harness is restarted, then Spring is restarted. The design doc (durable-lifecycle §4.5) discloses the missing route; this is what it costs on the stack.</div>
<pre>
              base (main)                                           head (PR)
 t 0-20 s     CLOSE running, writer live, retrying                  CLOSE running, writer live: budget held off (12 attempts)
 t ~20 s      writer lease expires; keeps retrying                  <span class="good">FAILED session_lifecycle_delivery_failed, java_durable</span>; Session <span class="warn">closing</span>
 Harness up   every attempt: HostedHarnessGenerationException       (operation already terminal)
              (Spring client keeps the old boot id; pre-existing)   
 same key     202 replay: running                                   202 replay: failed
 new close    409 session_operation_active                          <span class="bad">409 session_state_conflict &quot;The Session is closing ...&quot;</span>
 Spring up    <span class="good">CLOSE COMPLETED (attempt 45) -&gt; CLOSED</span>                <span class="bad">still FAILED / closing</span>
 delete       <span class="good">202 -&gt; DELETED</span>                                        <span class="bad">409 session_state_conflict</span>
</pre>
<div class="note">With production defaults the operation ladder (1 s → 60 s, 10 attempts) runs out in ≈ 5 min (307 s measured in the seal run); after a Harness restart every settle fails with the generation mismatch until Spring restarts, so it does run out. Main recovers on the next Spring restart; head needs an operator to edit the database. Disclosed as follow-up work in the design doc, so not a hidden defect — but the trigger is ordinary.</div>`);

const shot = (src, cap) => `<div class="shot"><div class="crop"><img src="file://${src}"></div><div class="cap">${cap}</div></div>`;
const fig4 = card('fig4', `
<h1>R2-32 (deferred) in the real Web Shell — the answer fails terminally, the card is gone, nothing says so</h1>
<div class="sub">Vite dev Web Shell with <code>?managedProvider=java</code> → Spring (actor header injected) → Harness. Bound Session, <code>write_file</code> needs approval; <code>resolve</code> answers 503 while the user clicks “Yes, allow once”.</div>
<div class="shots">
${shot(`${RIG}/fig/ui-head/03-fault-cleared-10s.png`, '<b>head</b>, fault cleared 10 s ago, no user action.<br><span class="mute">DB: answer <code>FAILED action_response_delivery_failed</code>, Action <code>requested</code>, Turn <code>RUNNING</code>. Page: no card, no alert.</span>')}
${shot(`${RIG}/fig/ui-head/04-after-reload.png`, '<b>head</b>, after a page reload: the card is back.<br><span class="mute">Re-click → same key re-admitted → <code>HARNESS_CONFIRMED</code>, Turn <code>COMPLETED</code> 4 s later.</span>')}
${shot(`${RIG}/fig/ui-base/03-fault-cleared-10s.png`, '<b>base</b>, same steps, fault cleared 10 s ago.<br><span class="mute">Answer kept retrying (29 failed calls) and delivered itself; Turn <code>COMPLETED</code> with no user action.</span>')}
</div>
<div class="note">The re-admission path works, but in the UI it is reachable only by reloading. Until the follow-up lands, the Turn just waits — here until the Action's approval timeout (1800 s in this rig).</div>`);

const fig5 = card('fig5', `
<h1>Test strength — mutation on the PR's own suites</h1>
<div class="sub">One mutant per guard, applied to a committed worktree, restored after each run. Java: 8 PR-touched test classes (94 tests). TS: the four managed-runtime files (73 tests).</div>
<table>
<tr><th>area</th><th>killed</th><th>survivors</th></tr>
${row(['Gap heal (4 mutants)', '<span class="good">4/4</span>', '—'], ['s'])}
${row(['Turn budget, refusal / broker codes, startup check (4)', '<span class="good">4/4</span>', '—'], ['s'])}
${row(['Lifecycle terminal: writer gate, settle-succeeded, blocked code, fence, CONFIRMED (5)', '<span class="good">5/5</span>', '—'], ['s'])}
${row(['Action re-admission + stage + unprojected decision (5)', '<span class="good">5/5</span>', '—'], ['s'])}
${row(['MessageMaterializer backoff (4)', '<span class="warn">1/4</span>', 'cap 60 s → 600 s; ERROR on every failure past the budget; success does not reset — <span class="mute">matches bot findings R2-8 (open) and R2-7 (resolved). The real stack did witness the cap (catch-up 12.5 s = 102.7 + 60 − 150) and surface-once.</span>'], ['s'])}
${row(['HTTP seal retry (5)', '<span class="warn">4/5</span>', 'attempt bound 10 → 10000 — <span class="mute">on the stack both bounds were already met when the cadence stopped (10 seals by 125 s, 2 leases = 120 s), so the backstop is not observable there either.</span>'], ['s'])}
${row(['Assembly finally, journal tail repair, scheduler budgets / recheck (8)', '<span class="good">8/8</span>', '—'], ['s'])}
</table>
<div class="note green">Java 19/22, TS 12/13. The scheduler and FileManagedActivationStore have no production caller, so these suites are their only witness — and they hold up.</div>`);

const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><body>${[fig1, fig2, fig3, fig4, fig5].join('<br>')}</body>`;
fs.writeFileSync(`${RIG}/fig/cards.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1840, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(`file://${RIG}/fig/cards.html`);
await page.waitForTimeout(500);
const names = { fig1: '01-claims-base-vs-head', fig2: '02-f1-stale-active-prompt', fig3: '03-f2-close-stuck-closing', fig4: '04-webshell-r2-32', fig5: '05-mutation' };
for (const [id, name] of Object.entries(names)) {
  const el = page.locator(`#${id}`);
  const clipped = await el.evaluate((n) => [...n.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await el.screenshot({ path: `${OUT}/${name}.png` });
  const box = await el.boundingBox();
  console.log(name, Math.round(box.width), 'x', Math.round(box.height), 'clippedPre=', clipped);
}
await browser.close();
