// Round-2 card for PR #13388 (head ebcee311b4 = 07849a18f0 + merge of main 5022712321).
export function fig4({ S, read, esc, page, cellOf, witness, wcell }) {
  const rows = JSON.parse(read(`${S}/results/stack.json`));
  const pick = (run, n, rep = 0) => rows.find((r) => r.run === run && r.n === n && r.rep === rep);
  const c = (run, n, rep) => cellOf(pick(run, n, rep));
  const muts = read(`${S}/mutants2/results.tsv`).trim().split('\n').map((l) => l.split('\t'));
  const mcell = (m) => { const r = muts.find((x) => x[0] === m); return `<td class="c ${r[1] === 'KILLED' ? 'ok' : 'warn'}">${r[1] === 'KILLED' ? 'killed' : 'survived'} · ${r[2]}</td>`; };
  const sub = (run) => { const r = rows.find((x) => x.run === run); return `<td class="c ${r.settleMs > 30000 ? 'warn' : 'ok'}">${(r.settleMs / 1000).toFixed(1)} s<br><span style="font-size:12px">${r.subsOpen}/${r.subscribers} served · ${r.beforeSubmit.carrierThreads} carriers</span></td>`; };
  const html = `
<h2>1 · What the update changed</h2>
<table>
<tr><td style="width:300px">merge of main <code>5022712321</code> (5 commits)</td><td>#13214 rewrote ~350 lines of <code>RuntimeBrokerService</code>; it conflicted only in <code>BindingRenewal.start()</code> / <code>DispatchRenewal.start()</code></td></tr>
<tr><td>hand-resolved part (<code>git show --remerge-diff</code>)</td><td class="ok">keeps the ReentrantLock regions and takes main's <code>scheduler → renewalScheduler</code> in both <code>start()</code>s — the only two lines main changed inside those classes; nothing dropped</td></tr>
<tr><td>merged broker file</td><td class="ok">0 <code>synchronized</code> · <code>context.lock/unlock</code> 12/12 · renewal <code>monitor.lock/unlock</code> 8/8 · PR diff vs new merge-base = the same 4 files (+795 −133)</td></tr>
<tr><td>test-merge with newest main <code>98b0255f9d</code> (#13217)</td><td class="ok">clean; built and run as arm <b>tm2</b></td></tr>
</table>
<div class="grid">
<div><h2 style="text-transform:none">2 · PR TEST PLAN ON ebcee311b4</h2>
<table><tr><th>check</th><th class="c">result</th></tr>
<tr><td>stream witness · head</td>${wcell(witness('pr2-stream-r2'))}</tr>
<tr><td>stream witness · base</td>${wcell(witness('base2-stream-r2'))}</tr>
<tr><td>broker witness · head</td>${wcell(witness('pr2-broker-r2'))}</tr>
<tr><td>broker witness · base</td>${wcell(witness('base2-broker-r2'))}</tr>
<tr><td>mutation 1 (<code>next()</code> synchronized)</td>${mcell('M1')}</tr>
<tr><td>mutation 2 (<code>acquire()</code> guard, now line 391)</td>${mcell('C391')}</tr>
<tr><td><code>BindingRenewal</code> reverted</td>${mcell('BR')}</tr>
<tr><td><code>DispatchRenewal</code> reverted</td>${mcell('DR')}</tr>
<tr><td>candidate BrokerRenewalPinningTest: head / BR</td><td class="c ok">green 1.3 s / <span class="bad">red 60 s</span></td></tr>
</table></div>
<div><h2>3 · Full suites (JDK 21, MySQL 8.4.7)</h2>
<table>
<tr><td>qwencode</td><td class="ok">173 tests, 0 failures (9 skipped) · checkstyle 0</td></tr>
<tr><td>runtime-broker</td><td class="ok">636 tests (601 + #13214's 35), 0 failures (2 env skips) · checkstyle 0</td></tr>
<tr><td>managed-agent-server</td><td class="ok">570 tests, 0 failures · burst IT 6/6 · checkstyle 0 · spotbugs 0</td></tr>
<tr><td>same, test-merged with 98b0255f9d</td><td class="ok">636 tests, 0 failures · burst IT 6/6 · checkstyle 0 · spotbugs 0</td></tr>
</table>
<h2 style="text-transform:none">CI ON ebcee31 — THE ONE RED CHECK</h2>
<table>
<tr><td style="width:270px">Hosted process fault gates, step 1: <code>Hosted*IT</code></td><td class="ok">19 tests, 0 failures</td></tr>
<tr><td>step 2: broker <code>-Pfault-gates</code></td><td class="ok">44 tests, 0 failures</td></tr>
<tr><td>step 3: o4-mysql <code>clean verify</code></td><td class="warn"><code>HarnessCoordinatorTest.runningOwnerObservesCancellationAfterStreamingStarts[accepted]</code>: <code>cancel</code> called 2× (wants 1). Local: 0/20 runs fail on head and 0/20 on base</td></tr>
</table></div></div>
<h2>4 · Packaged stack, cold bursts of first Turns (fresh JVM + DB per cell; 10 carriers unless noted)</h2>
<table><tr><th>arm</th><th class="c">6 @ 4 carriers</th><th class="c">16 @ 4 carriers</th><th class="c">10</th><th class="c">16</th><th class="c">24</th><th class="c">32</th><th class="c">64</th></tr>
<tr><td><b>base</b> 5022712321 + PR tests</td>${c('r2-base2-par4-n6', 6)}<td class="c mut">–</td>${c('r2-base2-n10', 10)}<td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td></tr>
<tr><td><b>head</b> ebcee311b4</td><td class="c mut">–</td>${c('r2-pr2-par4-n16', 16)}${c('r2-pr2-n10', 10)}${c('r2-pr2-n16', 16)}${c('r2-pr2-n24', 24)}${c('r2-pr2-n32', 32)}${c('r2-pr2-n64', 64)}</tr>
<tr><td>head, only <code>BindingRenewal</code> reverted</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td>${c('r2-mbr2-n16', 16)}<td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td></tr>
<tr><td>head + main 98b0255f9d (<b>tm2</b>)</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td>${c('r2-tm2-n16', 16)}<td class="c mut">–</td>${c('r2-tm2-n32', 32)}${c('r2-tm2-n64', 64)}</tr>
<tr><td>tm2 + both candidate patches</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td>${c('r2-cand3-n32', 32)}${c('r2-cand3-n64', 64)}</tr>
<tr><td>tm2 on JDK 25 (control)</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td><td class="c mut">–</td>${c('r2-tm2-jdk25-n64', 64)}</tr>
</table>
<div class="grid" style="margin-top:14px">
<table><tr><th>head, one warm JVM, back to back</th><th class="c">10</th><th class="c">16</th><th class="c">32</th></tr>
<tr><td>round 1</td>${c('r2-pr2-rep', 10, 0)}${c('r2-pr2-rep', 16, 0)}${c('r2-pr2-rep', 32, 0)}</tr>
<tr><td>round 2</td>${c('r2-pr2-rep', 10, 1)}${c('r2-pr2-rep', 16, 1)}${c('r2-pr2-rep', 32, 1)}</tr></table>
<table><tr><th>8 Turns, 300 idle SSE subscribers</th><th class="c">result</th></tr>
<tr><td>tm2</td>${sub('r2-tm2-idle300-n8')}</tr><tr><td>tm2 + both candidate patches</td>${sub('r2-cand3-idle300-n8')}</tr></table>
</div>
<div class="note ok">The merge is resolved correctly and the PR behaves exactly as in round 1: base still wedges at 10 Turns (6 on 4 carriers), head settles 10/16/24 cold Turns in 6.7–8.3 s and 16 on 4 carriers in 7.6 s; the BindingRenewal half still costs 57 s when reverted and is still unwitnessed. Pinned frames on head: only <code>ConcurrentHashMap.computeIfAbsent</code> and <code>client()</code>.</div>
<div class="note">Findings 3 and 4 are unchanged on this head and on newest main: cold 32 leaves failed/stuck Turns, 64 wedges (9 and 5 carriers pinned in <code>createOrLoad</code>), 300 subscribers leave 44 unserved; both candidate patches still fix them on top of 98b0255f9d. A warm JVM does not reliably hide it: the first 32-Turn round in the warm run failed 2 and left 3 unsettled.</div>`;
  return page('#13388 round 2 · merge of main re-verified (head ebcee311b4)', 'Same rig and host as round 1 · Zulu JDK 21.0.12 (JDK 25.0.4 control) · native MySQL 8.4.7 · arms: pr2 = head, base2 = new merge-base code + PR tests, mbr2 = head with BindingRenewal reverted, tm2 = head test-merged with 98b0255f9d, cand3 = tm2 + createOrLoad single-flight + Condition SessionEventHub', html,
    'Every arm has its own Maven repository and every fat jar was checked with javap (renewalScheduler present in all; ACC_SYNCHRONIZED / monitorenter only where the arm reverts them). The HarnessCoordinatorTest race: the 20 ms renewal tick hands cancelAdmittedTurn to the executor on every tick, so two tasks can both read CANCELLING before the first cancel lands; neither class is touched by this PR.');
}
