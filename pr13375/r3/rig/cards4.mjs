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
  '09-r3-post-merge': page(`
<h1>Post-merge · squash commit <span class="mono">2a69a2ff</span> on main</h1>
<div class="sub">The PR merged at 19:41Z while round 3 was running. The squash parent is main <span class="mono">57e347fa</span>, 10 commits past the PR's last main base <span class="mono">e92b60a2</span>. Those commits include W1c offline Workspace migration (#13260), M5c (#13352) and Workspace-context invalidation (#13605), none of which ran with the PR before. Fresh CLI bundle + fresh Java build (29 Java runtime files differ from the PR head), fresh MySQL 8.4.7.</div>
${table(['Check', 'Result'], [
  [['Squash tree vs automatic merge of <span class="mono">57e347fa</span> + <span class="mono">5e61060b</span>'], ['identical (<span class="mono">f53ca9f7</span>): no hand changes at merge time', 'ok']],
  [['Readers on main after merge: every non-test literal of the three message kinds'], ['only <span class="mono">managed-message-chunks.ts</span> and the recovery allowlist; W1c migration reuses the chunk-aware <span class="mono">verifyRecoverySession</span> (<span class="mono">purpose: ’migration’</span>) and compares file trees, not resources', 'ok']],
  [['<span class="mono">--big-output</span>, both owners replaced'], ['2/2 EXIT 0 (sessions 011efb8d…, 0a37bd63…): full text preserved, full first answer in the cold model request', 'ok']],
  [['<span class="mono">--big-output --harness-only</span> (G3, variant)'], ['EXIT 0; public replay from event 0 exact (200,000 chars)', 'ok']],
  [['Part byte flipped after Turn 1'], ['409 ×6, 0 model requests; restoring the bytes → Turn 2 completes; replay exact', 'ok']],
  [['core: chunks, HTTP store, projection, runtime outcomes + M5b probe'], ['136 / 136; probe 1 / 1 / 1', 'ok']],
  [['CLI: <span class="mono">workspace-recovery-session</span> + <span class="mono">-bundle</span> + <span class="mono">-worker</span> (incl. W1c migration) · 7 PR cases of <span class="mono">hosted-harness-session</span>'], ['141 / 141 · 7 / 7', 'ok']],
  [['main push CI for <span class="mono">2a69a2ff</span>'], ['still running at the time of writing (Qwen Code CI, SDK Java, E2E in progress; worktree smoke and Landlock done green)', 'warn']],
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
