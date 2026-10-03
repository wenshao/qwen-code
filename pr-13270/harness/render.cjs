// Render the PR #13270 verification figures (HTML cards -> PNG, 2x DPR).
const { chromium } = require('/root/git/qwen-code-pr13270/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #0d1117; font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif; }
.card { display: inline-block; padding: 22px 26px 20px; background: #0d1117; color: #d0d7de; width: 1180px; }
h1 { font-size: 20px; margin: 0 0 4px; color: #f0f6fc; font-weight: 700; }
.sub { font-size: 13px; color: #8b949e; margin-bottom: 14px; }
h2 { font-size: 14px; margin: 16px 0 8px; color: #79c0ff; font-weight: 700; letter-spacing: .2px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #30363d; padding: 6px 9px; text-align: left; vertical-align: top; }
th { background: #161b22; color: #f0f6fc; font-weight: 600; }
td.mono, .mono { font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace; font-size: 12.2px; }
.pass { color: #3fb950; font-weight: 700; }
.fail { color: #f85149; font-weight: 700; }
.warn { color: #d29922; font-weight: 700; }
.dim { color: #8b949e; }
pre { margin: 0; padding: 10px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace; font-size: 12px; line-height: 1.45;
      white-space: pre-wrap; word-break: break-word; color: #d0d7de; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.tag { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11.5px; font-weight: 700; margin-left: 6px; }
.tag.g { background: #12361f; color: #3fb950; border: 1px solid #238636; }
.tag.r { background: #3c1618; color: #f85149; border: 1px solid #da3633; }
.tag.b { background: #0c2d6b; color: #79c0ff; border: 1px solid #1f6feb; }
.foot { margin-top: 12px; font-size: 11.5px; color: #8b949e; }
.r { color: #f85149; } .g { color: #3fb950; } .y { color: #d29922; } .b { color: #79c0ff; }
`;

const figs = [];

// ---------- Fig 1: serve-ab handshake budget against the real daemon ----------
{
  const arms = [
    ['merge-base driver (no flag)', '0 s', 'pass', '12/12 scenarios + .drive-complete', '7.3 s'],
    ['merge-base driver (no flag)', '8 s', 'pass', '12/12 scenarios + .drive-complete', '15.3 s'],
    ['merge-base driver (no flag)', '15 s', 'fail', 'SIGKILL child, 504 init_timeout after 9989 ms, drive aborts', '11.4 s'],
    ['PR driver (--initialize-timeout-ms 60000)', '0 s', 'pass', '12/12 scenarios + .drive-complete', '7.3 s'],
    ['PR driver (--initialize-timeout-ms 60000)', '15 s', 'pass', '12/12 scenarios + .drive-complete', '22.3 s'],
    ['PR driver (--initialize-timeout-ms 60000)', '55 s', 'pass', '12/12 scenarios + .drive-complete', '62.4 s'],
    ['PR driver (--initialize-timeout-ms 60000)', '65 s', 'fail', 'SIGKILL child, 504 init_timeout after 59989 ms (budget honoured, still finite)', '61.3 s'],
  ];
  const rows = arms.map(([d, h, v, e, w]) =>
    `<tr><td>${esc(d)}</td><td class="mono">${h}</td><td class="${v}">${v.toUpperCase()}</td><td>${esc(e)}</td><td class="mono">${w}</td></tr>`).join('');
  const ci = `[CI #13266] job 111144786934 on ecs-qwen-hk4-9 (2026-10-03T06:25Z)
qwen serve: channel exited (code=none, signal=SIGKILL, transport=ndjson_unexpected_eof, 0 session(s) torn down)
[WARN] [DAEMON] route=POST /session errorType=BridgeTimeoutError AcpSessionBridge initialize timed out after 9988ms
Error: setup POST /session failed (HTTP 504) for "health-deep-with-session": {..."code":"init_timeout",...,"phase":"channel.initialize"`;
  const local = `[local] merge-base serve-ab-drive.mjs, initialize response held 15 s
qwen serve: channel exited (code=none, signal=SIGKILL, transport=ndjson_unexpected_eof, 0 session(s) torn down)
[WARN] [DAEMON] route=POST /session errorType=BridgeTimeoutError AcpSessionBridge initialize timed out after 9989ms
Error: setup POST /session failed (HTTP 504) for "health-deep-with-session": {..."code":"init_timeout",...,"phase":"channel.initialize"`;
  figs.push(['fig1-serve-ab-handshake', `
  <h1>#13266 — Serve A/B handshake budget, real <span class="mono">qwen serve</span> daemon</h1>
  <div class="sub">Same built CLI for every arm (product code is identical between merge-base and head). A QWEN_CLI_ENTRY shim runs the REAL ACP child and delays only the <span class="mono">initialize</span> response; every other frame is proxied untouched.</div>
  <table><tr><th>serve-ab-drive.mjs</th><th>initialize delay</th><th>result</th><th>evidence</th><th>wall</th></tr>${rows}</table>
  <h2>The local 15 s arm reproduces the CI failure signature line for line</h2>
  <div class="grid2"><pre><span class="dim">${esc(ci.split('\n')[0])}</span>\n<span class="r">${esc(ci.split('\n').slice(1).join('\n'))}</span></pre><pre><span class="dim">${esc(local.split('\n')[0])}</span>\n<span class="r">${esc(local.split('\n').slice(1).join('\n'))}</span></pre></div>
  <h2>The flag changes no capture</h2>
  <pre>serve-ab-diff  merge-base driver (0 s)  vs  PR driver (0 s)   → 1 field: activeWorkStaleMs 3 → 4
serve-ab-diff  merge-base driver run 1  vs  merge-base run 2 → 1 field: activeWorkStaleMs 3 → 4   <span class="y">(same driver: timing noise)</span>
serve-ab-diff  PR driver (0 s)          vs  PR driver (15 s)   → <span class="g">0 changed fields across 12 scenarios</span></pre>
  <div class="foot">Drivers: merge-base 1a5aae80d9 vs PR head (serve-ab-drive.mjs is byte-identical at e0cc5b6 and 9d0ff23). CLI built with pnpm install + npm run build (exit 0). Shim + runner: harness/serveab/.</div>`]);
}

// ---------- Fig 2: CodeQL notifier on real GitHub Actions ----------
{
  figs.push(['fig2-codeql-fork-probe', `
  <h1>#13249 — <span class="mono">report_failure</span> on real GitHub Actions (wenshao fork, orphan probe branch)</h1>
  <div class="sub">The probe keeps the PR's job-name template, <span class="mono">fail-fast: false</span> and per-leg <span class="mono">timeout-minutes: '\${{ matrix.timeout }}'</span>; the analysis is replaced by a sleep that overruns the javascript cap (1 min). <span class="mono">report_failure</span> is the PR's job byte-for-byte except two declared substitutions in <span class="mono">if:</span> (repo → fork, <span class="mono">schedule</span> → <span class="mono">push</span>), plus marked probe steps that intercept only <span class="mono">gh issue create/comment</span>.</div>
  <div class="grid2">
  <div><h2>Run 37122566627 — one leg overruns <span class="tag r">cancelled</span></h2>
  <table><tr><th>job</th><th>conclusion</th></tr>
  <tr><td class="mono">CodeQL (java)</td><td class="pass">success</td></tr>
  <tr><td class="mono">CodeQL (javascript)</td><td class="fail">cancelled</td></tr>
  <tr><td class="mono">Report a CodeQL scan that did not finish</td><td class="pass">success (ran)</td></tr>
  <tr><td class="mono">PR gate verbatim (QwenLM + schedule)</td><td class="dim">skipped</td></tr></table></div>
  <div><h2>Run 37122566603 — both legs green <span class="tag g">success</span></h2>
  <table><tr><th>job</th><th>conclusion</th></tr>
  <tr><td class="mono">CodeQL (java)</td><td class="pass">success</td></tr>
  <tr><td class="mono">CodeQL (javascript)</td><td class="pass">success</td></tr>
  <tr><td class="mono">Report a CodeQL scan that did not finish</td><td class="dim">skipped</td></tr>
  <tr><td class="mono">PR gate verbatim (QwenLM + schedule)</td><td class="dim">skipped</td></tr></table></div>
  </div>
  <h2>What the reporter saw and did inside the runner (real gh, real GITHUB_TOKEN with actions: read)</h2>
  <pre><span class="dim">timed-out leg log:</span> <span class="r">##[error]The operation was canceled.</span>
<span class="dim">PROBE step:</span> needs.codeql.result=<span class="y">cancelled</span>      <span class="dim">gh version 2.101.0 (2026-09-15)</span>
<span class="dim">reporter (verbatim script) →</span> <span class="b">gh issue create --repo wenshao/qwen-code --title Nightly CodeQL scan did not finish --body-file …/codeql-failure.md --label type/bug --label scope/ci-cd</span>  <span class="dim">(intercepted)</span>
<span class="dim">body:</span>
&lt;!-- codeql-nightly-failure --&gt;
The nightly [\`CodeQL\`](https://github.com/wenshao/qwen-code/actions/runs/37122566627) scan did not finish, so the Security tab is not being updated.
- Legs: <span class="y">CodeQL (javascript): cancelled</span>
- Run: https://github.com/wenshao/qwen-code/actions/runs/37122566627</pre>
  <h2>Gate expression, GitHub's own evaluator (@actions/expressions 0.3.61) — runs only on a non-success scheduled upstream run</h2>
  <table><tr><th>event \\ needs.codeql.result</th><th>success</th><th>failure</th><th>cancelled</th><th>skipped</th></tr>
  <tr><td class="mono">schedule</td><td class="dim">skip</td><td class="pass">RUN</td><td class="pass">RUN</td><td class="pass">RUN</td></tr>
  <tr><td class="mono">workflow_dispatch</td><td class="dim">skip</td><td class="dim">skip</td><td class="dim">skip</td><td class="dim">skip</td></tr>
  <tr><td class="mono">push</td><td class="dim">skip</td><td class="dim">skip</td><td class="dim">skip</td><td class="dim">skip</td></tr></table>
  <div class="foot">Write path is production-proven by the sibling ECS-fleet reporter (same find-marked-issue.sh + gh issue create --label type/bug --label scope/ci-cd + gh issue comment, workflow token): github-actions[bot] filed #11633 and then commented on it instead of duplicating.</div>`]);
}

// ---------- Fig 3: tests, negative control, mutants, evaluator ----------
{
  const mut = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mutants-r2.json'), 'utf8'));
  const rows = mut.filter((m) => m.id !== 'M00').map((m) =>
    `<tr><td class="mono">${m.id}</td><td>${esc(m.desc)}</td><td class="mono">${esc(m.file)}</td><td class="${m.killed ? 'pass' : 'fail'}">${m.killed ? 'KILLED' : 'SURVIVED'}</td></tr>`).join('');
  const ctl = mut.find((m) => m.id === 'M00');
  figs.push(['fig3-tests-mutants', `
  <h1>Do the new tests pin the change? Negative control + 20 targeted mutants (head 9d0ff23)</h1>
  <div class="sub">Each mutant edits one production line in an isolated copy of .github/ + scripts/ and runs the PR's five touched test files (node --test ×3, vitest ×2).</div>
  <table><tr><th>arm</th><th>node --test (3 files)</th><th>vitest</th></tr>
  <tr><td>PR head 9d0ff23</td><td class="pass">99 / 99 pass</td><td class="pass">234 / 234 pass (codeql + sdk-java + workflow-size)</td></tr>
  <tr><td>PR tests on merge-base 1a5aae80d9</td><td class="fail">19 fail (incl. the serve-ab suite failing at import: no INITIALIZE_TIMEOUT_MS export)</td><td class="fail">6 / 14 fail (codeql + sdk-java)</td></tr>
  <tr><td>PR merged into current main 576689d073</td><td class="pass">99 / 99 pass</td><td class="pass">234 / 234 pass, size ratchet ok</td></tr></table>
  <h2>Mutation matrix — ${mut.filter((m) => m.id !== 'M00' && m.killed).length} / ${mut.length - 1} killed; unmutated control ${ctl.killed ? '<span class="fail">FAILED</span>' : '<span class="pass">passes</span>'}</h2>
  <table><tr><th>id</th><th>mutation</th><th>file</th><th>verdict</th></tr>${rows}</table>
  <h2>Routing expressions, GitHub's own evaluator — 1440 contexts, 0 mismatches</h2>
  <pre>4 lanes × {QwenLM, fork repo} × kill-switch {unset,'true','TRUE','false',''} × {pull_request, pull_request_target × same-repo/fork × 8 author associations, push, workflow_dispatch, schedule, merge_group}
policy: ECS iff upstream repo ∧ kill-switch off (case-insensitive) ∧ (not the lane's PR trigger ∨ in-repo head ∨ OWNER/MEMBER/COLLABORATOR)
<span class="g">tui-parity:parity 93 ECS / 267 hosted · tui-parity:noflicker 93 / 267 · sdk-java:flyway 93 / 267 · assign-pr-owner:assign 93 / 267 — 0 mismatches</span></pre>
  <div class="foot">Also: repo-pinned actionlint 1.7.12 (scripts/lint.js --actionlint) exit 0 · shellcheck exit 0 · prettier --experimental-cli clean · check-workflow-size.sh ok · full HELPER_TESTS and test:scripts: only the local-root failures that fail identically on the merge-base.</div>`]);
}

// ---------- Fig 4: moved lanes on the pool ----------
{
  figs.push(['fig4-ecs-lanes', `
  <h1>#13245 — the moved lanes on the ECS pool</h1>
  <div class="sub">Runner labels from the jobs API; queue wait = job created_at → started_at.</div>
  <table><tr><th>lane</th><th>evidence at head 9d0ff23</th><th>runner</th><th>result</th></tr>
  <tr><td>Serve A/B</td><td>this PR's own run 37121890752</td><td class="mono">ecs-qwen-hk5-12 · self-hosted,linux,x64,ecs-qwen</td><td class="pass">success</td></tr>
  <tr><td>Flyway migration version uniqueness</td><td>this PR's own run 37121890697</td><td class="mono">ecs-qwen-hk4-14 · self-hosted,linux,x64,ecs-qwen</td><td class="pass">success</td></tr>
  <tr><td>TUI parity snapshots</td><td>author dispatch 37121890941</td><td class="mono">ecs-qwen-hk5-20</td><td class="pass">success</td></tr>
  <tr><td>OpenTUI no-flicker gate</td><td>author dispatch 37121890941 · OUT=…/actions-runner-16/_work/_temp/…</td><td class="mono">ecs-qwen-hk5-16</td><td class="pass">success</td></tr>
  <tr><td>assign (pull_request_target)</td><td>reads main's workflow until merge</td><td class="mono">GitHub Actions 1000558281 · ubuntu-latest</td><td class="warn">post-merge only</td></tr></table>
  <h2>Queue wait, last 40 tui-parity runs (2026-10-03 03:31–12:23Z)</h2>
  <table><tr><th>pool</th><th>jobs</th><th>median</th><th>p90</th><th>max</th></tr>
  <tr><td>hosted ubuntu-latest (today's routing)</td><td>74</td><td class="fail">8.1 min</td><td class="fail">20.7 min</td><td class="fail">38.6 min</td></tr>
  <tr><td>ecs-qwen (both dispatches on this branch)</td><td>4</td><td class="pass">3 s</td><td class="pass">4 s</td><td class="pass">4 s</td></tr></table>
  <div class="sub" style="margin-top:6px">Fleet at 2026-10-03T12:28Z: 93 ecs-qwen registrations, 93 online, 24 busy.</div>
  <h2>Shared-host check: two real offline no-flicker gates at once on one machine, runner.temp-style OUT (the 9d0ff23 shape)</h2>
  <pre>runner-A: opentui-noflicker-offline: outcome=base-fails-fixed-passes base=fail fixed=pass   <span class="g">PASS</span>   Report: …/runner-A/_temp/opentui-noflicker-out
runner-B: opentui-noflicker-offline: outcome=base-fails-fixed-passes base=fail fixed=pass   <span class="g">PASS</span>   Report: …/runner-B/_temp/opentui-noflicker-out
11 report files in each runner's own dir · nothing written to the old shared /tmp/opentui-noflicker-out</pre>
  <div class="foot">setup-bun v2.2.0 on a shared HOME (/home/github-runner/.bun): it reuses a version-matched binary and installs a new one by atomic rename, so concurrent jobs on one host do not tear each other's bun. The second dispatch hit the actions cache ("Using a cached version of Bun: 1.3.14").</div>`]);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1208/chrome-linux/headless_shell',
  }).catch(async () => chromium.launch());
  for (const [name, body] of figs) {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1240, height: 800 } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="card">${body}</div></body></html>`);
    let box = await page.locator('.card').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
    box = await page.locator('.card').boundingBox();
    await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: box });
    await page.close();
    console.log('wrote', name, Math.round(box.width), 'x', Math.round(box.height));
  }
  await browser.close();
})();
