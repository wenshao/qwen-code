import fs from 'node:fs';
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/50c97716-7195-475a-a8de-b9dfb77ea084/scratchpad/r3';
const S = JSON.parse(fs.readFileSync(`${SP}/summary.json`, 'utf8'));
const css = `body{margin:0;background:#fff;font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328}
.card{width:1000px;padding:22px 26px;box-sizing:border-box}
h1{font-size:19px;margin:0 0 4px} .sub{color:#59636e;margin:0 0 14px;font-size:13px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;margin-bottom:6px}
th,td{border-bottom:1px solid #d1d9e0;padding:5px 8px;text-align:right;vertical-align:top} th{background:#f6f8fa;font-weight:600}
td:first-child,th:first-child,td.l,th.l{text-align:left} .g{color:#1a7f37;font-weight:600}.r{color:#cf222e;font-weight:600}.m{color:#59636e}.y{color:#9a6700;font-weight:600}
code{font:12px ui-monospace,Menlo,monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px}
.q{font:12px ui-monospace,Menlo,monospace;background:#f6f8fa;border:1px solid #d1d9e0;border-radius:6px;padding:8px 10px;margin:6px 0;white-space:pre-wrap}`;
const page = (b) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div class="card">${b}</div>`;
const ok = '<span class=g>✓</span>', bad = '<span class=r>✗</span>';

fs.writeFileSync(`${SP}/fig/f1.html`, page(`<h1>Round 3: head <code>023e703</code> (= <code>9f09b00</code> + main <code>90232f0</code>). The prompt is unchanged since round 2; one CI blocker remains.</h1>
<p class="sub">Two freshly installed and built arms: <b>main</b> = <code>90232f0</code>, <b>head</b> = tree <code>a541687</code>. That is my local <code>git merge 9f09b00</code>, and it equals <code>023e703^{tree}</code> byte for byte. Renders come from the built <code>packages/core/dist</code>, with the cwd inside a git repo.</p>
<table><tr><th class=l>check</th><th class=l>result</th><th></th></tr>
<tr><td>prompts.ts at head vs round-2 head <code>6dd7d51</code></td><td class=l>byte-identical (0 diff lines)</td><td>${ok}</td></tr>
<tr><td>192 renders (4 families × 3 modes × todo × CodeModeOnly × 4 tool surfaces)</td><td class=l>head = round-2 <code>6dd7d51</code> renders <b>192/192</b>; main <code>90232f0</code> = round-2 main <b>192/192</b>. The 40+ commits since then (incl. the advisor tool #9636) don't move the prompt</td><td>${ok}</td></tr>
<tr><td>sections changed main → head</td><td class=l>SE Tasks, Communicating, Tone, Using Your Tools, Git Repository, Git as Source of Truth: 192/192 each; everything else incl. safety sections 0/192; heading lists 192/192 equal</td><td>${ok}</td></tr>
<tr><td>o200k_base tokens (5 PR-table variants)</td><td class=l>4,052→3,772 · 4,104→3,824 · 4,355→4,075 · 4,580→4,300 · 4,573→4,302 = <b>−280 ×4, −271</b> (body still says −287/−278, the <code>fad23c5</code> figures)</td><td class=y>stale body</td></tr>
<tr><td>core: prompts / prompt-tool-examples / ArenaManager</td><td class=l>head 195 + 2 + 31 pass · main 190 + 2 + 31 pass</td><td>${ok}</td></tr>
<tr><td>core: client.test.ts (alone, coverage off)</td><td class=l>435/436 on <b>both</b> arms; the one failure is the same <code>#4239</code> 10 s hook timeout as round 2, passes in isolation</td><td class=m>pre-existing</td></tr>
<tr><td>cli: contextCommand.test.ts</td><td class=l>48/48 both arms</td><td>${ok}</td></tr>
<tr><td><code>npm run typecheck</code> · ESLint (changed .ts)</td><td class=l>exit 0 · exit 0</td><td>${ok}</td></tr>
<tr><td><b>Prettier 3.6.1</b> (CI's <code>--experimental-cli --check</code>)</td><td class=l>main: clean · head: <b>2 files fail</b>, the same two CI names at <code>023e703</code> (<code>docs/plans/…token-governance.md</code>, <code>docs/verification/resident-tool-prompt-assembly/README.md</code>)</td><td>${bad}</td></tr>
<tr><td>… after <code>prettier --write</code> on those 2 files</td><td class=l>19 lines re-padded; <code>git diff -w</code> leaves only 2 table-separator rows (dashes). <b>No text changes.</b> Full-tree <code>--check .</code> then exits 0</td><td>${ok}</td></tr>
</table>`));

const A = S.main, B = S.merged;
fs.writeFileSync(`${SP}/fig/f3.html`, page(`<h1>Real CLI, real model, on the exact head tree: 32/32 runs correct, and billed input drops by 277 tokens per request</h1>
<p class="sub"><code>node dist/cli.js -p … -o stream-json</code> from each arm's bundle, qwen3.8-max (thinking) through a logging reverse proxy, isolated QWEN_HOME, <code>--approval-mode default</code> with read-only tools, edits and the fixture's npm scripts allow-listed. Fresh session and fresh fixture copy per run, 4 tasks × 4 reps per arm.</p>
<table><tr><th class=l>measure</th><th>main <code>90232f0</code></th><th>head <code>023e703</code></th></tr>
<tr><td>runs completed / answers correct</td><td>${A.ok}/${A.runs} · ${A.correct}/${A.runs}</td><td>${B.ok}/${B.runs} · ${B.correct}/${B.runs}</td></tr>
<tr><td>system prompt on the wire has "including when you could not" (head text)</td><td>${A.sysNew}/${A.runs}</td><td>${B.sysNew}/${B.runs}</td></tr>
<tr><td>… has "Lead with the outcome for simple tasks" (main text)</td><td>${A.sysOld}/${A.runs}</td><td>${B.sysOld}/${B.runs}</td></tr>
<tr><td>provider-billed input tokens, first main-session request (export task)</td><td>${A.firstInputTokens.join(' / ')}</td><td>${B.firstInputTokens.join(' / ')} <b>(−${A.firstInputTokens[0] - B.firstInputTokens[0]})</b></td></tr>
<tr><td>"Quick one … keep it snappy" edit: correct / ran npm test / skipped a check silently</td><td>${A.quick.correct}/4 · ${A.quick.ranTest}/4 · ${A.quick.silent}</td><td>${B.quick.correct}/4 · ${B.quick.ranTest}/4 · ${B.quick.silent}</td></tr>
<tr><td>"is formatDate exported?": answer starts with yes (是)</td><td>${A.exportYes}</td><td>${B.exportYes}</td></tr>
<tr><td>read/list via shell (the dropped tie-breaker) · <code>agent</code> calls</td><td>${A.readShell} · ${A.agent}</td><td>${B.readShell} · ${B.agent}</td></tr>
</table>
<p class="sub" style="margin-top:10px">This is a small n=4 confirmation on the merged tree, not a new A/B. Rounds 1–2 (482 runs, three model families) already cover behaviour. The rendered prompt is byte-identical to round 2's, so those results carry over. The wire shows the bundle actually ships the head text, and the billed delta (−277) agrees with o200k_base (−280).</p>`));
const rows = [
  ['file-7 allowlist vs no snapshot, Todo off', '1,135 ch / 1,139 B', '1,135 / 1,139', ok],
  ['file-7 vs monitor-undeclared set, Todo off', '818 / 822', '818 / 822', ok],
  ['… Todo on (no snapshot · monitor undeclared)', '1,364/1,368 · 1,047/1,051', '1,364/1,368 · 1,047/1,051', ok],
  ['<code>keepCodingInstructions:false</code> deletes (main → head)', '2,663 → 2,077 ch', '2,663 → 2,077 ch', ok],
  ['… "≈ 525 token"', '525', '<b>401</b> o200k (525 = 2,077 ÷ 3.96, the doc\'s own heuristic ruler)', '<span class=y>nit</span>'],
  ['section slices: SE Tasks · Tone · Communicating', '3,068→2,482 · 689→658 · 662→571', '3,068→2,482 · 689→658 · 662→571', ok],
  ['section slice: Using Your Tools', '3,706 → 3,217', '<b>3,688 → 3,199</b> (Δ 489 matches; both ends 18 high)', '<span class=y>nit</span>'],
  ['unconditional text removed (non-git · git)', '1,197 · 1,422 ch', '1,197 · 1,422 ch', ok],
  ['<code>prompts.ts:402</code> / <code>:415</code> line refs', 'function / Report-outcomes', 'match at head', ok],
];
let t = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('');
fs.writeFileSync(`${SP}/fig/f2.html`, page(`<h1>What <code>9f09b00</code> added: doc corrections and the anchor-check fix, re-measured on the built head</h1>
<p class="sub">Every figure the new dated corrections state, measured on the built head with the stated convention (JS <code>string.length</code>, heading-to-next-heading slice, qwen3.8-max interactive, non-git unless noted).</p>
<table><tr><th class=l>figure</th><th>doc says</th><th>measured</th><th></th></tr>${t}</table>
<h1 style="margin-top:16px;font-size:16px">R2-1: the safety-anchor grep loop in resident-tool-prompt-assembly §4 check 3, run verbatim</h1>
<table><tr><th class=l>input</th><th class=l>old loop (main, <code>grep -qF "$k"</code>)</th><th class=l>new loop (head, <code>grep -qF -- "$k"</code>)</th></tr>
<tr><td>intact render</td><td class=l><span class=r>grep: invalid option -- ' ' + false "缺失：- Destructive operations:"</span></td><td class=l><span class=g>no output</span></td></tr>
<tr><td>render with "did not run a verification step" removed</td><td class=l>not a key on main, so the removal is missed (only the false alarm prints)</td><td class=l><span class=g>缺失：did not run a verification step</span></td></tr>
<tr><td>render with "- Destructive operations:" removed</td><td class=l>same output as the intact render: cannot tell the two apart</td><td class=l><span class=g>缺失：- Destructive operations:</span></td></tr>
<tr><td>render with "**Denied Tool Calls:**" removed</td><td class=l>reported, plus the false alarm</td><td class=l><span class=g>缺失：**Denied Tool Calls:**</span></td></tr>
</table>`));
