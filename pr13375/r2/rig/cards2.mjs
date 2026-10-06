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
  '05-r2-real-stack': page(`
<h1>Round 2 · PR #13375 @ <span class="mono">5476c4c9</span> on the real stack</h1>
<div class="sub">New head = merge of <span class="mono">8684862d</span> + main <span class="mono">9cdb0f38</span> with the M5b reader fix. Fresh CLI bundles for head and its main parent; same Spring jar for both (no Java runtime diff; sha256 <span class="mono">b06e6b9b…</span>);
fresh MySQL 8.4.7 per run; Java 21.0.12; Node 22.23.2; the PR's <span class="mono">--big-output</span> runner and the same fail-closed damage variant as round 1.</div>
<h2>192,000-char / 224,000-byte answer</h2>
${table(['Arm', 'Runs', 'Turn 1', 'Deltas = source', 'Stored answer', 'Turn 2 on cold replacement'], [
  [['<b>base</b> <span class="mono">9cdb0f38</span> (head\'s main parent)'], ['2'], ['turn.failed <span class="mono">hosted_turn_failed</span>', 'bad'], ['192,000 / 192,000 (then lost)', 'warn'], ['none — 481-byte user message only;<br><span class="mono">"exceed the 65536-byte inline limit"</span>', 'bad'], ['not reached', 'dim']],
  [['<b>head</b> <span class="mono">5476c4c9</span>'], ['3'], ['turn.completed', 'ok'], ['192,000 / 192,000', 'ok'], ['manifest + 4 parts', 'ok'], ['turn.completed; full first answer in model context (sessions e72a01b6…, c83f3b3b…, 78357d70…)', 'ok']],
])}
<h2>Damaged chunk rows after both owners die (head)</h2>
${table(['Damage', 'Harness load', 'Model requests during probe', 'Public probe Turn', 'Restore bytes → Turn 2'], [
  [['part byte flipped (same length)'], ['409 <span class="mono">hosted_turn_recovery_required</span> ×6 — "failed verification"', 'ok'], ['0', 'ok'], ['turn.failed <span class="mono">hosted_harness_unavailable</span>', 'warn'], ['completed', 'ok']],
  [['part row deleted'], ['409 ×6 — "does not exist"', 'ok'], ['0', 'ok'], ['same', 'warn'], ['completed', 'ok']],
  [['manifest row deleted'], ['409 ×6 — "does not exist"', 'ok'], ['0', 'ok'], ['same', 'warn'], ['completed', 'ok']],
])}
<div class="note">Same behaviour as round 1 on <span class="mono">8684862d</span>: the fix holds, and damaged chunks never reach the model. The public code is still Spring's generic <span class="mono">hosted_harness_unavailable</span> (existing mapping, deferred by the author).</div>
`),
  '06-r2-fix-verification': page(`
<h1>Round 2 · the M5b merge interaction is fixed, and the fix is pinned</h1>
<div class="sub"><span class="mono">git show --remerge-diff 5476c4c9</span>: the merge commit hand-changes only 4 files. They are <span class="mono">managed-runtime-outcomes.ts</span> (+7/−2, byte-identical to my round-1 candidate, blob <span class="mono">d384c8fb91</span>), its test, and one paragraph in each design doc. Every other path equals the automatic merge.</div>
${table(['Check (head 5476c4c9)', 'Result'], [
  [['Round-1 probe: small / 70,000 ASCII / 30,000 CJK tool output, reopen → <span class="mono">recoverCommittedReceipts()</span>'], ['tool_result events 1 / 1 / 1; functionResponse(call-a) 1 / 1 / 1 (was 1 / 2 / 2 on the unfixed merge)', 'ok']],
  [['Author\'s new case <span class="mono">does not re-record an existing $kind tool result…</span> (inline + chunked, two recoveries)'], ['passes on head', 'ok']],
  [['M11: undo the fix (plain <span class="mono">resources.read</span>)'], ['KILLED — the chunked case fails, the inline case passes (1 failed | 27 passed)', 'ok']],
  [['core: chunks, HTTP store, projection, runtime outcomes + probe'], ['135 / 135', 'ok']],
  [['CLI: <span class="mono">workspace-recovery-session</span> · scripts runner test'], ['53 / 53 · 7 / 7', 'ok']],
  [['CLI: 7 PR cases in <span class="mono">hosted-harness-session</span>'], ['21 runs: 20 green; 1 run failed once in the <i>inline</i> recovered-Write case (<span class="mono">history</span> missing from <span class="mono">GET /files/history</span>) and passed 20/20 afterwards', 'warn']],
  [['CI <span class="mono">Test (ubuntu-latest, Node 22.x)</span> red leg'], ['every package passed (core 34,937, cli 39,480); vitest exit 1 from 1 unhandled rejection in <span class="mono">memoryLifecycle.integration.test.ts</span> (<span class="mono">extract-cursor.json</span> chmod ENOENT after temp teardown). PR touches no memory files; main push CI green; 6/6 local runs clean → unrelated flake, rerun', 'warn']],
  [['main drift'], ['main is now <span class="mono">4ce35fc9</span> (+1 docs-only commit #13499): no new message readers; merges cleanly', 'ok']],
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
