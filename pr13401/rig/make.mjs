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

const fig1 = `
<h1>PR #13401 @ dc8b2d7030 — mutation matrix</h1>
<p class="sub">JDK 21.0.12 (Zulu), Maven 3.9.16, macOS, 10 cores. Each row is one fresh <code>mvn clean test</code> of the module (the CI command) with one mutant applied and
<code>-Dmaven.test.failure.ignore</code>, so both surefire executions ran: <b>default-test</b> (carriers = 10) and the new <b>pinning-witnesses-pinned-scheduler</b> lane (parallelism = 4).
HCP/HAP/HGI ran targeted (<code>-Dtest=CarrierCountTest,&lt;both broker witnesses&gt;</code>).</p>
<table>
<tr><th>Mutant</th><th>What it restores / changes</th><th>default-test lane</th><th>pinned lane (p=4)</th><th>CarrierCount unit tests</th><th>Outcome</th></tr>
<tr><td class="mono">PS</td><td><code>HarnessEventStream.next()</code> → <code>synchronized</code> (pre-#13388)</td><td>stream witness ${R('RED 32.1 s')}</td><td>${R('RED 32.8 s')}</td><td>${G('green')}</td><td><span class="k kk">KILLED</span></td></tr>
<tr><td class="mono">PSC</td><td>18 <code>context.lock()</code> sites → <code>synchronized (context)</code></td><td>session witness ${R('RED 31.0 s')}<br>${Y('renewal witness')} ${G('green')}</td><td>${R('RED 31.2 s')}<br>${Y('renewal')} ${G('green')}</td><td>${G('green')}</td><td><span class="k kk">KILLED</span></td></tr>
<tr><td class="mono">PBR</td><td>5 <code>BindingRenewal</code> lock sites → <code>synchronized (this)</code></td><td>renewal witness ${R('RED 31.0 s')}<br>${Y('session witness')} ${G('green')}</td><td>${R('RED 31.4 s')}<br>${Y('session')} ${G('green')}</td><td>${G('green')}</td><td><span class="k kk">KILLED</span><br>${Y('base 43a6e1e5e4: 734 run, 0 fail')}</td></tr>
<tr><td class="mono">PDR</td><td>3 <code>DispatchRenewal</code> lock sites → <code>synchronized (this)</code></td><td>${G('green')} 738 run</td><td>${G('green')} 2 run</td><td>${G('green')}</td><td><span class="k ks">survives</span><br>${Y('not claimed by this PR')}</td></tr>
<tr><td class="mono">WCPS</td><td>stream witness sized from <code>getCommonPoolParallelism()</code></td><td>${G('green')} 178 run</td><td>${G('green')} 1 run</td><td>${G('green')}</td><td><span class="k ks">survives</span></td></tr>
<tr><td class="mono">WCPV+WCPR</td><td>both broker witnesses sized from <code>getCommonPoolParallelism()</code></td><td>${G('green')} 738 run</td><td>${G('green')} 2 run</td><td>${G('green')}</td><td><span class="k ks">survives</span></td></tr>
<tr><td class="mono">HCP</td><td><code>CarrierCount.resolve()</code> → common-pool parallelism</td><td>witnesses ${G('green')}</td><td>${Y('—')}</td><td>${R('RED (3 fail)')}</td><td><span class="k kk">KILLED</span></td></tr>
<tr><td class="mono">HAP</td><td><code>resolve()</code> ignores the scheduler property</td><td>witnesses ${G('green')}</td><td>${Y('—')}</td><td>${R('RED (2 fail)')}</td><td><span class="k kk">KILLED</span></td></tr>
<tr><td class="mono">HGI</td><td><code>resolve()</code> → <code>Integer.getInteger</code> (decode, "0100" = 64)</td><td>witnesses ${G('green')}</td><td>${Y('—')}</td><td>${R('RED (2 fail)')}</td><td><span class="k kk">KILLED</span></td></tr>
</table>
<div class="note">All three production pinning shapes are caught, each only by its own witness. The new renewal witness is what kills <b>PBR</b>: on the merge-base the full broker suite (734 tests) stays green with it.</div>
<div class="note warn">Kills the pinned lane adds: <b>0</b>. It goes red only where default-test is already red, and the witness-sizing mutants (WCP*) pass both lanes: on a correct guard the fleet size does not change the outcome.</div>
`;

const fig2 = `
<h1>Sizing A/B with the pinning bug present: RED means the witness caught it</h1>
<p class="sub">Merge-base <code>43a6e1e5e4</code> (pre-PR witnesses, sized from <code>ForkJoinPool.getCommonPoolParallelism()</code>) vs head <code>dc8b2d7030</code> (sized from <code>jdk.virtualThreadScheduler.parallelism</code>).
Same mutated production code in both arms. One fresh <code>mvn clean test -Dtest=&lt;witness&gt;</code> per cell; the JVM flag reaches the fork through <code>-DargLine</code>. Host: 10 cores.</p>
<table>
<tr><th>Witness + mutant</th><th>Arm</th><th>no flag</th><th><code>-Djava.util.concurrent.ForkJoinPool<br>.common.parallelism=1</code></th><th><code>-Djdk.virtualThreadScheduler<br>.parallelism=16</code></th></tr>
<tr><td rowspan="2">SessionContext witness<br>+ <span class="mono">PSC</span></td><td>base</td><td>${R('RED 60.10 s')}<br><span class="mono gray">IllegalStateException … (waiting=10)</span></td><td>${A('GREEN 1.09 s, vacuous')}<br><span class="gray">3 callers on 10 carriers</span></td><td>${A('GREEN 1.09 s, vacuous')}<br><span class="gray">11 callers on 16 carriers</span></td></tr>
<tr><td>head</td><td>${R('RED 31.03 s')}<br><span class="gray">12 callers / 10 carriers</span></td><td>${R('RED 31.07 s')}<br><span class="gray">12 / 10</span></td><td>${R('RED 31.08 s')}<br><span class="gray">18 / 16</span></td></tr>
<tr><td rowspan="2">Stream (SSE reader) witness<br>+ <span class="mono">PS</span></td><td>base</td><td>${R('RED 32.77 s')}<br><span class="gray">"11 readers on 9 carriers" (actual 10)</span></td><td>${A('GREEN 5.00 s, vacuous')}</td><td>${A('GREEN 5.06 s, vacuous')}</td></tr>
<tr><td>head</td><td>${R('RED 32.09 s')}<br><span class="gray">12 / 10</span></td><td>${R('RED 32.35 s')}<br><span class="gray">12 / 10</span></td><td>${R('RED 32.37 s')}<br><span class="gray">18 / 16</span></td></tr>
<tr><td>Controls, no mutant</td><td>head · base</td><td>head ${G('green')} 1.01 s · 1.00 s</td><td>head ${G('green')} 1.06 s · 1.10 s<br>base ${G('green')} 1.05 s</td><td>head ${G('green')} 1.06 s · 1.10 s</td></tr>
</table>
<div class="note">This is the PR's central claim and it holds. With the old sizing, either tuning knob leaves a carrier free, the probe runs, and a real pinning bug passes green. Head sizes from the scheduler's own property and stays red. The carrier-sized latch also makes the failure faster and better named: 60 s <code>IllegalStateException</code> becomes a 31 s probe-starvation assert.</div>
`;

const fig3 = `
<h1>Reviewer Test Plan step 2: claimed vs observed</h1>
<p class="sub">Mutation: <code>BindingRenewal</code> guard restored to <code>synchronized</code> (mutant PBR). Full <code>mvn clean test</code> in <code>packages/sdk-java/runtime-broker</code> at head <code>dc8b2d7030</code>.</p>
<div class="lbl">PR body (Expected)</div>
<div class="claim">"the renewal witness fails after <b>~60 s</b> with <code>IllegalStateException: callers never reached the latched resource-handle write (waiting=&lt;carriers&gt;)</code> … while the SessionContext witness stays green"</div>
<div class="lbl">Observed: default-test lane</div>
<pre>[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: <span class="red">31.02 s</span> &lt;&lt;&lt; FAILURE! -- in com.alibaba.qwen.code.runtimebroker.BrokerRenewalPinningTest
<span class="red">org.opentest4j.AssertionFailedError</span>: virtual-thread probe starved by 12 warm() callers parked inside BindingRenewal guards
    on 10 carriers (progress=0) — a guard pinned its carrier ==&gt; expected: &lt;true&gt; but was: &lt;false&gt;
	at com.alibaba.qwen.code.runtimebroker.BrokerRenewalPinningTest.renewalGuardMustNotPinCarriersWhileTheHandleWriteBlocks(<b>BrokerRenewalPinningTest.java:94</b>)
[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 1.009 s -- in ...BrokerVirtualThreadPinningTest   <span class="green">(stays green)</span></pre>
<div class="lbl">Observed: pinned lane (parallelism=4)</div>
<pre>[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: <span class="red">31.35 s</span> &lt;&lt;&lt; FAILURE! -- in com.alibaba.qwen.code.runtimebroker.BrokerRenewalPinningTest
<span class="red">org.opentest4j.AssertionFailedError</span>: virtual-thread probe starved by 6 warm() callers parked inside BindingRenewal guards on 4 carriers (progress=0) …</pre>
<div class="note warn">The witness is right; the body is stale. The ~60 s <code>IllegalStateException</code> is the failure shape of the earlier caller-sized latch. The pre-PR SessionContext witness still fails that way: <span class="mono">60.10 s, callers never reached the latched repository call (waiting=10)</span>. With the latch sized to carriers it opens, and the test fails at the probe assert on line 94.</div>
<div class="lbl">Carrier counts on the PR's CI run 37424827086 (PINNING-MARKER lines, stream witness)</div>
<table>
<tr><th>Runner</th><th>default-test carriers</th><th>pinned lane carriers</th><th>Lane vs default</th></tr>
<tr><td>ubuntu-latest / Java 21 (self-hosted <code>ecs-qwen-hk4-27</code>)</td><td>64</td><td>4</td><td>smaller pool</td></tr>
<tr><td>macos-latest / Java 21</td><td>3</td><td>4</td><td>larger than cores</td></tr>
<tr><td>windows-latest / Java 21</td><td>4</td><td>4</td><td>${A('identical configuration')}</td></tr>
<tr><td>ubuntu-latest / Java 11</td><td colspan="2">witness skipped in both lanes (no virtual threads); build green</td><td>extra fork, no test</td></tr>
</table>
`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
for (const [name, body] of [['01-mutation-matrix', fig1], ['02-sizing-vacuity-ab', fig2], ['03-test-plan-step2-and-ci-carriers', fig3]]) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card">${body}</div></body></html>`;
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  await page.setContent(html);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await page.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, clipped ? `WARNING ${clipped} clipped <pre>` : 'ok');
}
await browser.close();
