// Renders the round-3 evidence cards for PR #13401 with Playwright (element screenshots, 2x).
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

const fig6 = `
<h1>PR #13401 round 3 @ 75b98bcb28, merged as fcc366427d: suites and mutation matrix</h1>
<p class="sub">Since round 2 (<code>4426df95ee</code>) the PR dropped the pinned-scheduler lane, so both poms and <code>hosted-process-ci.test.js</code> are back to main. It applied the R1-1 candidate to both broker witnesses and changed <code>SessionEventHubPinningTest:62</code>. Net diff: 7 files, all under <code>src/test/java</code>.
The 7 files on <code>fcc366427d</code> are byte-identical to the tested head. JDK 21.0.12, macOS, 10 cores. Each mutant row is one fresh <code>mvn clean test</code>.</p>
<table>
<tr><th>Tree</th><th>qwencode</th><th>runtime-broker</th><th>managed-agent-server</th><th>checkstyle (3 modules)</th></tr>
<tr><td>head <code>75b98bcb28</code></td><td>${G('185 run, 0 fail')} ${Y('(9 skipped)')}</td><td>${G('740 run, 0 fail')} ${Y('(3 skipped)')}</td><td>${G('1262 run, 0 fail')} ${Y('(1 skipped)')}</td><td>${G('0 violations')}</td></tr>
<tr><td>test merge <code>35acbcb6e7</code> = head + main <code>57e347fae4</code></td><td>${G('185 run, 0 fail')}</td><td>${G('744 run, 0 fail')}</td><td>${G('1287 run, 0 fail')}</td><td>${G('0 violations')}</td></tr>
<tr><td>landed main <code>fcc366427d</code></td><td colspan="4">stream witness ${G('5.43 s')}, session ${G('1.05 s')}, renewal ${G('1.28 s')}, SessionEventHub ${G('4.83 s')}, createOrLoad ${G('1.75 s')}: all green</td></tr>
<tr><td>CI on head (SDK Java run 37629131865)</td><td colspan="4">${G('24 pass')}, 27 skipped, ${G('0 fail')}. All 8 Java legs are green, including fault gates (34 min) and MariaDB (11 min).</td></tr>
</table>
<div class="lbl">Production mutants on head</div>
<table>
<tr><th>Mutant</th><th>Run</th><th>Result</th></tr>
<tr><td>PS: <code>HarnessEventStream.next()</code> synchronized</td><td>qwencode full (185)</td><td>only the stream witness is ${R('RED 32.06 s')}</td></tr>
<tr><td>PSC: 18 SessionContext sites synchronized</td><td>broker full (740)</td><td>only the session witness is ${R('RED 31.03 s')}; renewal ${G('green 1.01 s')}</td></tr>
<tr><td>PBR: 5 BindingRenewal sites synchronized</td><td>broker full (740)</td><td>only the renewal witness is ${R('RED 31.05 s')}; session ${G('green 1.01 s')}</td></tr>
<tr><td>PDR: DispatchRenewal synchronized</td><td>broker full (740)</td><td>${G('all green')}: it runs on platform threads, outside every witness (same as round 1)</td></tr>
<tr><td>PS / PSC / PBR + <code>common.parallelism=1</code></td><td>own witness</td><td>${R('RED 32.41 / 31.09 / 31.28 s')}: sizing does not depend on the common pool</td></tr>
<tr><td>SEH: <code>SessionEventHub</code> back to the pre-#13402 <code>Object.wait</code> shape</td><td><code>SessionEventHubPinningTest</code></td><td>${R('RED 62.11 s')}</td></tr>
</table>
<div class="lbl">R1-1 as landed: the primary failure survives wedged callers in both witnesses</div>
<pre>renewal, 3 callers wedge in findOrCreate (fixed code)   <span class="red">RED 90.34 s</span>  IllegalStateException … (waiting=9)  +  Suppressed: 3 caller(s) never finished after the latch opened
session, 3 callers wedge at findById (ported copy)      <span class="red">RED 90.19 s</span>  IllegalStateException … (waiting=9)  +  Suppressed: 3 caller(s) never finished after the latch opened
renewal, same wedges + PBR mutant                       <span class="red">RED 90.75 s</span>  IllegalStateException … (waiting=9)  +  Suppressed: 3 caller(s) …   <span class="gray">(primary is the ISE, not the probe message)</span></pre>
`;

const fig7 = `
<h1>Open /review Suggestions at merge time, measured</h1>
<p class="sub">All three reproduce. None changes a verdict on fixed code, and every production mutant above is still caught. Impact is my assessment.</p>
<table>
<tr><th>Finding</th><th>Probe</th><th>Observed</th><th>Impact</th></tr>
<tr><td><b>R2-2</b> renewal witness's <code>NoopTransport</code> has no <code>attest</code></td><td>Observer counting <code>warm()</code> outcomes</td><td><code>callerSuccesses=0 callerFailures=12</code>; <code>firstFailure</code> = <code>Runtime transport does not support attestation</code>. Witness ${A('GREEN 1.35 s')}</td><td>${A('confirmed')}, coverage only: no <code>warm()</code> completes past the guarded write. Detection is intact.</td></tr>
<tr><td>R2-2 candidate (+13 lines)</td><td>Assert <code>firstFailure == null</code> after the try/finally, then override <code>attest</code></td><td>Assert alone: ${R('RED 1.37 s')} (it fails first, as it should).<br>+ attest: ${G('GREEN 1.27 s')}, 12/12 succeed.<br>+ PBR mutant: ${R('RED 31.31 s')} with the starvation message.<br>On landed main <code>fcc366427d</code>: ${G('1.28 s')} / ${R('31.29 s')}</td><td>Applies cleanly to main.</td></tr>
<tr><td><b>R2-1</b> line 62 reads via <code>Integer.getInteger</code></td><td>SEH mutant + <code>-Djdk.virtualThreadScheduler.parallelism=0100</code></td><td>${R('RED 62.09 s')}, but the message says <code>on 64 carriers</code> while the JDK builds 100</td><td>${A('confirmed')}, message only. The dead <code>ForkJoinPool</code> import is one of 18 unused imports in the module's test tree; checkstyle does not scan tests.</td></tr>
<tr><td><b>R1-2</b> "every pinning witness must size its fleet from this one read"</td><td><code>createOrLoad</code> back to <code>computeIfAbsent</code> (pre-#13403), witness <code>HostedHarnessCreateOrLoadPinningTest</code> (untouched by this PR)</td><td>Default: <code>coldClientInit</code> ${R('RED 51.10 s')}, <code>coldBurst</code> ${R('RED 60.12 s')} (ISE).<br><code>0100</code> + <code>getInteger</code> read (as on main): <code>coldClientInit</code> ${A('GREEN 1.47 s')} ← false green; <code>coldBurst</code> still ${R('RED')} (ISE).<br><code>0100</code> + base-10 read: <code>coldClientInit</code> ${R('RED 51.61 s')}, "probe starved by 102 callers"</td><td>${A('confirmed')}, narrow: it needs a leading-zero property value. One-line fix in that test's <code>carrierCount()</code>.</td></tr>
</table>
<div class="note warn"><b>Correction to my round 2.</b> I wrote that <code>SessionEventHubPinningTest:62</code> "sizes from <code>getCommonPoolParallelism()</code>, which is exactly the vacuous sizing this PR fixes". That was wrong. The fleet is the constant <code>SUBSCRIBERS = 300</code>, and <code>carriers</code> only feeds the failure message. With the SEH mutant and the old read under <code>common.parallelism=1</code>, the witness is still ${R('RED 62.15 s')}; it just says "on 1 carriers" on a 10-carrier JVM. So the line-62 change is message-only. The "under-sized the fleet" rationale in <code>796a9dc487</code>, now part of the squash message, came from my wording.</div>
`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
for (const [name, body] of [['r3-01-suites-and-mutants', fig6], ['r3-02-open-findings-measured', fig7]]) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card">${body}</div></body></html>`;
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  await page.setContent(html);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await page.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, clipped ? `WARNING ${clipped} clipped <pre>` : 'ok');
}
await browser.close();
