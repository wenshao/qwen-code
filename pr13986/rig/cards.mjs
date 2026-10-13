// Card content, transcribed from results/out/*/observations.log [RESULT] lines.
import fs from 'node:fs';

const STACK = 'Real stack on Debian 13 arm64: managed-agent-server (Spring + embedded Runtime Broker, durable local-process workers in cgroup v2) · MariaDB 11.8.6 · packaged Harness daemon (dist/cli.js) · OSS-compatible TLS shim · scripted model. All closes are the direct Harness <span class="mono">DELETE /session/:id</span> after <span class="mono">POST /session/:id/load</span> on a new Harness process.';
const ARMS = '<b>base</b> = main <span class="mono">58c59136ca</span> · <b>pr</b> = main <span class="mono">58c59136ca</span> + head <span class="mono">f3eeac2865</span>. Rows marked † ran in round 1 on main <span class="mono">d28bc60d73</span> (+ <span class="mono">950d757813</span> for pr); the overlapping rows matched on both heads.';

const ok = (s) => `<span class="ok">${s}</span>`;
const bad = (s) => `<span class="bad">${s}</span>`;
const warn = (s) => `<span class="warn">${s}</span>`;
const mono = (s) => `<span class="mono">${s}</span>`;

const card1 = `
<h1>PR #13986 — restart → load → DELETE with a held background run</h1>
<div class="sub">${STACK}<br>${ARMS}</div>
<table>
<tr><th style="width:30%">Scenario</th><th style="width:35%">base (main)</th><th style="width:35%">pr</th></tr>
<tr><td>Background Shell still running · Harness <b>SIGTERM</b> → load → DELETE</td>
<td>${mono('204')} in 82 ms · Runtime Session ${bad('READY')} · ${bad('3 processes alive')} · hold row PREPARED</td>
<td>${mono('204')} in 5.1 s · Runtime Session ${ok('RELEASED')} · ${ok('0 processes')} · hold row SETTLED</td></tr>
<tr><td>Same with Harness <b>SIGKILL</b></td>
<td>${mono('204')} in 83 ms · ${bad('READY')} · ${bad('3 alive')} †</td>
<td>${mono('204')} in 5.2 s · ${ok('RELEASED')} · ${ok('0')}</td></tr>
<tr><td>Monitor watch still running · SIGTERM → load → DELETE</td>
<td>${mono('204')} in 78 ms · ${bad('READY')} · ${bad('2 alive')} · monitor hold PREPARED</td>
<td>${mono('204')} in 5.2 s · ${ok('RELEASED')} · ${ok('0')} · monitor hold SETTLED</td></tr>
<tr><td>Run already exited on its own before the restart</td>
<td>${mono('204')} in 79 ms · ${bad('READY')} (binding stays pinned) · 0 †</td>
<td>${mono('204')} in 112 ms · ${ok('RELEASED')} · 0</td></tr>
<tr><td>Then: a <b>new Session in the same Workspace</b> runs a foreground ${mono('echo')}</td>
<td>${bad('stuck')}: its Runtime Session stays ${mono('ACQUIRING')}, prompt still active after 120 s, no tool result</td>
<td>${ok('runs')}: ${mono('NEXT-SESSION-…')} exit 0, turn ${mono('completed')}</td></tr>
<tr><td class="mut">Control: no restart, DELETE on the original process</td>
<td class="mut">drains (record ${mono('cancelled / stop_requested')}) †</td>
<td class="mut">drains (same)</td></tr>
<tr><td class="mut">Control: detach → load → DELETE (same process)</td>
<td class="mut">the detach itself drains (detach shares close())</td>
<td class="mut">same — detach is not a gap</td></tr>
</table>
<div class="note">The strand on base is what #13930 R1-2 describes: the reloaded Session's held set is empty, its close answers 204 in ~80 ms and the run keeps its Runtime and the Workspace. On pr the close restores the obligation from the Broker and drains it (the ~5 s is the stop's grace), and the Workspace is usable again.</div>
`;

const card2 = `
<h1>Restore-only, isolation, and every way the new read can fail</h1>
<div class="sub">${STACK}</div>
<div class="grid">
<div>
<h2>Restore, never discharge (pr)</h2>
<pre>run: for i in $(seq 1 30); do echo tick; sleep 1; done
after SIGTERM + load   processes 2, Session READY: load stopped nothing
later                  run exited on its own: processes 0, still READY
DELETE                 204 in 116 ms → RELEASED</pre>
<h2>Isolation across Harness Sessions (pr)</h2>
<pre>A and B (different Workspaces) each hold a live run
restart, load A only, DELETE A → A RELEASED, 0 processes
B untouched              → READY, 3 processes
load B, DELETE B         → B RELEASED, 0 processes
active-holds(A) / (B) each list only their own id</pre>
</div>
<div>
<h2>Load cost</h2>
<pre>main Harness (no query)  load 406–600 ms, mean 441 (11)
PR Harness (queries)     load 317–602 ms, mean 439 (24)
direct active-holds  median 41 ms (39 calls, max 181)
normal loads on pr   no stderr line</pre>
<h2>Mixed versions</h2>
<pre>new Harness + main Broker  load 200, 1 stderr line (404),
                           close = pre-change strand
main Harness + new Broker  load 200, no query, unchanged</pre>
</div>
</div>
<h2>Fault on the new route only (Harness → fault proxy → Broker)</h2>
<table>
<tr><th style="width:22%">Broker answer</th><th style="width:16%">load</th><th style="width:38%">Harness stderr (one line)</th><th>DELETE</th></tr>
<tr><td>HTTP 500</td><td>200 in 419 ms</td><td class="mono">… could not restore its held Runtimes: Error: Runtime Broker returned HTTP 500 (rig_injected_500).</td><td>${warn('204, strand (pre-change)')}</td></tr>
<tr><td>id ${mono('../escape')}</td><td>200 in 421 ms</td><td class="mono">… Error: Runtime Broker active-holds answer is invalid.</td><td>${warn('204, strand')}</td></tr>
<tr><td>never answers</td><td>${warn('200 after 30.4 s')}</td><td class="mono">… TimeoutError: The operation was aborted due to timeout</td><td>${warn('204, strand')}</td></tr>
<tr><td>transparent</td><td>200 in 420 ms</td><td class="mut">none</td><td>${ok('204 in 5.2 s, RELEASED')}</td></tr>
</table>
<div class="note">The hang is the author's stated tradeoff: one load waits for the client's 30 s timeout. Spring's Harness ${mono('loadTimeout')} defaults to 120 s, so a Spring-driven load is delayed, not failed.</div>
`;

const card3 = `
<h1>V69 index and the Java repository on real engines</h1>
<div class="sub">Debian 13 arm64 · MariaDB 11.8.6 (rig instance) · MySQL 8.4.11 (container) · server jars built from the trial merges · 200,000 synthetic ledger rows over 4,000 Harness Sessions</div>
<h2>Flyway V68 → V69 (main jar migrates, then the pr jar boots on the same DB)</h2>
<table>
<tr><th>Engine</th><th>V69 apply</th><th>EXPLAIN before V69</th><th>EXPLAIN after V69</th></tr>
<tr><td>MariaDB 11.8.6</td><td>${ok('success')}, 3,777 ms</td><td class="mono">range · key PRIMARY · rows 202,763 · Using where</td><td class="mono">${ok('range · key idx_tool_execution_harness · rows 50')} · Using index condition</td></tr>
<tr><td>MySQL 8.4.11</td><td>${ok('success')}, 2,259 ms</td><td class="mono">range · key PRIMARY · rows 104,766 · filtered 10%</td><td class="mono">${ok('range · key idx_tool_execution_harness · rows 50')} · filtered 100%</td></tr>
</table>
<div class="sub" style="margin-top:6px">Query: the repository's exact SELECT … WHERE harness_session_id = ? AND execution_call_id_hash &gt; ? ORDER BY execution_call_id_hash LIMIT 100 (50 matching rows).</div>
<h2>Standalone initializer (schema.sql + JdbcRuntimeBrokerSchema.initialize), default collation</h2>
<pre>                     MariaDB (utf8mb4_uca1400_ai_ci)        MySQL 8.4 (utf8mb4_0900_ai_ci)
main classes init    no idx_tool_execution_harness          no idx_tool_execution_harness
pr classes init      + idx_tool_execution_harness(harness_session_id, execution_call_id_hash)   (both)
pr init again        unchanged (idempotent)                  unchanged (idempotent)</pre>
<h2>f3eeac2865: exact Harness identity under a case-insensitive collation</h2>
<pre>rows: hs-alias-abc/rs-lower and HS-ALIAS-ABC/rs-upper (both hold rows)
findHoldRowsByHarnessSession("hs-alias-abc")
  950d757813   2 rows: hs-alias-abc/rs-lower  HS-ALIAS-ABC/rs-upper    (both engines)
  f3eeac2865   1 row:  hs-alias-abc/rs-lower                          (both engines)</pre>
<div class="note">The Spring/Flyway path creates qwen_tool_execution with COLLATE utf8mb4_bin, so the alias only exists for standalone Broker deployments; the new commit closes it there.</div>
`;

const card4 = `
<h1>Follow-ups seen on the real stack, and one behavior change to know about</h1>
<div class="sub">${STACK}</div>
<h2>F1 · After a Broker (Spring) restart the drain cannot re-adopt the Runtime Session</h2>
<table>
<tr><th style="width:44%">Scenario</th><th style="width:28%">base (main)</th><th>pr</th></tr>
<tr><td>Live run → Broker restart → DELETE on the <b>same</b> Harness</td><td>${bad('503 ×5 over 2 min')}, 3 processes alive †</td><td class="mut">same code path (not changed by the PR)</td></tr>
<tr><td>Exited run → Broker restart → DELETE on the same Harness</td><td>${bad('503 ×5')} †</td><td>${bad('503 ×5')} †</td></tr>
<tr><td>Live run → Broker restart → Harness restart → load → DELETE</td><td>${warn('204')}, strand: READY, 3 alive †</td><td>${bad('503 ×5')}, READY, 3 alive, Session stays attached †</td></tr>
<tr><td>Exited run → Broker restart → Harness restart → load → DELETE</td><td>${warn('204')}, strand: READY †</td><td>${bad('503 ×5')} †</td></tr>
</table>
<pre>Harness: qwen serve: Hosted Session … close failed: Error: Runtime Broker returned HTTP 503 (runtime_reconciliation_required).
DELETE → 503 managed_session_close_failed</pre>
<div class="note warn">Pre-existing in the #13856 drain arm: after a Broker restart the Session is not in the Broker's in-memory map, and releasedSession() has no adopt branch for a READY Session on a live, non-draining binding. The PR makes a restarted Harness behave like a live one: the close parks honestly (503, retryable) instead of answering 204 over a strand. On the restart path that is a visible change: 204 + silent strand becomes a 503 that did not clear within 2 min. Either way the run keeps running; only the control-plane / Workspace-level drain (not exercised here) is left to stop it.</div>
<h2>F2 · After a reload, a background run's record never settles</h2>
<pre>natural exit after reload (base and pr)   child_run stays "running" (processes 0)
pr: drained close after reload            process stopped, Runtime Session RELEASED, child_run / monitor_run still "running"
no-restart close (both)                   child_run "cancelled", stopReason "stop_requested"</pre>
<div class="note warn">The load path does not reattach a publisher to restored runs, so neither an exit nor the drain's stop reaches the record. Before this PR the stale "running" was at least true; now the process is stopped while the record says running.</div>
<h2>F3 · The review's shape (terminal hold row + READY Session) was not reachable here</h2>
<div class="note">After a natural exit the hold row stays PREPARED (only the drain settles it), also across a Broker restart, so the pre-950d757813 logic (prefix jar) and pr behaved identically on every path I drove. That fix stands on the PR's service-level regression test.</div>
`;

const cards = [
  { file: '01-restart-close-matrix.png', html: card1 },
  { file: '02-restore-isolation-degrade.png', html: card2 },
  { file: '03-v69-index-and-jdbc.png', html: card3 },
  { file: '04-follow-ups.png', html: card4 },
];
fs.writeFileSync('/Users/wenshao/pr13986-rig/fig/cards.json', JSON.stringify(cards));
console.log('cards', cards.length);
