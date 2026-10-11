// Evidence figures for the PR 13530 report: HTML cards rendered with Playwright.
import { chromium } from '/Users/wenshao/git/pr13530-head/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';

const OUT = '/Users/wenshao/git/pr13530-rig/fig/out';
const css = `
body{margin:0;background:#fff;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2328}
.card{padding:22px 26px;width:max-content;max-width:1500px}
h1{font-size:19px;margin:0 0 4px}
.sub{color:#59636e;margin:0 0 14px;font-size:13px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #d1d9e0;padding:6px 9px;vertical-align:top;text-align:left}
th{background:#f6f8fa}
td.ok{background:#dafbe1}
td.no{background:#ffebe9}
td.note{background:#fff8c5}
td.na{color:#8c959f}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px}
.mono{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}
.legend{margin-top:10px;color:#59636e;font-size:12px}
.grid{display:flex;gap:18px}
.shot{width:700px}
.shot img{width:700px;border:1px solid #d1d9e0;border-radius:6px}
.cap{font-size:13px;margin:6px 0 0}
`;
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body><div class="card">${body}</div></body></html>`;

const matrix = page('matrix', `
<h1>PR #13530 @ <code>e2a5180a</code> — real-stack verification (MySQL 8.4.7 · Spring · Hosted Harness · Runtime Broker · worker · Vite WebShell)</h1>
<p class="sub">Control arm: main <code>9763580b</code> (the PR's merge-base plus 2 unrelated commits). Model: scripted OpenAI-compatible provider that logs model id, API key and system-message markers. 2026-10-11.</p>
<table>
<tr><th>#</th><th>Check</th><th>main 9763580b</th><th>PR head e2a5180a</th><th>Result</th></tr>
<tr><td>1</td><td>Bound Session from a stored definition</td><td class="no">409 <code>workspace_unavailable</code></td><td class="ok">202, pins <code>agent_revision=1</code> + <code>agent_digest</code></td><td>plan 1</td></tr>
<tr><td>2</td><td>Unbound Session from a definition with model-b + instructions</td><td class="no">202, but runs <code>model-default</code>, no instructions (silently dropped)</td><td class="ok">model-b / key-B, <code># Agent instructions</code> section</td><td>before/after</td></tr>
<tr><td>3</td><td>Reviewer plan 1: files/2 + default + model-a + instructions</td><td class="na">—</td><td class="ok">glob found 3 .md in the bound mount; write_file → Action; no file until Allow; Allow → file written</td><td>13/13</td></tr>
<tr><td>4</td><td>Reviewer plan 2: rev 2 (model-b, new text, yolo)</td><td class="na">—</td><td class="ok">old Session: model-a + rev-1 text, still asks · new Session: model-b/key-B, rev-2 text only, 0 Action rows, file written · explicit rev 1 still selectable</td><td>11/11</td></tr>
<tr><td>5</td><td>Reviewer plan 3: identity changed (digest, then revision)</td><td class="na">—</td><td class="ok">resident and cold loads answer 409 <code>hosted_agent_definition_conflict</code>; restored identity loads 200 and completes</td><td>6/6 steps</td></tr>
<tr><td>6</td><td>Reviewer plan 4: model not on Java allowlist</td><td class="na">—</td><td class="ok">409 <code>agent_definition_unsupported</code> field=model, no Session row</td><td>1/1</td></tr>
<tr><td>7</td><td>Plan 4: allowlisted model with unset key / configured twice / absent from Harness / unbound</td><td class="na">—</td><td class="ok">Turn FAILED <code>model_unavailable</code> (public event code too), 0 inference requests; no fallback to <code>OPENAI_API_KEY</code></td><td>4/4</td></tr>
<tr><td>8</td><td>Refusal matrix over HTTP (model, instructions, permission_policy, tools, skills, mcp_servers, environment_template_id, 404s, tenant isolation)</td><td class="na">—</td><td class="ok">every refusal names <code>error.field</code>; 0 Session rows written</td><td>23/23</td></tr>
<tr><td>9</td><td>Instructions size boundary</td><td class="na">—</td><td class="ok">65,536 B admitted and delivered (stored inline); 65,537 B → 409 instructions</td><td>2/2</td></tr>
<tr><td>10</td><td>Creation replay after rev 2 (bound + unbound)</td><td class="na">—</td><td class="ok">same Session, still rev 1; fresh key → rev 2</td><td>4/4</td></tr>
<tr><td>11</td><td>Concurrency: 40/150 unbound and 30/100 bound creates (omitted revision) racing 10–30 updates</td><td class="na">—</td><td class="ok">0 × 5xx, 0 deadlocks, every pinned digest equals its stored revision</td><td>4/4</td></tr>
<tr><td>12</td><td>Child Session under a shell/1 definition parent (doudouOUC P2)</td><td class="na">—</td><td class="ok">child row inherits revision + digest; child model call uses model-b + parent instructions; parent completes</td><td>3/3</td></tr>
<tr><td>13</td><td>Shell profile rules (allowlist opened)</td><td class="na">—</td><td class="note">shell+yolo and shell+{} (deployment yolo) → 409; shell+default 202; <b>shell+auto-edit 202</b> (design §5.3 says default only)</td><td>5/5 as coded</td></tr>
<tr><td>14</td><td>R2-2: Harness on, Session Store off</td><td class="no">Spring starts</td><td class="ok">Spring exits: "Hosted Harness requires the Managed Session Store"</td><td>fixed</td></tr>
<tr><td>15</td><td>R2-3: upgrade a DB migrated by main (V64) to the PR</td><td class="na">—</td><td class="ok">V66 applied, column nullable; old qwen-code and legacy Sessions keep running; new Sessions pin</td><td>fixed</td></tr>
<tr><td>16</td><td>Free-form <code>agent_id</code> on an unbound Session</td><td class="note">202 (any label accepted)</td><td class="note">404 <code>agent_not_found</code> (in the v1.41 changelog)</td><td>compat change</td></tr>
<tr><td>17</td><td>Real WebShell</td><td class="na">—</td><td class="ok">rev-1 Session shows the write card → Allow → file; rev-2 yolo Session: no card, file written</td><td>3/3</td></tr>
<tr><td>18</td><td>Local unit runs</td><td class="na">—</td><td class="ok">CLI vitest 4 files 123/123 · Java 6 classes 156/156</td><td>pass</td></tr>
</table>
<p class="legend">Green = matches the PR's claim · red = main's behavior · yellow = observation for maintainers. Not run here: real provider (no key in this shell), W1 capture/restore, message-stop (R2-1) path, Windows/Linux.</p>
`);

const wire = page('wire', `
<h1>What reached the model, and what the Harness answered</h1>
<p class="sub">From the scripted provider's request log and a Spring → Harness recording proxy. Same agent: rev 1 = model-a + <code>INSTR-R1…</code> + default; rev 2 = model-b + <code>INSTR-R2…</code> + yolo.</p>
<table>
<tr><th>Session</th><th>request</th><th>model / key</th><th>tools</th><th>agent section</th><th>project context</th><th>model reply</th></tr>
<tr><td rowspan="3">S1 (rev 1, created first)</td><td>1</td><td>model-a / key-A</td><td>edit, glob, read_file, write_file</td><td>INSTR-R1 @18456</td><td>— (not read yet)</td><td>glob **/*.md</td></tr>
<tr><td>2</td><td>model-a / key-A</td><td>same</td><td>INSTR-R1 @18456</td><td>QWEN.md @18555</td><td>write_file → <b>Action, waits for Allow</b></td></tr>
<tr><td>3</td><td>model-a / key-A</td><td>same</td><td>INSTR-R1 @18456</td><td>QWEN.md @18555</td><td>done</td></tr>
<tr><td>S1 after rev 2 exists</td><td>4</td><td>model-a / key-A</td><td>same</td><td>INSTR-R1 only</td><td>QWEN.md</td><td>write_file → <b>still asks</b></td></tr>
<tr><td>S2 (new, omitted revision → rev 2)</td><td>1–2</td><td>model-b / key-B</td><td>same</td><td>INSTR-R2 only</td><td>— then QWEN.md</td><td>write_file → <b>written, 0 Actions</b></td></tr>
<tr><td>S3 (explicit rev 1)</td><td>1</td><td>model-a / key-A</td><td>same</td><td>INSTR-R1</td><td>—</td><td>text</td></tr>
<tr><td>qwen-code control</td><td>1</td><td>model-default / key-default</td><td>edit, read_file, write_file</td><td>none</td><td>—</td><td>text</td></tr>
<tr><td>model-nocred / model-dup / model-ghost</td><td>0</td><td colspan="5">Turn FAILED <code>model_unavailable</code> before any request</td></tr>
</table>
<p class="cap">System message order (S1 request 2): <span class="mono">…core prompt (18,4xx chars)…\\n---\\n\\n# Agent instructions\\n\\nINSTR-R1-ALPHA…\\n\\n--- Context from: QWEN.md ---\\nPROJECT-CTX-MARKER…</span></p>
<br>
<table>
<tr><th>Load of S1 (Spring → Harness)</th><th>identity sent</th><th>Harness answer</th><th>Turn outcome</th></tr>
<tr><td>A1 resident, original</td><td>rev 1 + rev-1 digest</td><td class="ok">200</td><td>COMPLETED (model-a)</td></tr>
<tr><td>A2 resident, digest changed in DB</td><td>rev 1 + rev-2 digest</td><td class="ok">409 <code>hosted_agent_definition_conflict</code> × 6 (34 s of retries)</td><td class="note">FAILED <code>hosted_harness_unavailable</code>, 0 model requests</td></tr>
<tr><td>B1 cold (Harness restarted), digest changed</td><td>rev 1 + rev-2 digest</td><td class="ok">409 <code>hosted_agent_definition_conflict</code> × 6</td><td class="note">FAILED <code>hosted_harness_unavailable</code></td></tr>
<tr><td>B2 restored</td><td>rev 1 + rev-1 digest</td><td class="ok">200</td><td>COMPLETED</td></tr>
<tr><td>C1 cold, revision changed to 2</td><td>rev 2 + rev-1 digest</td><td class="ok">409 <code>hosted_agent_definition_conflict</code> × 6</td><td class="note">FAILED <code>hosted_harness_unavailable</code></td></tr>
<tr><td>C2 restored</td><td>rev 1 + rev-1 digest</td><td class="ok">200</td><td>COMPLETED</td></tr>
<tr><td>control: qwen-code Session, tool_profile changed</td><td>—</td><td>409 <code>hosted_tool_profile_conflict</code></td><td class="note">FAILED <code>hosted_harness_unavailable</code> (same pre-existing mapping)</td></tr>
</table>
`);

const ui = page('ui', `
<h1>Real WebShell (ManagedAgentWebShell via Vite) against the PR's Spring</h1>
<p class="sub">Same stored agent. Left: a Session pinned to revision 1 (default approval) waiting on its write. Right: a new Session pinned to revision 2 (yolo) after the same prompt shape.</p>
<div class="grid">
<div class="shot"><img src="../raw/ui-01-approval-rev1.png"><p class="cap">Rev 1 · <code>write_file</code> approval card. "Yes, allow once" resumed the Turn and the file landed in the Workspace mount.</p></div>
<div class="shot"><img src="../raw/ui-03-rev2-yolo.png"><p class="cap">Rev 2 · completed without a card; 0 Action rows for the Session; file written.</p></div>
</div>
`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
for (const [name, html] of [['01-matrix', matrix], ['02-wire-and-identity', wire], ['03-webshell', ui]]) {
  const f = `${OUT}/${name}.html`;
  writeFileSync(f, html);
  const p = await ctx.newPage();
  await p.goto(`file://${f}`);
  await p.waitForLoadState('load');
  await p.locator('.card').screenshot({ path: `${OUT}/${name}.png` });
  await p.close();
  console.log('wrote', name);
}
await browser.close();
