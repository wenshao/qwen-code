// Renders the evidence cards for PR #13401 with Playwright (element screenshots, 2x).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/Users/wenshao/git/qwen-code/package.json');
const { chromium } = require('playwright');
const OUT = path.dirname(new URL(import.meta.url).pathname);

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px 26px;background:#0d1117;min-width:1200px;max-width:1500px}
h1{font-size:23px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:14.5px;margin:0 0 18px;line-height:1.45}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th{background:#161b22;color:#8b949e;text-align:left;font-weight:600;padding:9px 11px;border:1px solid #30363d;vertical-align:bottom}
td{padding:8px 11px;border:1px solid #30363d;vertical-align:top;line-height:1.4}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.red{color:#ff7b72;font-weight:650}.green{color:#3fb950;font-weight:650}.amber{color:#d29922;font-weight:650}.gray{color:#8b949e}
.k{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12.5px;font-weight:700}
.kk{background:#3fb95026;color:#3fb950}.ks{background:#d2992226;color:#d29922}.kv{background:#ff7b7226;color:#ff7b72}
.note{margin-top:16px;border-left:4px solid #388bfd;padding:8px 14px;color:#c9d1d9;font-size:14.5px;line-height:1.5;background:#161b22}
.note.warn{border-color:#d29922}
pre{margin:0;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px;overflow:hidden}
.lbl{font-size:13px;color:#8b949e;margin:14px 0 6px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.claim{border-left:4px solid #d29922;background:#161b22;padding:10px 14px;font-size:14.5px;line-height:1.5}
td.c{white-space:nowrap}
`;

const R = (s) => `<span class="red">${s}</span>`;
const G = (s) => `<span class="green">${s}</span>`;
const A = (s) => `<span class="amber">${s}</span>`;
const Y = (s) => `<span class="gray">${s}</span>`;

const fig4 = `
<h1>PR #13401 round 2 @ 4426df95ee: re-run on the new head</h1>
<p class="sub">Since <code>dc8b2d7030</code> the PR changed one word in its own files (<code>BrokerRenewalPinningTest.java:20</code>, "Candidate witness" → "Witness"). The rest is main (<code>ac497aeed9</code>) merged in. <code>qwencode/</code> and <code>runtime-broker/</code> production code is unchanged.
JDK 21.0.12, Maven 3.9.16, macOS 10 cores. Each mutant row is one fresh <code>mvn clean test</code> with both surefire executions.</p>
<table>
<tr><th>Check</th><th>default-test</th><th>pinned lane (p=4)</th><th>Same as round 1?</th></tr>
<tr><td><code>qwencode</code> <code>mvn clean test</code></td><td>${G('178 run, 0 fail')} (9 skipped)</td><td>${G('1/1')}</td><td>${G('yes')}</td></tr>
<tr><td><code>runtime-broker</code> <code>mvn clean test</code></td><td>${G('738 run, 0 fail')} (3 skipped)</td><td>${G('2/2')}</td><td>${G('yes')}</td></tr>
<tr><td>checkstyle (both) · <code>hosted-process-ci</code> + <code>sdk-java-workflow</code> tests</td><td colspan="2">${G('0 violations')} · ${G('8/8 + 18/18')}</td><td>${G('yes')}</td></tr>
<tr><td>PS: <code>HarnessEventStream.next()</code> synchronized</td><td>stream witness ${R('RED 32.05 s')}</td><td>${R('RED 32.65 s')}</td><td>${G('yes')}</td></tr>
<tr><td>PSC: 18 SessionContext sites synchronized</td><td>session witness ${R('RED 31.03 s')}, renewal ${G('green')}</td><td>${R('RED 31.13 s')}, renewal ${G('green')}</td><td>${G('yes')}</td></tr>
<tr><td>PBR: 5 BindingRenewal sites synchronized</td><td>renewal witness ${R('RED 31.02 s')}, session ${G('green')}</td><td>${R('RED 31.28 s')}, session ${G('green')}</td><td>${G('yes')}</td></tr>
<tr><td>WCPV+WCPR: broker witnesses sized from common pool</td><td>${G('green')} (738 run)</td><td>${G('green')} (2 run)</td><td>${G('yes')}: survives both lanes</td></tr>
</table>
<div class="lbl">The two red CI legs on 4426df95ee (run 37533749667) come from main</div>
<table>
<tr><th>Leg</th><th>Where it failed</th><th>Same job on main</th><th>Local two-arm repro: <code>ManagedSessionStoreIntegrationTest</code></th></tr>
<tr><td>Hosted process fault gates / MySQL 8.4</td><td><code>holdsRestorePagesInsideThePerPageByteBudget</code> → 409 <code>managed_session_extension_record_rejected</code>; step timed out at 25 min, job at 65 min</td><td rowspan="2">${R('cancelled')} on <code>ac81c07dc8</code> and <code>b585508733</code> (20 min / ~65 min)<br>${G('success')} on <code>a764fb9698</code> (#13551 fixes this test)</td><td rowspan="2">PR head: ${R('1 error')}, same 409<br>head + main <code>a764fb9698</code>: ${G('5/5 pass')}</td></tr>
<tr><td>Runtime Broker and Managed Agent MariaDB</td><td>cancelled at 20 min inside the managed-agent-server step</td></tr>
</table>
<div class="note warn">Neither leg touches a file in this PR. Re-running will not help, because a re-run uses the same merged commit. Merging current main clears both.</div>
`;

const fig5 = `
<h1>/review R1 on 4426df95ee: the four Suggestions, measured</h1>
<p class="sub">Each probe ran on a copy of the head. Verdicts: <b>confirmed</b> means the behaviour reproduces; impact is my assessment.</p>
<table>
<tr><th>Finding</th><th>Probe</th><th>Observed</th><th>Impact</th></tr>
<tr><td><b>R1-1</b> liveness assert in <code>finally</code> masks the primary failure</td><td>Test-side probe: 3 callers wedge in <code>findOrCreate</code>, before the guarded write</td><td>head: ${R('RED 90.36 s')}, only <code>a caller never finished after the latch opened</code>. The <code>IllegalStateException … (waiting=9)</code> is ${A('absent')}.<br>candidate: ${R('RED 90.42 s')}, <code>IllegalStateException (waiting=9)</code> + <code>Suppressed: 3 caller(s) never finished</code></td><td>${A('confirmed')}, diagnostics only: the test is red either way. The same shape is in <code>BrokerVirtualThreadPinningTest</code>.</td></tr>
<tr><td><b>R1-2</b> "every pinning witness must size from this read" overclaims</td><td>grep <code>managed-agent-server</code> witnesses</td><td><code>HostedHarnessCreateOrLoadPinningTest:308</code> uses <code>Integer.getInteger</code>; <code>SessionEventHubPinningTest:62</code> uses <code>getCommonPoolParallelism()</code></td><td>${A('confirmed')}, comment only. The <code>SessionEventHub</code> witness has exactly the vacuity this PR fixes (follow-up).</td></tr>
<tr><td><b>R1-3</b> CI pin test does not pin the lane's payload</td><td>4 pom mutants vs <code>hosted-process-ci.test.js</code>, then real Maven</td><td>drop <code>combine.self</code> / drop <code>parallelism=4</code> / drop renewal include / include → missing class: ${A('all 8/8 green')}.<br>Real Maven: no <code>combine.self</code> + <code>-Pfault-gates</code> → ${R('BUILD FAILURE')} "No tests were executed!"; missing class → <code>failIfNoTests</code> red</td><td>${A('confirmed')}. Two of the four are caught by CI anyway. The other two change nothing detectable, consistent with the lane's 0 unique kills.</td></tr>
<tr><td><b>R1-4</b> override drops <code>forkedProcessTimeoutInSeconds</code> under fault-gates</td><td><code>mvn -X -Pfault-gates</code> mojo dump; PBR mutant under <code>-Pfault-gates</code></td><td>default-test: <code>forkedProcessTimeoutInSeconds = 600</code>, <code>groups = fault-gate</code>. Pinned execution: ${A('neither')}.<br>PBR under fault-gates: renewal witness ${R('RED 31.31 s')}, build done in 39 s</td><td>${A('confirmed')}, defense-in-depth: the witnesses bound themselves (<code>@Timeout(120)</code>, 30 s joins), so the real regression does not hang.</td></tr>
</table>
<div class="lbl">R1-1 candidate (BrokerRenewalPinningTest, +24/−6) on fixed code and with mutants</div>
<pre>no mutant                    BrokerRenewalPinningTest   <span class="green">GREEN 1.28 s</span>     checkstyle 0 violations
PBR (BindingRenewal sync)    BrokerRenewalPinningTest   <span class="red">RED 31.32 s</span>      probe starved by 12 warm() callers … on 10 carriers (line 95)
3 callers wedged             BrokerRenewalPinningTest   <span class="red">RED 90.42 s</span>      IllegalStateException … (waiting=9)  +  Suppressed: 3 caller(s) never finished
2 callers wedged, probe OK   BrokerRenewalPinningTest   <span class="red">RED 31.38 s</span>      AssertionError: 2 caller(s) never finished   (the 61 s false-green stays red)</pre>
`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
for (const [name, body] of [['r2-01-rerun-and-red-legs', fig4], ['r2-02-review-r1-measured', fig5]]) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card">${body}</div></body></html>`;
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  await page.setContent(html);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await page.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, clipped ? `WARNING ${clipped} clipped <pre>` : 'ok');
}
await browser.close();
