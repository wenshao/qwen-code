// Round-3 cards, transcribed from results-r3/out/*/observations.log [RESULT] lines
// and out/schema-*/steps.log, out/precedent/steps.log.
import fs from 'node:fs';

const STACK = 'Real stack on Debian 13 arm64: managed-agent-server (Spring + embedded Runtime Broker, durable local-process workers in cgroup v2, natively registered LOCAL storage) · MariaDB 11.8.6 on the 32-table <span class="mono">ma_*</span> schema · packaged Harness daemon (dist/cli.js) · OSS-compatible TLS shim · scripted model. Every close is the direct Harness <span class="mono">DELETE /session/:id</span> after <span class="mono">POST /session/:id/load</span> on a new Harness process.';
const ARMS = '<b>base</b> = main <span class="mono">462cae3dd8</span> · <b>pr</b> = main <span class="mono">462cae3dd8</span> + head <span class="mono">82e83f0d2c</span> (trial merge <span class="mono">6c55f20bf2</span>). † = base arm from rounds 1–2 (same result there).';

const ok = (s) => `<span class="ok">${s}</span>`;
const bad = (s) => `<span class="bad">${s}</span>`;
const warn = (s) => `<span class="warn">${s}</span>`;
const mono = (s) => `<span class="mono">${s}</span>`;

const card1 = `
<h1>PR #13986 @ 82e83f0d2c — restart → load → DELETE with a held background run (schema-32 port)</h1>
<div class="sub">${STACK}<br>${ARMS}</div>
<table>
<tr><th style="width:30%">Scenario</th><th style="width:35%">base (main)</th><th style="width:35%">pr</th></tr>
<tr><td>Background Shell still running · Harness <b>SIGTERM</b> → load → DELETE</td>
<td>${mono('204')} in 90 ms · Runtime Session ${bad('READY')} · ${bad('3 processes alive')} · hold row PREPARED</td>
<td>${mono('204')} in 5.2 s · Runtime Session ${ok('RELEASED')} · ${ok('0 processes')} · hold row SETTLED</td></tr>
<tr><td>Same with Harness <b>SIGKILL</b></td>
<td>${mono('204')} in 87 ms · ${bad('READY')} · ${bad('3 alive')}</td>
<td>${mono('204')} in 5.2 s · ${ok('RELEASED')} · ${ok('0')}</td></tr>
<tr><td>Monitor watch still running · SIGTERM → load → DELETE</td>
<td>${mono('204')} in 89 ms · ${bad('READY')} · ${bad('2 alive')} · monitor hold PREPARED</td>
<td>${mono('204')} in 5.2 s · ${ok('RELEASED')} · ${ok('0')} · monitor hold SETTLED</td></tr>
<tr><td>Run already exited on its own before the restart</td>
<td>${mono('204')} in 84 ms · ${bad('READY')} (binding stays pinned) · 0</td>
<td>${mono('204')} in 125 ms · ${ok('RELEASED')} · 0</td></tr>
<tr><td>Then: a <b>new Session in the same Workspace</b> runs a foreground ${mono('echo')}</td>
<td>${bad('stuck')}: its Runtime Session stays ${mono('ACQUIRING')}, prompt still active after 120 s, no tool result</td>
<td>${ok('runs')}: ${mono('NEXT-SESSION-…')} exit 0, turn ${mono('completed')}</td></tr>
<tr><td class="mut">Control: no restart, DELETE on the original process</td>
<td class="mut">drains: 204 in 5.2 s, RELEASED, record ${mono('cancelled / stop_requested')}</td>
<td class="mut">drains (same)</td></tr>
<tr><td class="mut">Control: detach → load → DELETE (same process)</td>
<td class="mut">the detach itself drains †</td>
<td class="mut">the detach drains (204 in 5.2 s, RELEASED); the later DELETE answers 204 in 76 ms</td></tr>
</table>
<div class="note">Same outcome as rounds 1–2 (on the legacy schema): the reloaded Session's close restores the obligation from the Broker and drains it (the ~5 s is the stop's grace), and the Workspace is usable again. On main the close answers 204 over a strand.</div>
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
DELETE                 204 in 119 ms → RELEASED</pre>
<h2>Isolation across Harness Sessions (pr) ¹</h2>
<pre>A (ws-a) and B (ws-b) each hold a live run
active-holds(A) / (B) each list only their own id
restart, load A only, DELETE A → A RELEASED, 0 processes
B untouched              → READY, 3 processes
load B, DELETE B         → B RELEASED, 0 processes</pre>
</div>
<div>
<h2>Load cost</h2>
<pre>main Harness (no query)  load 464–653 ms, mean 530 (8)
PR Harness (queries)     load 377–694 ms, mean 515 (16)
direct active-holds  median 42 ms (22 calls, max 178)
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
<tr><td>HTTP 500</td><td>200 in 477 ms</td><td class="mono">… could not restore its held Runtimes: Error: Runtime Broker returned HTTP 500 (rig_injected_500).</td><td>${warn('204, strand (pre-change)')}</td></tr>
<tr><td>id ${mono('../escape')}</td><td>200 in 502 ms</td><td class="mono">… Error: Runtime Broker active-holds answer is invalid.</td><td>${warn('204, strand')}</td></tr>
<tr><td>never answers</td><td>${warn('200 after 30.5 s')}</td><td class="mono">… TimeoutError: The operation was aborted due to timeout</td><td>${warn('204, strand')}</td></tr>
<tr><td>transparent</td><td>200 in 499 ms</td><td class="mut">none</td><td>${ok('204 in 5.2 s, RELEASED')}</td></tr>
</table>
<div class="note">¹ With ${mono('innodb_snapshot_isolation=OFF')} on the rig's MariaDB. With 11.8's default (ON), B's Harness open fails before the PR's code is reached, on main and pr alike; see M1 on the last card.</div>
`;

const card3 = `
<h1>The index in the canonical V1, and the JDBC read, on real engines</h1>
<div class="sub">Debian 13 arm64 · MariaDB 11.8.6 (collation_server utf8mb4_uca1400_ai_ci) · MySQL 8.4.11 container (utf8mb4_0900_ai_ci) · server jars from the trial merge (pr) and main 462cae3dd8 (base) · 200,000 synthetic ${mono('ma_tool_execution')} rows over 4,000 Harness Sessions</div>
<h2>Spring/Flyway path on a fresh database, then the repository's exact query (50 matching rows)</h2>
<table>
<tr><th style="width:14%">Engine</th><th style="width:16%">fresh V1</th><th style="width:35%">main's V1 (no index)</th><th>pr's V1</th></tr>
<tr><td>MariaDB 11.8.6</td><td>pr: ${ok('index present')}<br>main: absent</td><td class="mono">range · key PRIMARY · rows 189,578 · ANALYZE r_rows 200,000, r_filtered 0.03%</td><td class="mono">${ok('range · key idx_tool_execution_harness · rows 50')} · r_rows 50</td></tr>
<tr><td>MySQL 8.4.11</td><td>pr: ${ok('index present')}<br>main: absent</td><td class="mono">range · key PRIMARY · rows 89,087 · EXPLAIN ANALYZE ${bad('3,220 ms')}</td><td class="mono">${ok('range · key idx_tool_execution_harness · rows 50')} · ${ok('41.2 ms')}</td></tr>
</table>
<h2>Upgrade and rollback across V1 edits (identical on both engines)</h2>
<pre>DB created by main  → pr jar          refused at startup: Managed schema index differs: idx_tool_execution_harness
  + CREATE INDEX by hand → pr jar     refused: Migration checksum mismatch for migration version 1 (795235619 vs -1129878481)
DB created by pr    → main jar        refused: Migration checksum mismatch for migration version 1
precedent: DB created by main@91385884eb (before #13642's in-place V1 edit) → current main jar
                                      refused: Managed schema index differs: ix_ma_capture_execution</pre>
<h2>Standalone Broker initializer (JdbcRuntimeBrokerSchema.initialize → ManagedSchema.initialize)</h2>
<pre>pr  init, fresh DB      OK · idx_tool_execution_harness(harness_session_id, execution_call_id_hash)
pr  init, again         OK · unchanged (idempotent)
pr  init, main's DB     refused: Managed schema index differs: idx_tool_execution_harness   (both engines)</pre>
<h2>Exact Harness identity (VARBINARY column)</h2>
<pre>rows: hs-alias-abc/rs-lower · HS-ALIAS-ABC/rs-upper · "hs-alias-abc "/rs-space (all hold rows)
SQL '=' on harness_session_id          1 row     (both engines)
findHoldRowsByHarnessSession("hs-alias-abc")  1 row: [hs-alias-abc]/rs-lower   (both engines)</pre>
`;

const card4 = `
<h1>Follow-ups seen on the real stack</h1>
<div class="sub">${STACK}</div>
<h2>F1 · After a Broker (Spring) restart the drain cannot re-adopt the Runtime Session (unchanged from round 2)</h2>
<table>
<tr><th style="width:44%">Scenario</th><th style="width:28%">base (main)</th><th>pr</th></tr>
<tr><td>Live run → Broker restart → DELETE on the <b>same</b> Harness</td><td>${bad('503 ×5 over 2 min')}, 3 processes alive</td><td class="mut">same code path (not changed by the PR)</td></tr>
<tr><td>Live run → Broker restart → Harness restart → load → DELETE</td><td>${warn('204')}, strand: READY, 3 alive</td><td>${bad('503 ×5 over 2 min')}, READY, 3 alive</td></tr>
</table>
<div class="note warn">The PR makes a restarted Harness behave like a live one: on this path 204 + silent strand becomes a retryable 503 that did not clear within 2 min. Either way the run keeps running.</div>
<h2>F2 · After a reload, a background run's record never settles (unchanged)</h2>
<pre>exit before the restart (both)            child_run "settled / exited"   (publisher still attached)
natural exit after reload (pr)            child_run stays "running" (processes 0)
pr: drained close after reload            processes 0, Runtime Session RELEASED, child_run / monitor_run still "running"
no-restart close (both)                   child_run "cancelled", stopReason "stop_requested"</pre>
<h2>F3 · The review's shape (terminal hold row + READY Session) still not reachable</h2>
<div class="note">After a natural exit the hold row stays PREPARED until the drain settles it (s2 and s3 above), so 950d757813's change stands on its service-level test.</div>
<h2>M1 · main, not this PR: MariaDB 11.8 default snapshot isolation breaks a second Session's open</h2>
<pre>two Sessions in two Workspaces, A holding a live run; B's Harness open → 503 managed_session_open_failed
Spring: INSERT IGNORE INTO ma_event_stream (…) VALUES (?, ?, 'SESSION', X'', ?)
        error code [1020]; Record has changed since last read in table 'ma_event_stream'
same on main (base arm) · passes with innodb_snapshot_isolation=OFF · round 2 (legacy schema, same server) passed</pre>
`;

const cards = [
  { file: '01-restart-close-matrix.png', html: card1 },
  { file: '02-restore-isolation-degrade.png', html: card2 },
  { file: '03-v1-index-and-jdbc.png', html: card3 },
  { file: '04-follow-ups.png', html: card4 },
];
fs.writeFileSync('/Users/wenshao/pr13986-rig/fig3/cards.json', JSON.stringify(cards));
console.log('cards', cards.length);
