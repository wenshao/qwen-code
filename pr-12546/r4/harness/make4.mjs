import fs from 'node:fs';
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/50c97716-7195-475a-a8de-b9dfb77ea084/scratchpad/r4';
const S = JSON.parse(fs.readFileSync(`${SP}/summary.json`, 'utf8')); const A = S.main, B = S.merged;
const css = `body{margin:0;background:#fff;font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328}
.card{width:1000px;padding:22px 26px;box-sizing:border-box} h1{font-size:19px;margin:0 0 4px} h2{font-size:15px;margin:16px 0 4px}
.sub{color:#59636e;margin:0 0 12px;font-size:13px} table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid #d1d9e0;padding:5px 8px;text-align:left;vertical-align:top} th{background:#f6f8fa;font-weight:600}
.g{color:#1a7f37;font-weight:600}.r{color:#cf222e;font-weight:600}.m{color:#59636e}
code{font:12px ui-monospace,Menlo,monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px}`;
const page = (b) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div class="card">${b}</div>`;
const ok = '<span class=g>✓</span>';
fs.writeFileSync(`${SP}/fig/f1.html`, page(`<h1>Round 4: head <code>89f602b</code>. The Prettier fix landed; the prompt still matches round 2 byte for byte</h1>
<p class="sub">Arms rebuilt from scratch: <b>main</b> = <code>0c80184</code> (the main parent the author merged), <b>head</b> = <code>89f602b</code> itself.</p>
<table><tr><th>check</th><th>result</th><th></th></tr>
<tr><td><code>89f602b</code> vs its merge parent <code>fadc80f</code></td><td>only the two docs files; the changed lines are <b>identical to the round-3 <code>prettier-fix.patch</code></b>; after normalising table padding both files equal <code>023e703</code> (no cell text changed)</td><td>${ok}</td></tr>
<tr><td>Prettier 3.6.1, full tree <code>--experimental-cli --check .</code></td><td>exit 0 locally; CI's <code>Run Prettier</code> step also passes at <code>89f602b</code></td><td>${ok}</td></tr>
<tr><td>prompts.ts / prompts.test.ts / snapshot vs round-2 <code>6dd7d51</code></td><td>no diff</td><td>${ok}</td></tr>
<tr><td>192 renders</td><td>head = round-3 head <b>192/192</b>, main <code>0c80184</code> = round-3 main <b>192/192</b>; tokens −280 ×4 / −271, unchanged</td><td>${ok}</td></tr>
<tr><td>anchor loop (§4 check 3)</td><td>byte-identical to round 3; intact render → no output; "did not → could not" regression → <code>缺失：did not run a verification step</code> (so the author's reply on R4-2 holds)</td><td>${ok}</td></tr>
<tr><td>core prompts / tool-examples / ArenaManager · cli contextCommand</td><td>head 195+2+31 = 228 · 48/48 &nbsp;|&nbsp; main 223 · 48/48</td><td>${ok}</td></tr>
<tr><td>client.test.ts (alone)</td><td>435/436 on both arms, the same <code>#4239</code> hook timeout, which passes alone</td><td class=m>pre-existing</td></tr>
<tr><td>typecheck · ESLint (changed .ts)</td><td>exit 0 · exit 0</td><td>${ok}</td></tr>
</table>
<h2>Real CLI + qwen3.8-max on the rebuilt bundles (main's dashscope provider changed since round 3, so rerun)</h2>
<table><tr><th>measure</th><th>main <code>0c80184</code></th><th>head <code>89f602b</code></th></tr>
<tr><td>runs completed · correct</td><td>${A.ok}/${A.runs} · ${A.correct}/${A.runs}</td><td>${B.ok}/${B.runs} · ${B.correct}/${B.runs}</td></tr>
<tr><td>wire system prompt carries head text · main text</td><td>${A.sysNew}/16 · ${A.sysOld}/16</td><td>${B.sysNew}/16 · ${B.sysOld}/16</td></tr>
<tr><td>provider-billed input tokens, first main-session request</td><td>${[...new Set(A.firstInputTokens)].join('/')}</td><td>${[...new Set(B.firstInputTokens)].join('/')} <b>(−${A.firstInputTokens[0] - B.firstInputTokens[0]})</b></td></tr>
<tr><td>"keep it snappy" edit: correct · ran npm test · silent skip</td><td>${A.quick.correct}/4 · ${A.quick.ranTest}/4 · ${A.quick.silent}</td><td>${B.quick.correct}/4 · ${B.quick.ranTest}/4 · ${B.quick.silent}</td></tr>
<tr><td>shell read/list · agent calls · "exported?" starts with yes</td><td>${A.readShell} · ${A.agent} · ${A.exportYes}</td><td>${B.readShell} · ${B.agent} · ${B.exportYes}</td></tr></table>`));
const runs = [['36155092392', '<b>this PR 89f602b</b>', 'ecs-qwen-hk4-19', '<span class=r>failure: 36 fail, all in qwen-triage flakiness-gate "production wrapper" suites</span>'],
 ['36157036154', 'cursor/managed-agent-spring-webshell', 'ecs-qwen-hk4-26', '<span class=g>success</span>'],
 ['36154864729', 'fix/12424-skill-denied-subagent-inline', 'ecs-qwen-hk4-28', '<span class=g>success</span>'],
 ['36154649082', 'fix/issue-12699-webfetch-ehostunreach', 'ecs-qwen-hk4-8', '<span class=g>success</span>'],
 ['36153898608', 'feature/managed-agents-p0-p8', 'ecs-qwen-hk3-13', '<span class=g>success</span>'],
 ['36154701050', 'bg/fix/empty-mcp-subtitle', 'GitHub-hosted', '<span class=g>success</span>'],
 ['36154177844', 'bg/fix/compression-announcements', 'GitHub-hosted', '<span class=g>success</span>']];
fs.writeFileSync(`${SP}/fig/f2.html`, page(`<h1>Lint &amp; Static is still red, but not because of this PR: the failure only happens on runner hk4-19</h1>
<p class="sub">Prettier now passes. The job fails later, at the <code>.github/scripts</code> node-test step: 36 of 588 fail, all inside <code>qwen-triage-workflow.test.mjs</code>'s two "behavioral, under the production wrapper" suites. Each of the 33 verdict assertions gets <code>'error'</code>, whether it expected pass, flaky or timeout, so the gate script can't run on that host at all. The PR's <code>.github/</code> tree is identical to main <code>0c80184</code>.</p>
<table><tr><th>run</th><th>branch</th><th>runner</th><th>Lint &amp; Static</th></tr>
${runs.map((r) => `<tr><td><code>${r[0]}</code></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</table>
<p class="sub" style="margin-top:10px">Every row carries the same <code>qwen-triage-workflow.test.mjs</code> blob (<code>3945a9d</code>) and <code>qwen-triage.yml</code> blob (<code>df73c32</code>), and all runs are from the same 90-minute window. Six other runners pass these suites, and only hk4-19 fails them. The harness itself documents this symptom: an ambient git wrapper on the host "breaks every git-backed scenario with misleading <code>error</code> verdicts". Re-running the job should clear it.</p>`));
