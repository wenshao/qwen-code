// Round-2 evidence cards for PR #13375 @ 5476c4c9 (Playwright, deviceScaleFactor 2).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fa427b97-be17-4fef-8cd0-0e8d0787846e/scratchpad';
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const OUT = path.join(SP, 'fig');

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:1100px;max-width:1500px}
h1{font-size:22px;margin:0 0 4px;color:#f0f6fc} h2{font-size:15px;color:#8b949e;margin:16px 0 4px;font-weight:600}
.sub{font-size:13.5px;color:#8b949e;margin-bottom:14px;line-height:1.45}
table{border-collapse:collapse;font-size:13.5px;margin:6px 0 12px;width:100%}
th{background:#161b22;color:#8b949e;text-align:left;font-weight:600;padding:7px 10px;border:1px solid #30363d;white-space:nowrap}
td{padding:7px 10px;border:1px solid #30363d;vertical-align:top;line-height:1.4}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;font-size:12.5px;line-height:1.45;white-space:pre;overflow:hidden;margin:6px 0 12px}
.note{border-left:4px solid #388bfd;padding:6px 12px;background:#0f1d33;font-size:13.5px;line-height:1.5;margin-top:10px}
`;
const page = (b) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card">${b}</div></body></html>`;
const row = (cells) => `<tr>${cells.map(([h, cls]) => `<td${cls ? ` class="${cls}"` : ''}>${h}</td>`).join('')}</tr>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map(row).join('')}</table>`;

const cards = {
  '07-r3-real-stack': page(`
<h1>Round 3 · PR #13375 @ <span class="mono">5e61060b</span> on the real stack</h1>
<div class="sub">Head = PR + main <span class="mono">e92b60a2</span> (40 main commits since round 2, incl. G3 #13174). Fresh CLI bundles for head and its main parent; one Spring jar for both (no Java runtime diff; sha256 <span class="mono">f01f74f3…</span>);
fresh MySQL 8.4.7 per run; Java 21.0.12; Node 22.23.2. "G3" = the runner's <span class="mono">--harness-only</span> path: Spring stays up and adopts the next Harness generation.
The runner rejects <span class="mono">--big-output --harness-only</span> (bot R1-8), so that arm uses a fail-closed variant that lifts only that guard.</div>
<h2>192,000-char / 224,000-byte answer, then an 8,000-char control on the replacement</h2>
${table(['Arm', 'Runs', 'Result', 'Detail'], [
  [['<b>base</b> <span class="mono">e92b60a2</span>'], ['2'], ['turn.failed <span class="mono">hosted_turn_failed</span>', 'bad'], ['192,000 chars streamed, then lost; only the 481-byte user message stored; "exceed the 65536-byte inline limit"']],
  [['<b>head</b>, both owners replaced (PR runner as-is)'], ['3'], ['3/3 EXIT 0', 'ok'], ['full first answer in the cold replacement’s model request; sessions 1d1fef7f…, 09966467…, 4f8bbe98…']],
  [['<b>head</b>, G3 Harness-only adoption + long answer <span class="dim">(new combination)</span>'], ['3'], ['3/3 EXIT 0', 'ok'], ['new Harness boot id, writer 1 → 2, full first answer in the model request; sessions 21e9bdd9…, e0dc5488…, 5a8b661e…']],
  [['Public replay from event 0 (G3 ×3, full restart ×1)'], ['4'], ['exact 4/4', 'ok'], ['delta text = 200,000 chars = answer 1 + answer 2; 99 deltas, 2 terminals — no re-projection of the long answer after adoption']],
])}
<h2>Damaged chunk rows after Turn 1 (one row edited in <span class="mono">qwen_managed_session_resource</span>)</h2>
${table(['Damage', 'Owner path', 'Harness load', 'Model requests', 'Public probe Turn', 'Restore bytes → Turn 2'], [
  [['part byte flipped (same length)'], ['both replaced'], ['409 ×6 "failed verification"', 'ok'], ['0', 'ok'], ['<span class="mono">hosted_harness_unavailable</span>', 'warn'], ['completed', 'ok']],
  [['part row deleted'], ['both replaced'], ['409 ×6 "does not exist"', 'ok'], ['0', 'ok'], ['<span class="mono">hosted_harness_unavailable</span>', 'warn'], ['completed', 'ok']],
  [['manifest row deleted'], ['both replaced'], ['409 ×6 "does not exist"', 'ok'], ['0', 'ok'], ['<span class="mono">hosted_harness_unavailable</span>', 'warn'], ['completed', 'ok']],
  [['part byte flipped (same length)'], ['<b>G3</b> (Spring alive)'], ['409 ×6 "failed verification"', 'ok'], ['0', 'ok'], ['<span class="mono">hosted_turn_recovery_required</span>', 'ok'], ['completed', 'ok']],
])}
<h2>Rows a session consumes (after both Turns, all 4 replay runs)</h2>
<pre>journal transactions  126–131    (≈ 115 for the streamed long Turn: one per delta batch)
resource rows          25        (of which managed-message-chunks 1 + managed-message-part 4)</pre>
<div class="note">The 4,096-row bounds in bot R1-5 belong to the CSI receipt-checkpoint snapshot (<span class="mono">readOnlyManagedSessionSnapshot</span> / <span class="mono">WorkspaceCsiCheckpointSnapshotStore</span>), whose only caller is <span class="mono">managed-csi-checkpoint-evidence.ts</span> — it answers "unresolved", it is not a cold load. The same snapshot caps <i>transactions</i> at 4,096 too, and a streamed long answer spends ~115 transactions for its 5 chunk rows, so the transaction bound is reached about 5× sooner than the resource bound. Ordinary cold loads page transactions 100 at a time with no such cap; every cold load above succeeded.</div>
`),
  '08-r3-merge-audit': page(`
<h1>Round 3 · merge audit, sweep and suites</h1>
<div class="sub">Two merge commits since round 2: <span class="mono">c3f87096</span> (main <span class="mono">4970bfa1</span>, G3) and <span class="mono">5e61060b</span> (main <span class="mono">e92b60a2</span>).</div>
${table(['Check', 'Result'], [
  [['<span class="mono">git show --remerge-diff c3f87096</span>'], ['6 hand-resolved files, all integration: union of the big-output and G3 steps/aliases/tests; runner keeps G3’s Linux exemption as <span class="mono">runtimeTakeover && !harnessOnly</span> (same as main, where workspaceTurns ≡ runtimeTakeover) and leaves big-output portable; Hosted job pins 117→127 summed / 130→140 job minutes', 'ok']],
  [['<span class="mono">git show --remerge-diff 5e61060b</span>'], ['1 file: test model input keeps both <span class="mono">textDeltas</span> and <span class="mono">workspaceContext</span>', 'ok']],
  [['Effective PR diff vs round 2'], ['all 6 production files byte-identical in added/removed text; changes only in workflow, runner and three tests (+ <span class="mono">hosted-process-ci.test.js</span>)', 'ok']],
  [['Sweep of 40 new main commits for message-body readers / reference walkers'], ['none new: matches are Stage H extension records (child run/acceptance, channel delivery) and an admission record, all their own resource kinds; main since then (+10 to <span class="mono">57e347fa</span>) adds none', 'ok']],
  [['M5b probe (round 1)'], ['1 / 1 / 1 tool_result and functionResponse for small / 70 KB / 30k-CJK', 'ok']],
  [['core: chunks, HTTP store, projection, runtime outcomes + probe'], ['136 / 136', 'ok']],
  [['CLI: <span class="mono">workspace-recovery-session</span> · 7 PR cases of <span class="mono">hosted-harness-session</span>'], ['59 / 59 · 7 / 7', 'ok']],
  [['scripts: <span class="mono">managed-agent-server-e2e</span> + <span class="mono">hosted-process-ci</span>'], ['25 / 25', 'ok']],
  [['CI on <span class="mono">5e61060b</span>'], ['33 pass / 0 fail (Hosted fault gates incl. the long-answer step: pass in 33m43s)', 'ok']],
])}
`),
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
const pg = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  const file = path.join(OUT, `${name}.html`);
  writeFileSync(file, html);
  await pg.goto('file://' + file);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await pg.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name, clipped ? `WARNING: ${clipped} pre clipped` : 'ok');
}
await browser.close();
