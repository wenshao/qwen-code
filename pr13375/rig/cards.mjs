// Renders evidence cards for PR #13375 to PNG (Playwright, deviceScaleFactor 2).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fa427b97-be17-4fef-8cd0-0e8d0787846e/scratchpad';
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const OUT = path.join(SP, 'fig');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:1100px;max-width:1500px}
h1{font-size:22px;margin:0 0 4px;color:#f0f6fc}
.sub{font-size:13.5px;color:#8b949e;margin-bottom:18px;line-height:1.45}
table{border-collapse:collapse;font-size:13.5px;margin:6px 0 14px;width:100%}
th{background:#161b22;color:#8b949e;text-align:left;font-weight:600;padding:7px 10px;border:1px solid #30363d;white-space:nowrap}
td{padding:7px 10px;border:1px solid #30363d;vertical-align:top;line-height:1.4}
td.mono, .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;font-size:12.5px;line-height:1.45;white-space:pre;overflow:hidden;margin:6px 0 12px}
.note{border-left:4px solid #388bfd;padding:6px 12px;background:#0f1d33;font-size:13.5px;line-height:1.5;margin-top:10px}
.note.red{border-color:#f85149;background:#2a1215}.note.amber{border-color:#d29922;background:#2a2112}
.add{color:#3fb950}.del{color:#f85149}
`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card">${body}</div></body></html>`;
const table = (head, rows) =>
  `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td${typeof c === 'object' && c.cls ? ` class="${c.cls}"` : ''}>${typeof c === 'object' ? c.html : esc(c)}</td>`).join('')}</tr>`)
    .join('')}</table>`;
const c = (html, cls) => ({ html, cls });

const cards = {};

cards['01-real-stack-ab'] = page(`
<h1>PR #13375 · Real stack A/B: one 192,000-char / 224,000-byte streamed answer</h1>
<div class="sub">Packaged Spring managed-agent-server (Java 21.0.12) + fresh MySQL 8.4.7 per run + bundled Hosted Harness <span class="mono">dist/cli.js</span> (Node 22.23.2) + deterministic fake OpenAI model.
Driver: the PR's own <span class="mono">run-managed-agent-server-e2e.ts --big-output</span> (base arm runs the same runner against the base bundle; Java runtime code is identical, same jar sha256 <span class="mono">0c9d6ab1f944…</span>).
Turn 1 streams the long answer; both owners are killed and both homes deleted; Turn 2 runs on a cold replacement Harness + Spring.</div>
${table(['Arm (bundle built from)', 'Runs', 'Turn 1 terminal', 'Public deltas = source', 'Stored answer record (MySQL)', 'Turn 2 on cold replacement'], [
  [c('<b>base</b> <span class="mono">b2c95e04</span><br><span class="dim">PR\'s main parent</span>'), '2', c('turn.failed<br><span class="mono">hosted_turn_failed</span>', 'bad'), c('192,000 / 192,000 ✓ (streamed in full, then lost)', 'warn'), c('<b>none</b> — only the 481-byte user message', 'bad'), c('not reached (runner stops)', 'dim')],
  [c('<b>PR head</b> <span class="mono">8684862d</span>'), '3', c('turn.completed', 'ok'), c('192,000 / 192,000 ✓', 'ok'), c('<span class="mono">managed-message-chunks</span> 799 B → 4 × <span class="mono">managed-message-part</span><br><span class="mono">61,440 + 61,440 + 61,440 + 40,150</span>', 'ok'), c('turn.completed; next model request contains the full first answer; 8,000-char control stays inline', 'ok')],
  [c('<b>trial merge</b> with main <span class="mono">481b4837</span><br><span class="dim">tree f37b433d, no conflicts</span>'), '2', c('turn.completed', 'ok'), c('192,000 / 192,000 ✓', 'ok'), c('same layout', 'ok'), c('turn.completed; full context restored', 'ok')],
])}
<pre>base Harness: ManagedSessionRecordError: resource bytes exceed the 65536-byte inline limit; OSS storage is not enabled.
PR runs:      c6d5a49a… (rev 114→130)   5c46f22c… (130→147)   23bd1fc0… (122→140)    all EXIT 0
merge runs:   4f09c2ab… (rev 129→147)   41110a42… (131→146)                           all EXIT 0</pre>
<div class="note">Before the PR, the user sees the whole answer stream and then a failed Turn with nothing durable (#13326). With the PR, the same answer commits as manifest + byte parts, survives losing both owners and their homes, and is fed back to the model on the cold replacement.</div>
`);

cards['02-fail-closed-damage'] = page(`
<h1>Damaged chunk rows fail closed on a cold Workspace load (real MySQL)</h1>
<div class="sub">PR head bundle. After Turn 1 (chunked answer) both owners are killed and their homes deleted; one stored row is then damaged directly in <span class="mono">qwen_managed_session_resource</span>.
A probe Turn goes to the cold replacement; the exact bytes are then restored and the normal Turn 2 must restore full context. Generated by fail-closed anchor edits of the PR runner.</div>
${table(['Damage (SQL)', 'Runs', 'Harness POST /session/:id/load', 'Model requests during probe', 'Public probe Turn outcome', 'Restore exact bytes → Turn 2'], [
  [c('1 byte flipped in a <span class="mono">managed-message-part</span> (same length)'), '4', c('409 <span class="mono">hosted_turn_recovery_required</span><br><span class="dim">"resource failed verification"</span>', 'ok'), c('0', 'ok'), c('turn.failed <span class="mono">hosted_harness_unavailable</span> after 5 Spring retries (~37 s)', 'warn'), c('4/4 completed, full prior answer in model context', 'ok')],
  [c('<span class="mono">managed-message-part</span> row deleted'), '3', c('409 <span class="mono">hosted_turn_recovery_required</span><br><span class="dim">"resource does not exist"</span>', 'ok'), c('0', 'ok'), c('same', 'warn'), c('2/3 completed; <b>1/3</b> failed <span class="mono">managed_session_open_failed</span>:<br><span class="mono">"writer grant is stale or unavailable"</span> on all 6 retries', 'warn')],
  [c('<span class="mono">managed-message-chunks</span> manifest row deleted'), '1', c('409 <span class="mono">hosted_turn_recovery_required</span>', 'ok'), c('0', 'ok'), c('same', 'warn'), c('1/1 completed', 'ok')],
])}
<pre>Harness   load refused (workspace_verify): ManagedSessionStoreHttpError: Managed Session Store GET /resources/023cd91b-…
          failed after 3 attempts: The Managed Session resource failed verification.            → 409
Spring    DaemonHttpException: POST /session/:id/load failed with HTTP 409:
          {"error":"hosted_turn_recovery_required","code":"hosted_turn_recovery_required"}      → retry 1..5, then
          turn.failed {"code":"hosted_harness_unavailable","message":"Hosted Harness remained unavailable before Turn admission."}</pre>
<div class="note">No damaged load ever reached the model with a truncated history. The public code names the Harness, not the damaged Session:
<span class="mono">HostedHarnessClient</span> maps named refusals only for ambiguous statuses, so a 409 is retried as transient — existing Spring behaviour, not introduced here.
The 1/8 restore failure was not reproduced in 7 further restores and is not attributed to this PR.</div>
`);

cards['03-merge-m5b-duplicate'] = page(`
<h1>Merge interaction: main's M5b restore re-records chunked tool results</h1>
<div class="sub"><span class="mono">LocalManagedRuntimeOutcomes.restoreRecordedResults()</span> (#13291, on main after this PR's base) decides "already recorded" by reading each
<span class="mono">tool_result</span> body with plain <span class="mono">resources.read()</span>. After the merge, a local tool_result record above 64 KiB is a chunk manifest, so its ids are not found.
Probe = main's own M5b case "reads no git branch when a restore has nothing to re-record" with only the tool output size changed; real on-disk local Managed Session, reopen → <span class="mono">recoverCommittedReceipts()</span>.</div>
${table(['Arm', 'Tool output', 'Record bytes', 'Stored as', 'tool_result events after reopen', 'functionResponse(call-a) in projected history'], [
  [c('main <span class="mono">481b4837</span>'), 'small / 70,000 ASCII / 30,000 CJK', c('454 / 140,438 / 180,436', 'mono'), c('managed-message ×3', 'mono'), c('1 / 1 / 1', 'ok'), c('1 / 1 / 1', 'ok')],
  [c('trial merge <span class="mono">4f787e7a</span>'), 'same', c('454 / 140,438 / 180,436', 'mono'), c('managed-message / <b>managed-message-chunks</b> ×2', 'mono'), c('1 / <b>2 / 2</b>', 'bad'), c('1 / <b>2 / 2</b>', 'bad')],
  [c('trial merge + 1-line candidate'), 'same', c('454 / 140,438 / 180,436', 'mono'), c('managed-message / managed-message-chunks ×2', 'mono'), c('1 / 1 / 1', 'ok'), c('1 / 1 / 1', 'ok')],
])}
<pre>  packages/core/src/managed-runtime/managed-runtime-outcomes.ts
<span class="add">+ import { readManagedMessageBody } from './managed-message-chunks.js';</span>
  …
<span class="del">-      const body = await session.resources
-        .read(ref)</span>
<span class="add">+      const body = await readManagedMessageBody(
+        (bodyRef) => session.resources.read(bodyRef),
+        ref,
+      )</span>
         .then((bytes) => bytes.toString())
         .catch(() => undefined);</pre>
<div class="note red">Second record id: <span class="mono">recovered-tool-result:call-a</span>. The duplicate is silent (the body still parses as JSON). Window: a crash or kill between the batch's tool_result flush and
<span class="mono">finalizeBatch()</span> — the window M5b exists to repair. Candidate on the merge tree: probe 3/3 + M5b, chunk and projection suites 82/82 pass.
Not reachable from this PR alone (M5b is not in its base); it appears once main is merged in.</div>
`);

function mutationCard() {
  const rows = readFileSync(path.join(SP, 'results/mut/mutation-results.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  return page(`
<h1>Mutation matrix on PR head: do the PR's tests notice each change being undone?</h1>
<div class="sub">One mutant at a time in the PR worktree (exact-anchor edits, source restored after each; core <span class="mono">dist</span> rebuilt when CLI suites consume it).
Suites: the PR-touched core files and CLI <span class="mono">workspace-recovery-session</span> (full) / <span class="mono">hosted-harness-session</span> (the 7 PR cases). Coverage off. Verdict needs a parsed total &gt; 0.</div>
${table(['#', 'Mutant', 'Verdict', 'Failing suite(s): result'], rows.map((r) => [
  r.id,
  r.desc,
  c(r.verdict, r.verdict === 'KILLED' ? 'ok' : r.verdict === 'SURVIVED' ? 'warn' : 'bad'),
  c(r.suites.map((s) => `<span class="mono">${esc(s.suite)}</span>: ${esc(s.summary)}`).join('<br>'), 'mono'),
]))}
<div class="note">${esc(process.env.MUT_NOTE ?? '')}</div>
`);
}

const which = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();
for (const name of [...Object.keys(cards), '04-mutation-matrix']) {
  if (which.length && !which.includes(name)) continue;
  const html = name === '04-mutation-matrix' ? mutationCard() : cards[name];
  const file = path.join(OUT, `${name}.html`);
  writeFileSync(file, html);
  await pg.goto('file://' + file);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await pg.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name, clipped ? `WARNING: ${clipped} pre clipped` : 'ok');
}
await browser.close();
