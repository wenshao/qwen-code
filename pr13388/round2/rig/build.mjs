// Evidence cards for PR #13388, built from the run artifacts in the
// scratchpad and screenshotted with the PR tree's Playwright. English only;
// the Chinese text lives in the PR comment's collapsed block.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fig4 } from './fig4.mjs';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad';
const OUT = `${S}/figs/out`;
fs.mkdirSync(OUT, { recursive: true });
const read = (p) => fs.readFileSync(p, 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--green:#3fb950;--red:#f85149;--amber:#d29922}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{width:1360px;padding:28px 32px 24px;background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.sub{color:var(--mut);margin:0 0 6px;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--line);padding:6px 10px;vertical-align:top;text-align:left}
th{background:var(--panel);color:var(--mut);font-weight:600}td.c,th.c{text-align:center}
code,.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
pre{background:var(--panel);border:1px solid var(--line);padding:10px 12px;margin:0;white-space:pre;overflow:hidden;line-height:1.4}
.ok{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--amber)}.mut{color:var(--mut)}.blue{color:var(--blue)}
.note{border-left:3px solid var(--amber);padding:8px 12px;margin-top:14px;background:var(--panel);font-size:14px}
.note.ok{border-color:var(--green)}.note.bad{border-color:var(--red)}
.foot{color:var(--mut);font-size:12px;margin-top:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
`;
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}${foot ? `<div class="foot">${foot}</div>` : ''}</div></body></html>`;

// ---------- witnesses ----------
function witness(name) {
  const log = read(`${S}/witness/${name}.log`);
  const secs = Number((log.match(/Time elapsed: ([0-9.]+) s/) ?? [])[1]);
  const ok = /exit=0/.test(log.trim().split('\n').pop());
  const msg = (log.match(/(virtual threads starved within 30 s of \d+ blocked stream readers on \d+ carriers \(progress=\d+\)|callers never reached the latched repository call \(waiting=\d+\))/) ?? [])[1];
  return { ok, secs, msg };
}
const wcell = (w, vacuous = false) => w.ok
  ? (vacuous ? `<td class="c warn">green — vacuous · ${w.secs.toFixed(1)} s</td>` : `<td class="c ok">green · ${w.secs.toFixed(1)} s</td>`)
  : `<td class="c bad">red · ${w.secs.toFixed(0)} s<br><span class="mono" style="font-size:11.5px">${esc(w.msg ?? '')}</span></td>`;

function mutants() {
  return read(`${S}/mutants/results.tsv`).trim().split('\n').map((l) => { const [m, v, t] = l.split('\t'); return { m, v, t }; });
}
const MUT_LABEL = {
  M1: 'HarnessEventStream.next() → synchronized (author\'s mutation 1)',
  C340: 'acquire(), cached Session (author\'s mutation 2)',
  C373: 'control()', C506: 'startExecution() (v3)', C593: 'startExecution() (reference)', C668: 'installPublisher()',
  C690: 'acknowledgeLocalExecution()', C726: 'acknowledgeExecution()', C834: 'cancelExecution()', C1058: 'reconcileInContext()',
  C1297: 'createExecution()', C1373: 'releaseSession()', C1448: 'acquireSession() (new Session)',
  BR: 'BindingRenewal → synchronized (persistResourceHandle, renew, close…)', DR: 'DispatchRenewal → synchronized',
};

function suiteLine(file) {
  const log = read(file);
  const tot = [...log.matchAll(/^\[(?:INFO|WARNING|ERROR)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)$/gm)];
  return tot.map((m) => ({ run: +m[1], f: +m[2] + +m[3], s: +m[4] }));
}

function fig1() {
  const arms = [['pr', 'PR head 07849a18f0'], ['base', 'merge-base code + the two new tests'], ['mstream', 'head, HarnessEventStream reverted'], ['mbroker', 'head, RuntimeBrokerService reverted']];
  const wrows = arms.map(([a, l]) => `<tr><td><b>${a}</b> <span class="mut">${l}</span></td>${wcell(witness(`${a}-stream-r1`))}${wcell(witness(`${a}-broker-r1`))}</tr>`).join('');
  const ms = mutants();
  const killed = ms.filter((x) => x.v === 'KILLED').length;
  const mrows = ms.map((x) => `<tr><td class="mono">${x.m}</td><td>${MUT_LABEL[x.m] ?? ''}</td><td class="c ${x.v === 'KILLED' ? 'ok' : 'warn'}">${x.v === 'KILLED' ? 'killed' : 'survived'} · ${x.t}</td></tr>`).join('');
  const q = suiteLine(`${S}/suites/pr-qwencode.log`).pop();
  const b = suiteLine(`${S}/suites/pr-runtime-broker.log`).pop();
  const bm = suiteLine(`${S}/suites/mbr-runtime-broker.log`).pop();
  const sv = suiteLine(`${S}/it/pr-r1.log`);
  const clean = (read(`${S}/it/pr-r1.log`).match(/admissionFailures=0/g) ?? []).length;
  const candHead = read(`${S}/mutants/cand-NONE.log`).match(/Time elapsed: ([0-9.]+) s/)[1];
  const candBr = read(`${S}/mutants/cand-BR.log`).match(/callers never reached the latched resource-handle write \(waiting=\d+\)/)[0];
  const html = `
<h2>1 · The two new witnesses on JDK 21 (10-core Mac) — each one is red exactly where its half of the fix is missing</h2>
<table><tr><th>arm</th><th class="c">HarnessEventStreamPinningTest</th><th class="c">BrokerVirtualThreadPinningTest</th></tr>${wrows}</table>
<h2>2 · Mutation matrix — restore one monitor at a time on top of head, run that module's witness</h2>
<div class="grid"><table><tr><th>mutant</th><th>restored as a monitor</th><th class="c">witness</th></tr>${mrows}</table>
<div>
<table>
<tr><th colspan="2">full suites on head (JDK 21, MySQL 8.4.7)</th></tr>
<tr><td>qwencode</td><td class="ok">${q.run} tests, ${q.f} failures, ${q.s} skipped · checkstyle 0</td></tr>
<tr><td>runtime-broker</td><td class="ok">${b.run} tests, ${b.f} failures, ${b.s} skipped · checkstyle 0</td></tr>
<tr><td>managed-agent-server</td><td class="ok">${sv[0].run} tests, ${sv[0].f} failures · burst IT ${clean}/6 clean rounds · checkstyle 0 · spotbugs 0</td></tr>
<tr><td>runtime-broker with mutant <b>BR</b></td><td class="warn">${bm.run} tests, ${bm.f} failures — nothing notices</td></tr>
</table>
<table style="margin-top:14px">
<tr><th colspan="2">candidate witness <code>BrokerRenewalPinningTest</code> (carriers+2 warm() calls parked in persistResourceHandle)</th></tr>
<tr><td>head</td><td class="ok">green · ${Number(candHead).toFixed(1)} s</td></tr>
<tr><td>mutant BR</td><td class="bad">red · 60 s · <span class="mono" style="font-size:11.5px">${esc(candBr)}</span></td></tr>
</table>
<table style="margin-top:14px">
<tr><th colspan="3">witness sizing: <code>getCommonPoolParallelism()</code> = cores − 1, carriers = cores</th></tr>
<tr><th>run</th><th class="c">stream</th><th class="c">broker</th></tr>
<tr><td>base code, 12 carriers, as shipped</td>${wcell(witness('base-stream-par12'), true)}${wcell(witness('base-broker-par12'), true)}</tr>
<tr><td>base code, 12 carriers, sized from <code>jdk.virtualThreadScheduler.parallelism</code></td>${wcell(witness('mut-stream-sized-base-par12'))}${wcell(witness('mut-broker-sized-base-par12'))}</tr>
<tr><td>head, 12 carriers, sized</td>${wcell(witness('mut-stream-sized-head-par12'))}${wcell(witness('mut-broker-sized-head-par12'))}</tr>
</table>
</div></div>
<div class="note">The witnesses do discriminate (both author mutations go red), but only 2 of the 15 single-site mutants are caught. In particular <b>BR</b> — the <code>BindingRenewal.persistResourceHandle</code> monitor that the #13365 rig measured pinning carriers — survives every witness and all ${bm.run} broker tests. On the packaged stack it is not harmless (next figure: 16 Turns take 57 s instead of 8 s).</div>`;
  return page('#13388 · the PR\'s test plan, reproduced and mutation-tested', `Head 07849a18f0 · merge-base 6136786c0c (= main) · Zulu JDK 21.0.12 · ${killed}/${ms.length} single-site mutants killed by the shipped witnesses`, html,
    'Mutants restore one ReentrantLock region to an intrinsic monitor (C&lt;line&gt; = the context.lock() at that head line). Witness runs time out at 30 s (stream) / 60 s (broker) when red.');
}

// ---------- packaged stack ----------
const stack = () => JSON.parse(read(`${S}/results/stack.json`));
const cellOf = (r) => {
  if (!r) return '<td class="c mut">–</td>';
  const st = r.status ?? {};
  const done = st.COMPLETED ?? 0;
  const failed = st.FAILED ?? 0;
  const s500 = Object.entries(r.submit ?? {}).filter(([k]) => k.startsWith('500')).reduce((a, [, v]) => a + v, 0);
  const extra = `${failed ? ` · ${failed} FAILED` : ''}${s500 ? ` · ${s500} submit 500` : ''}`;
  if (r.stalled) {
    const active = (st.ACCEPTED ?? 0) + (st.RUNNING ?? 0);
    if (!r.pinned) return `<td class="c warn"><b>stuck</b><br><span style="font-size:12px">${active}/${r.n} unsettled at 120 s${extra}</span></td>`;
    return `<td class="c bad"><b>wedged</b><br><span style="font-size:12px">${active}/${r.n} never settle · ${r.pinned} pinned${extra}</span></td>`;
  }
  const secs = (r.settleMs / 1000).toFixed(1);
  if (failed) return `<td class="c warn">${secs} s<br><span style="font-size:12px">${failed}/${r.n} FAILED</span></td>`;
  if (r.settleMs > 30000) return `<td class="c warn">${secs} s<br><span style="font-size:12px">${done}/${r.n} done</span></td>`;
  return `<td class="c ok">${secs} s<br><span style="font-size:12px">${done}/${r.n}</span></td>`;
};
function fig2() {
  const rows = stack();
  const pick = (run, n, rep = 0) => rows.find((r) => r.run === run && r.n === n && r.rep === rep);
  const ns = [8, 10, 16, 20, 24, 32, 48, 64];
  const line = (label, map) => `<tr><td>${label}</td>${ns.map((n) => cellOf(map[n] ? pick(map[n], n) : null)).join('')}</tr>`;
  const t1 = `<table><tr><th>arm (fresh JVM + fresh DB per cell, replies stream 5 s)</th>${ns.map((n) => `<th class="c">${n} Turns</th>`).join('')}</tr>
${line('<b>base</b> 6136786c0c, JDK 21', { 8: 'p-base-n8', 10: 'p-base-n10', 16: 'p-base-n16' })}
${line('<b>PR head</b>, JDK 21', { 10: 'p-pr-n10', 16: 'p-pr-n16', 20: 'q-pr-n20', 24: 'q-pr-n24', 32: 'p-pr-n32', 48: 'x-pr-n48', 64: 'p-pr-n64' })}
${line('<b>PR head</b>, JDK 21, repeat', { 16: 't-pr-trace-n16', 32: 'q-pr-n32-r2', 64: 'x-pr-n64-r2' })}
${line('<b>PR head</b>, JDK 21, traced repeat', { 32: 'x-pr-trace-n32' })}
${line('head with only <code>HarnessEventStream</code> reverted', { 16: 'a-mstream-n16' })}
${line('head with only <code>RuntimeBrokerService</code> reverted', { 16: 'a-mbroker-n16' })}
${line('head with only <code>BindingRenewal</code> reverted (mutant BR)', { 16: 'a-mbr-n16' })}
${line('base, <b>JDK 25</b> (JEP 491 control)', { 16: 'j-base-jdk25-n16', 20: 'q-base-jdk25-n20', 32: 'q-base-jdk25-n32' })}
${line('PR head, <b>JDK 25</b>', { 32: 'q-pr-jdk25-n32', 64: 'x-pr-jdk25-n64' })}
</table>`;
  const par4 = `<table><tr><th>4 carriers (<code>-Djdk.virtualThreadScheduler.parallelism=4</code>, CI-runner shape)</th><th class="c">6 Turns</th><th class="c">16 Turns</th></tr>
<tr><td>base</td>${cellOf(pick('c-base-par4-n6', 6))}<td class="c mut">–</td></tr>
<tr><td>PR head</td><td class="c mut">–</td>${cellOf(pick('c-pr-par4-n16', 16))}</tr></table>`;
  const warm = rows.filter((r) => r.run === 'p-pr-rep');
  const warmT = `<table><tr><th>PR head, one warm JVM, rounds back to back</th>${[10, 16, 32].map((n) => `<th class="c">${n} Turns ×3</th>`).join('')}</tr><tr><td>settle time per round</td>${[10, 16, 32].map((n) => { const rs = warm.filter((r) => r.n === n); const ok = rs.every((r) => !r.stalled && !(r.status?.FAILED)); return `<td class="c ${ok ? 'ok' : 'bad'}">${rs.map((r) => (r.settleMs / 1000).toFixed(1)).join(' / ')} s</td>`; }).join('')}</tr></table>`;
  const fr = (run) => Object.entries(rows.find((r) => r.run === run)?.pinnedMonitorFrames ?? {});
  const frameRows = (run) => fr(run).map(([k]) => esc(k.replace('com.alibaba.qwen.code.', '').replace(' <== monitors:1', ''))).join('\n') || '(none)';
  const trace = `<div class="grid"><div><h2 style="text-transform:none"><code>-Djdk.tracePinnedThreads=full</code> · base, 8 Turns — frames holding a monitor while parked</h2><pre>${frameRows('t-base-trace-n8')}</pre></div><div><h2 style="text-transform:none">same · PR head, 16 Turns</h2><pre>${frameRows('t-pr-trace-n16')}</pre></div></div>`;
  const html = `<h2>1 · Concurrent first Turns on the packaged stack (Spring jar + embedded Runtime Broker + dist/cli.js serve --profile hosted-harness + MySQL 8.4.7), 10-core Mac</h2>${t1}
<div class="grid" style="margin-top:14px"><div>${par4}</div><div>${warmT}</div></div>
${trace}
<div class="note ok">The PR does what it says: the ≥ #cores wedge is gone (base wedges at 10 Turns on 10 carriers and at 6 on 4; head settles 10/16 Turns in ~8 s and 16 on 4 carriers in 7.3 s). Both halves are load-bearing: reverting only the SDK lock wedges, reverting only the broker (or only <code>BindingRenewal</code>) turns 16 Turns into 57 s of InnoDB lock-wait timeouts.</div>
<div class="note bad">Not closed yet on JDK 21: head settles cold bursts up to 24, but at 32 it fails 4–8 Turns, at 48 Turns stay stuck and at 64 it wedges, while the same jar on JDK 25 settles 32 in 9.4 s and 64 in 11.5 s. The remaining pinned frame is <code>ConcurrentHashMap.computeIfAbsent</code> — figure 3.</div>`;
  return page('#13388 · packaged stack before / after on JDK 21', 'Every cell is one fresh Spring JVM, one fresh database and one fresh tenant; “wedged” = no Turn settles within 90–120 s, with jcmd dumps showing all carriers busy and N virtual threads parked on their carrier', html,
    'Rig: rig/burst.mjs in the evidence branch (fake OpenAI model, 20 deltas over 5 s per reply). The 16-Turn repeat and the traced 32 ran with -Djdk.tracePinnedThreads=full. “stuck” = Turns still unsettled at 120 s with no carrier pinned at that moment. tracePinnedThreads prints each distinct pinned stack once, so the frame lists are sites, not counts.');
}

function fig3() {
  const rows = stack();
  const one = (run) => rows.find((r) => r.run === run);
  const c = (run) => cellOf(one(run));
  const sub = (run) => { const r = one(run); if (!r) return '<td class="c mut">–</td>'; const served = `${r.subsOpen}/${r.subscribers} subscribers served`; return r.stalled ? `<td class="c bad"><b>Turns never start</b><br><span style="font-size:12px">${served} · ${r.carriersBusy}/${r.beforeSubmit?.carrierThreads ?? '?'} carriers busy</span></td>` : `<td class="c ${r.settleMs > 30000 ? 'warn' : 'ok'}">${(r.settleMs / 1000).toFixed(1)} s<br><span style="font-size:12px">${served} · carriers ${r.beforeSubmit?.carrierThreads ?? '?'}</span></td>`; };
  const stackTxt = esc(`#359 "" virtual      (64-Turn burst: 8 of the 10 carriers look like this, the other 2 wait in ConcurrentHashMap.transfer for those bins)
  java.lang.VirtualThread.parkOnCarrierThread
  java.util.concurrent.CompletableFuture.get
  java.net.http.HttpClientImpl.send
  daemon.HostedHarnessClient.createSession(HostedHarnessClient.java:137)
  managedagent.harness.QwenHostedHarnessConnector.create(QwenHostedHarnessConnector.java:310)
  managedagent.harness.QwenHostedHarnessConnector.lambda$createOrLoad$0(…:137)
  java.util.concurrent.ConcurrentHashMap.computeIfAbsent      <== holds the bin monitor
  managedagent.harness.QwenHostedHarnessConnector.createOrLoad(…:135)
  managedagent.service.HarnessCoordinator.runClaimed(HarnessCoordinator.java:249)`);
  const html = `
<h2 style="text-transform:none">1 · QwenHostedHarnessConnector.createOrLoad: <code>attachments.computeIfAbsent(key, k -> create(session))</code> runs the Harness HTTP call under the CHM bin monitor</h2>
<pre>${stackTxt}</pre>
<table style="margin-top:14px"><tr><th>cold burst, JDK 21</th><th class="c">32 Turns</th><th class="c">48 Turns</th><th class="c">64 Turns</th><th class="c">128 Turns</th></tr>
<tr><td>PR head</td>${c('p-pr-n32')}${c('x-pr-n48')}${c('p-pr-n64')}<td class="c mut">–</td></tr>
<tr><td>PR head, repeat</td>${c('q-pr-n32-r2')}<td class="c mut">–</td>${c('x-pr-n64-r2')}<td class="c mut">–</td></tr>
<tr><td>head + candidate single-flight (no blocking call inside computeIfAbsent)</td>${c('x-cand-n32')}<td class="c mut">–</td>${c('x-cand-n64')}${c('x-cand-n128')}</tr>
<tr><td>head + candidate, repeat (the 32 ran traced)</td>${c('x-cand-trace-n32')}<td class="c mut">–</td>${c('x-cand-n64-r2')}<td class="c mut">–</td></tr>
<tr><td>head + both candidate patches</td><td class="c mut">–</td><td class="c mut">–</td>${c('y-cand2-n64')}<td class="c mut">–</td></tr>
<tr><td>PR head on JDK 25 (control)</td>${c('q-pr-jdk25-n32')}<td class="c mut">–</td>${c('x-pr-jdk25-n64')}<td class="c mut">–</td></tr>
</table>
<div class="note">The cycle in the 20 s mid-run dump of the 32-Turn burst: 8 carriers pinned waiting for Harness <code>createSession</code> → the virtual threads that hold the tenant's <code>qwen_runtime_placement_guard</code> row lock cannot get a carrier to commit (2 RUNNING transactions idle 20 s, 13 queued INSERTs) → the 20-connection Druid pool drains (20 waiters) → the Harness's Session Store call back into Spring cannot get a connection → <code>createSession</code> never answers. Only the 30 s pool wait / 50 s InnoDB timeouts break it, hence the failed Turns.</div>
<h2 style="text-transform:none">2 · SessionEventHub.SessionBuffer.await: <code>synchronized</code> + <code>Object.wait(≤15 s)</code> on the same virtual-thread executor, one per public/Web Shell SSE subscriber</h2>
<table><tr><th>8 Turns while N SSE subscribers wait on idle Sessions</th><th class="c">32 subscribers, maxPoolSize=16</th><th class="c">300 subscribers, default maxPoolSize=256</th><th class="c">300 subscribers, repeat</th></tr>
<tr><td>PR head</td>${sub('s-pr-idle32-mp16-n8')}${sub('s-pr-idle300-n8')}${sub('y-pr-idle300-n8-r2')}</tr>
<tr><td>head + both candidate patches (Condition-based SessionBuffer)</td>${sub('y-cand2-idle32-mp16-n8')}${sub('y-cand2-idle300-n8')}<td class="c mut">–</td></tr></table>
<div class="note">JDK 21 compensates <code>Object.wait</code> by adding carriers, but only up to <code>jdk.virtualThreadScheduler.maxPoolSize</code> (256). Past that, waiting subscribers hold every carrier: new subscribers are never served and Turns are starved.</div>
<div class="note ok">Neither file is touched by this PR; both sites exist on base too (the base trace lists the same computeIfAbsent frame). Candidate patches for both pass the managed-agent-server suite (567 tests, 0 failures; burst IT 6/6; checkstyle 0; spotbugs 0).</div>`;
  return page('#13388 · two JDK 21 pinning sites left on the Turn path (outside the diff)', 'Same packaged stack and JDK 21; the PR head jar vs. the same jar plus a candidate patch; JDK 25 is the no-pinning control', html,
    'Candidate patches: createOrLoad-single-flight.patch, session-event-hub-condition.patch in the evidence branch.');
}

const require = createRequire(`${S}/wt-pr/package.json`);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const pg = await (await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1424, height: 900 } })).newPage();
const only = process.argv[2];
for (const [name, fn] of [['01-test-plan-and-mutants', fig1], ['02-packaged-stack', fig2], ['03-residual-pin-sites', fig3], ['04-round2', () => fig4({ S, read, esc, page, cellOf, witness, wcell })]]) {
  if (only && !name.startsWith(only)) continue;
  fs.writeFileSync(`${OUT}/${name}.html`, fn());
  await pg.goto(`file://${OUT}/${name}.html`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  const wide = await pg.evaluate(() => document.querySelector('#card').scrollWidth > 1360);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, 'clipped-pre:', clipped, 'overflow:', wide);
}
await browser.close();
