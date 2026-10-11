// Evidence cards for PR #13219 -> fig/out/*.png (Playwright element shots).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RIG = '/Users/wenshao/pr13219-rig';
const require = createRequire(`${RIG}/src-head/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out-r2`;
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
.grid2{display:grid;grid-template-columns:860px 860px;gap:16px 18px}
.crop2{width:860px;height:533px;overflow:hidden;border:1px solid #30363d;border-radius:6px;background:#fff}
.crop2 img{width:1147px;margin-left:-275px;margin-top:-86px}
`;
const card = (id, inner) => `<div class="card" id="${id}">${inner}</div>`;
const row = (cells, cls = []) => `<tr>${cells.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('')}</tr>`;

const shot2 = (src, cap) => `<div class="shot2"><div class="crop2"><img src="file://${src}"></div><div class="cap">${cap}</div></div>`;
const fig1 = card('fig1', `
<h1>PR #13219 round 2 — head <code>b372721</code> vs main <code>6936c77</code></h1>
<div class="sub">Same real stack as round 1 (Spring jar + packaged Hosted Harness + embedded Broker + MySQL 8.4, fresh DB per run, fault taps), both arms rebuilt. Fast retry config for both arms: backoff 200 ms → 1 s, budgets 3 / 3 / 2. Round 1 was <code>bc1a436</code>.</div>
<table>
<tr><th>round-1 item</th><th>status at b372721</th></tr>
${row(['F1 — stale <code>activePrompts</code> pinned every later Turn', '<span class="good">fixed</span> (candidate applied + probe hardening). Follow-ups after a budget terminal: A, B, C all COMPLETED, 1 request each; same for the pre-existing protocol-error path; production defaults: Turn 1 FAILED at 308.6 s, follow-up COMPLETED'], ['s'])}
${row(['F2 — budget-terminated close stuck in <code>closing</code>', '<span class="good">fixed</span>: after the Harness returns, a fresh close (new key) is admitted (202) and COMPLETES in 1.4 s; a DELETE meanwhile is still 409 <code>session_state_conflict</code>, as documented'], ['s'])}
${row(['R2-32 — card vanished after a terminal answer', '<span class="good">resolved through main #13609</span> (merged into the branch): the card stays with “could not be confirmed… Retry the same option”, and one re-click completes the Turn without reloading'], ['s'])}
${row(['HTTP seal retry claim', '<span class="warn">withdrawn</span> (dfcb2a2, R1-38); the description was corrected today (R9-2). Seal behaviour is now identical on both arms'], ['s'])}
</table>
<table style="margin-top:18px">
<tr><th>scenario (round 2)</th><th>base (main)</th><th>head (PR)</th></tr>
${row(['Admitted Turn, <code>/prompt</code> 503 forever', '<span class="bad">31 attempts / 60 s, never terminal</span> (self-heals)', '<span class="good">FAILED <code>hosted_harness_unavailable_after_admission</code>, 4 attempts, 4.6 s</span>'], ['s'])}
${row(['409 <code>hosted_turn_recovery_in_progress</code> for 15 s', 'retries 9, completes', '<span class="good">exempt: cf 9 / exempt 9, no terminal, completes</span>'], ['s'])}
${row(['409 <code>hosted_turn_recovery_required</code>', 'FAILED with that code (pre-admission budget)', 'same (2.7 s)'], ['s'])}
${row(['Running Turn whose event stream keeps resetting', 'retries for the whole 50 s window, no cancel; the model call is still running when the window ends', '<span class="good"><code>POST /cancel</code> 204 at +2.7 s, model call aborted at once, FAILED at +2.9 s</span>; follow-up COMPLETED'], ['s'])}
${row(['Close, writer live, <code>DELETE</code> 503 for 25 s', 'RUNNING / PENDING (looks healthy), then COMPLETED', '<span class="good">RECOVERY_BLOCKED <code>session_close_writer_live</code> (14 exempt)</span>, then COMPLETED + SEALED'], ['s'])}
${row(['Close after a Harness restart (stale boot id)', 'COMPLETED (main G3 adopts the new boot)', '<span class="good">COMPLETED, all 11 attempts exempt</span> (budget 3 not spent)'], ['s'])}
${row(['Gap (seq 4–5) / lost <code>turn.completed</code>', '<span class="bad">0/7, 188 throws; 6/12, 163 throws</span>', '<span class="good">one ERROR each; 7/7; 12/12, orphan item <code>failed</code></span>'], ['s'])}
${row(['Unreadable event row, 150 s', '<span class="bad">1334 lines, 9.3 MB</span>; repaired row caught up in 0.3 s', '<span class="good">11 lines, one ERROR, 104 KB</span>; <span class="warn">repaired row waited 12.5 s</span>'], ['s'])}
${row(['Action answer, <code>resolve</code> 503', 'retries; delivers itself after the fault clears', '<span class="good">FAILED <code>action_response_delivery_failed</code> (<code>java_durable</code>) in 4 s</span>; same key + body → 202 <code>replayed</code> → COMPLETED in 1 s'], ['s'])}
${row(['Startup: pre &gt; post, negatives', 'boots', '<span class="good">refuses, naming the values</span>'], ['s'])}
</table>`);

const fig2 = card('fig2', `
<h1>Upgrade with work in flight — main V67 retrying, then head applies V68 on the same MySQL database</h1>
<div class="sub">Faults stay on across the upgrade (<code>DELETE</code> 503, <code>/prompt</code> 503, <code>resolve</code> 503). Spring and the Harness are both swapped from main to head (fast retry, budget 3). Values are attempt_count | budget_exempt_attempt, or the Turn's consecutive_failures.</div>
<pre>
                       main (15 s in)              head, first look                head, then
 A  CLOSE              RUNNING  attempts 9          RUNNING  11 | exempt 10        stale-boot wait published (hosted_harness_generation_mismatch),
                                                     <span class="good">backfill marked the old attempts exempt</span>   then FAILED session_lifecycle_delivery_failed at 14 | 11
                                                                                   <span class="good">= exactly 3 charged attempts after the upgrade</span>
 B  admitted Turn      ACCEPTED retry 9             ACCEPTED retry 11 | cf 1       FAILED after cf 3  <span class="good">(full budget; retry_count kept for pacing)</span>
 C  ACTION_RESPONSE    RUNNING  attempts 9          <span class="bad">FAILED action_response_delivery_failed 10 | 0</span>   <span class="warn">at its first post-upgrade failure: excluded from the backfill</span>
</pre>
<div class="note">V68 applied cleanly on a database main had migrated to V67 (Flyway history: 66, 67 from main, 68 at the upgrade). The backfill gives in-flight closes and Turns a full budget, as its comment promises. In-flight approval answers are excluded on purpose (their exempt watermark doubles as the “Harness already answered” latch), so they terminate at the first failure after an upgrade. That is recoverable (the Web Shell now shows the retry notice and the same key re-admits), but it is the one in-flight shape that gets no grace. Resetting <code>attempt_count</code> for those rows instead of marking them exempt would give the grace without touching the latch.</div>`);

const fig3 = card('fig3', `
<h1>Web Shell after a terminal approval answer (main #13609 is now in the branch)</h1>
<div class="sub">Vite dev Web Shell (<code>?managedProvider=java</code>) → Spring → Harness. Bound Session, <code>write_file</code> needs approval, <code>resolve</code> answers 503 while the user clicks “Yes, allow once”.</div>
<div class="grid2">
${shot2(`${RIG}/fig/ui-head/02-after-budget-terminal.png`, '<b>head</b>, ~7 s after the click: the answer is <code>FAILED action_response_delivery_failed</code>; the card stays and says why.')}
${shot2(`${RIG}/fig/ui-head-noreload/05-after-reclick.png`, '<b>head</b>, fault cleared, one re-click on the same card (no reload): same key re-admitted → <code>HARNESS_CONFIRMED</code>, Turn COMPLETED 4.6 s later.')}
${shot2(`${RIG}/fig/ui-base/02-after-budget-terminal.png`, '<b>base</b>, 42 s after the click: the same notice (#13609 reports an answer still unsettled after ~30 s), while the answer keeps retrying (24 calls).')}
${shot2(`${RIG}/fig/ui-base/03-fault-cleared-10s.png`, '<b>base</b>, fault cleared: the answer delivered itself; Turn COMPLETED with no user action.')}
</div>
<div class="note green">R2-32 (deferred) no longer describes the product: the failure is visible within seconds and recoverable in place. The remaining difference is the one this PR chose: head needs the user to click again, base would eventually deliver on its own. The R2-32 thread can be closed with a pointer to #13609.</div>`);

const fig4 = card('fig4', `
<h1>Test strength round 2 — and what three surviving mutants do on the real stack</h1>
<div class="sub">One mutant per guard on a committed worktree at <code>b372721</code>. Java: 12 PR-touched classes. qwencode: <code>HostedHarnessClientTest</code>. TS: the three managed-runtime files the PR still changes. Survivors were rebuilt into a Spring jar and run on the stack.</div>
<table>
<tr><th>mutant (survived unit tests)</th><th>head on the stack</th><th>mutant jar on the stack</th></tr>
${row(['<b>F1c</b> — status probe flattens a generation change into a busy retry', 'stale entry + Harness restart: follow-up A COMPLETED (adopts the new boot, then waits out the old writer lease: 28 × 409 <code>managed_session_writer_conflict</code>, exempt)', '<span class="bad">A FAILED after 3 retries, never adopts the new boot</span>'], ['s'])}
${row(['<b>N6</b> — Turn budget ignores exempt failures', '6 exempt 409s, then 503s: <span class="good">4 more attempts (budget 3 honoured)</span> before FAILED', '<span class="bad">FAILED at the first 503</span>'], ['s'])}
${row(['<b>N13</b> — journaled events do not reset <code>consecutive_failures</code>', 'stream reset every 2.5 s while the model streams 60 ticks: <span class="good">2/2 COMPLETED</span> (counter reset at 23 s, 41 s)', '<span class="bad">2/2 FAILED at 38 s</span>'], ['s'])}
</table>
<table style="margin-top:14px">
<tr><th>suite</th><th>killed</th><th>other survivors</th></tr>
${row(['Java (34)', '27', 'MessageMaterializer cap / surface-every-time / no-reset (same as round 1, R2-8); J15 (a non-blocked Broker refusal\'s own code in the terminal record); N11 (admission reset, same family as N13)'], ['s'])}
${row(['qwencode (3)', '2', 'F1c (above)'], ['s'])}
${row(['TS (8)', '8', '—'], ['s'])}
</table>
<div class="note">Candidate test for F1c attached (fails on the mutant, 70/70 on head). N6 and N13 need a coordinator-level test with a store that records the counters; the stack runs above are the witness until then.</div>`);

const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><body>${[fig1, fig2, fig3, fig4].join('<br>')}</body>`;
fs.writeFileSync(`${RIG}/fig/cards-r2.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1840, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(`file://${RIG}/fig/cards-r2.html`);
await page.waitForTimeout(500);
const names = { fig1: 'r2-01-status-and-claims', fig2: 'r2-02-upgrade-inflight', fig3: 'r2-03-webshell-after-terminal-answer', fig4: 'r2-04-mutation-and-stack' };
for (const [id, name] of Object.entries(names)) {
  const el = page.locator(`#${id}`);
  const clipped = await el.evaluate((n) => [...n.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await el.screenshot({ path: `${OUT}/${name}.png` });
  const box = await el.boundingBox();
  console.log(name, Math.round(box.width), 'x', Math.round(box.height), 'clippedPre=', clipped);
}
await browser.close();
