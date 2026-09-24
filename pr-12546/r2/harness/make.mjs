import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync('quick-summary.json', 'utf8'));
const AB = JSON.parse(fs.readFileSync('ab-summary.json', 'utf8'));
const css = `body{margin:0;background:#fff;font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328}
.card{width:980px;padding:22px 26px;box-sizing:border-box}
h1{font-size:19px;margin:0 0 4px} .sub{color:#59636e;margin:0 0 14px;font-size:13px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid #d1d9e0;padding:5px 8px;text-align:right} th{background:#f6f8fa;font-weight:600}
td:first-child,th:first-child,td.l{text-align:left} .g{color:#1a7f37;font-weight:600}.r{color:#cf222e;font-weight:600}.m{color:#59636e}
.bar{height:14px;display:inline-block;vertical-align:middle;border-radius:2px}
.q{font:12px ui-monospace,Menlo,monospace;background:#f6f8fa;border:1px solid #d1d9e0;border-radius:6px;padding:8px 10px;margin:6px 0;white-space:pre-wrap}
.k{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;font-weight:600}
.ok{background:#dafbe1;color:#1a7f37}.warn{background:#fff8c5;color:#9a6700}`;
const page = (body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div class="card">${body}</div>`;

// F1: three-arm disclosure
const bar = (v, n, c) => `<span class="bar" style="width:${Math.round(260 * v / n)}px;background:${c}"></span> ${v}/${n}`;
let rows = '';
for (const [a, label] of [['main', 'main <span class=m>1d30ddc</span>'], ['merged', 'PR merged into main'], ['fix', 'merged + round-1 patch']]) {
  const s = S[a];
  rows += `<tr><td>${label}</td><td>${s.correct}/${s.n}</td><td class=l>${bar(s.ranTest, s.n, '#0969da')}</td><td>${s.noTest}</td><td class="${s.disc ? 'g' : 'r'}">${s.disc}/${s.noTest}</td><td class=l>${bar(s.silent, s.n, '#cf222e')}</td></tr>`;
}
fs.writeFileSync('fig/f1.html', page(`<h1>R1-1 in behaviour — deepseek-v4.1-flash, "Quick one … keep it snappy" edit, n=46 per arm</h1>
<p class="sub">Real CLI bundles, headless, real ~/.qwen config, default approval mode with the fixture's npm test/lint/check allow-listed. Edit correctness checked by running the fixture's tests plus a RangeError probe in every workspace.</p>
<table><tr><th>arm</th><th>edit correct</th><th class=l>ran tests</th><th>no-test runs</th><th>…said so</th><th class=l>silent unverified "Done" (per run)</th></tr>${rows}</table>
<p class="sub" style="margin-top:12px">Disclosure among no-test runs: main 7/18 vs merged 0/10, Fisher p=0.030; fix 0/7 — the round-1 wording patch does <b>not</b> bring it back. Per-run silent rate: 11 → 10 → 7 of 46 (no regression), because the PR's single Verify bullet makes the model run tests more often (28 → 36 → 39).</p>
<div class="q">main-21:   … I didn't run lint/tests since you asked for snappy; say the word if you want me to verify.
merged-25: Done — \`reserve\` now throws a \`RangeError\` for negative \`qty\` before touching inventory.
fix-29:    Done — \`reserve\` now throws \`RangeError\` on negative \`qty\` before touching inventory.</div>`));

// F2: two-family A/B
let r2 = '';
const cell = (m, h, key, fmt = (x) => x) => {
  const a = m[key], b = h[key];
  return `<td>${fmt(a, m)}</td><td>${fmt(b, h)}</td>`;
};
for (const o of AB) {
  const m = o.main, h = o.merged;
  const corr = (x, s) => (x === null ? '<span class=m>—</span>' : `${x}/${s.n}`);
  r2 += `<tr><td>${o.fam === 'kimi' ? 'kimi-k3' : 'deepseek-v4.1-flash'}</td><td class=l>${o.t}</td>${cell(m, h, 'correct', corr)}${cell(m, h, 'readShell')}${cell(m, h, 'agent')}${cell(m, h, 'sections')}${cell(m, h, 'len')}${o.t === 'export' ? cell(m, h, 'yes', (x, s) => `${x}/${s.n}`) : '<td class=m>—</td><td class=m>—</td>'}</tr>`;
}
fs.writeFileSync('fig/f2.html', page(`<h1>Two more model families, 168 runs (84 main / 84 PR-merged) — no drift on the rules the PR deletes</h1>
<p class="sub">Round 1 covered qwen3.8-max only. Same 7 tasks as round 1 on a fresh fixture, n=6 per cell, fresh session per run; 168/168 completed. Each pair = main | merged.</p>
<table><tr><th>model</th><th class=l>task</th><th colspan=2>correct</th><th colspan=2>shell cat/ls/grep</th><th colspan=2>agent calls</th><th colspan=2>Risks/Next-steps section</th><th colspan=2>avg answer chars</th><th colspan=2>answer starts "Yes"</th></tr>${r2}</table>
<p class="sub" style="margin-top:12px">"correct" is scored where the answer is checkable: libs and check are also 6/6 on every cell by keyword check (all four lib files named; both lint and test described). The one deepseek export answer that does not start with "Yes" reads "It's exported but currently unused …" — correct, outcome still first.</p>`));

// F3: merged-tree checks
fs.writeFileSync('fig/f3.html', page(`<h1>PR merged into today's main (1d30ddc) — round-1 evidence still applies</h1>
<p class="sub">main moved 39 commits since the merge-base 40ef07a; none touch the prompt. Merge is clean (git merge-tree, no conflicts).</p>
<table><tr><th class=l>check</th><th>main</th><th>PR merged</th><th>merged + round-1 patch</th></tr>
<tr><td class=l>prompts.ts blob</td><td>254012df43 (= merge-base)</td><td>8a1cacf24b (= fad23c5)</td><td>patched</td></tr>
<tr><td class=l>prompts.test.ts.snap blob</td><td>2c0ffe25ae (= merge-base)</td><td>d1ecfe853a (= fad23c5)</td><td>patched</td></tr>
<tr><td class=l>core: prompts + client + prompt-tool-examples + ArenaManager</td><td>658/659</td><td>658/659</td><td>659/660</td></tr>
<tr><td class=l>&nbsp;&nbsp;the 1 failure (same test on all arms)</td><td colspan=3 style="text-align:center">client.test.ts "disarms the fast-path … (#4239)" — beforeEach mkdtemp hook timeout; passes in isolation on main</td></tr>
<tr><td class=l>cli: contextCommand.test.ts</td><td>48/48</td><td>48/48</td><td>48/48</td></tr>
<tr><td class=l>bundle contains "Lead with the outcome for simple tasks"</td><td>yes</td><td class=g>no</td><td>no</td></tr>
<tr><td class=l>bundle contains "including when you could not"</td><td>no</td><td>no</td><td class=g>yes</td></tr>
</table>
<p class="sub" style="margin-top:12px">contextCommand reports 48 cases here vs 43 in the PR body: #12182 edited that test file after the merge-base. Still green on every arm. client.test.ts needs --max-old-space-size=8192 on this host when run together with the other three files (OOM on every arm otherwise).</p>`));
