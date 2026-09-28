// Builds the evidence cards for the PR #12888 verification report.
import fs from 'node:fs';
import path from 'node:path';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/83b94b04-5287-4c5b-88f4-0baa57846046/scratchpad';
const OUT = path.join(SP, 'figures');
const log = (name) => fs.readFileSync(path.join(SP, 'logs', name), 'utf8');
const exists = (name) => fs.existsSync(path.join(SP, 'logs', name));

const css = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mute:#8b949e;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--acc:#58a6ff;--pur:#bc8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.card{width:1500px;padding:28px 32px 26px}
h1{font-size:23px;margin:0 0 4px;font-weight:650}
.sub{color:var(--mute);font-size:14px;margin-bottom:18px}
table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:14px}
th{color:var(--mute);font-weight:600;background:#11161d;font-size:13px}
tr:last-child td{border-bottom:none}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}.warn{color:var(--warn);font-weight:600}.acc{color:var(--acc)}.mute{color:var(--mute)}.pur{color:var(--pur)}
.note{margin-top:14px;border-left:3px solid var(--acc);padding:6px 12px;color:#c9d1d9;background:#0f1620;font-size:14px}
.note.warn{border-color:var(--warn)}.note.bad{border-color:var(--bad)}.note.ok{border-color:var(--ok)}
pre{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px;white-space:pre;overflow:hidden;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.label{color:var(--mute);font-size:12.5px;margin:0 0 5px}
.pill{display:inline-block;padding:0 7px;border-radius:10px;font-size:12px;font-weight:600;border:1px solid}
.pill.ok{border-color:#238636;background:#0f2a17}.pill.bad{border-color:#8e1519;background:#2d0f12}.pill.warn{border-color:#9e6a03;background:#2b1d05}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}</div></body></html>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CASES = ['arguments', 'intent', 'await-runtime', 'result-message', 'result-checkpoint', 'result-reply', 'turn-reply'];
const INJECT = {
  arguments: 'SQL trigger: resource insert <code>managed-tool-input</code>',
  intent: 'SQL trigger: journal insert <code>toolIntent</code>',
  'await-runtime': 'SQL trigger: <code>await_runtime</code> checkpoint',
  'result-message': 'SQL trigger: <code>tool_result</code> message',
  'result-checkpoint': 'SQL trigger: <code>results_ready</code> checkpoint',
  'result-reply': 'commit applied, reply dropped (tool_result)',
  'turn-reply': 'commit applied, reply dropped (turn.settled)',
};
const fg = (text, c) => {
  const m = text.match(new RegExp(`FG6B ${c}: faults=(\\d+), modelCalls=(\\d+), starts=(\\d+), cold=(\\w+)`));
  return m ? { faults: m[1], model: m[2], starts: m[3], cold: m[4] } : undefined;
};
const ledgers = (text) => Object.fromEntries([...text.matchAll(/PROBE_LEDGER (\{.*\})/g)].map((m) => { const j = JSON.parse(m[1]); return [j.fault, j]; }));

// ---------- Figure 1: the PR gate on three local databases + CI ----------
const a = log('it-ci-mysql847.log'), b = log('it-ci-mysql8411.log'), c = log('it-mariadb-1.log'), k = log('ci-pr-hosted.log');
const led = ledgers(log('it-ledger-pr-driver.log'));
const rows1 = CASES.map((cs) => {
  const ref = fg(a, cs);
  const cell = (t) => { const x = fg(t, cs); const same = x && ref && JSON.stringify(x) === JSON.stringify(ref); return x ? `<span class="${same ? 'ok' : 'bad'}">✓</span> <span class="mono">${x.faults}/${x.model}/${x.starts}/${x.cold === 'blocked' ? '<span class="warn">blocked</span>' : '<span class="ok">loads</span>'}</span>` : '<span class="bad">missing</span>'; };
  const marker = cs.endsWith('-reply') ? '<span class="mute">n/a (reply loss)</span>' : [a, b, c, k].every((t) => t.includes(`java.sql.SQLException: FG6B_${cs}`)) ? '<span class="ok">4/4 runs</span>' : '<span class="bad">missing</span>';
  const l = led[cs];
  const ex = l.executions.map((e) => `gen=${e.dispatch_generation} ${e.execution_state} ${e.execution_status}`).join('; ');
  const jr = l.journal.filter((x) => !/Activation/.test(x));
  const last = jr.at(-1).replace(/^\d+:/, '').replace('[checkpoint.committed]', '').replace('commitMessage[message:', 'message[');
  return `<tr><td class="mono">${cs}</td><td>${INJECT[cs]}</td><td>${cell(a)}</td><td>${cell(b)}</td><td>${cell(c)}</td><td>${cell(k)}</td><td>${marker}</td><td class="mono">${ex}</td><td class="mono">${l.ownerHeld ? 'held' : 'released'}</td><td class="mono">${esc(last)}</td></tr>`;
}).join('');
const reps = (p, n) => Array.from({ length: n }, (_, i) => log(`it-rep-${p}-${i + 1}.log`).match(/Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: ([0-9.]+) s/)?.[1] ?? 'FAIL');
const classT = (t) => t.match(/Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: ([0-9.]+) s -- in com.alibaba.qwen.code.managedagent.HostedWorkspaceToolTurnIT/)?.[1];
fs.writeFileSync(path.join(OUT, '01.html'), page(
  'PR #12888 FG6b gate on real databases — local MySQL (macOS + Linux), MariaDB, and CI',
  'Head <code>21f555d6</code> · packaged <code>dist/cli.js</code> Harness + Spring Session Store + embedded Runtime Broker + real worker · the PR\'s own driver and IT, unmodified · cell = Store faults fired / model calls / Broker starts / fresh-Harness load',
  `<table><tr><th>case</th><th>injection</th><th>MySQL 8.4.7 · macOS</th><th>MySQL 8.4.11 · Linux</th><th>MariaDB 10.11.18</th><th>CI MySQL 8.4.6</th><th>SQL exception marker</th><th>SQL: tool execution</th><th>storage owner</th><th>last durable (non-activation) commit</th></tr>${rows1}</table>
  <div class="grid2"><div class="note ok">CI-equivalent <code>-Phosted-harness-mysql clean verify checkstyle:check</code>: Java unit 137/137, <code>HostedWorkspaceToolTurnIT</code> 3/3 (${classT(a)} s macOS / ${classT(b)} s Linux), <code>HostedHarnessMySqlIT</code> 1/1, Checkstyle clean. MariaDB (<code>-Phosted-workspace-tools</code>): 137 + 3/3 in ${classT(c)} s. PR CI job 108774837224 at <code>21f555d6</code>: the same 7 lines, 5 SQL markers, 3/3 + 1/1, and the failsafe coverage step lists 3 tests. Leftover <code>fg6b_%</code> triggers on all three databases afterwards: <b>0</b>.</div>
  <div class="note ok">Stability, FG6b method only (load average ≈ 35–42 on this 10-core host throughout): MySQL 8.4.7 ×5 (${reps('mysql847', 5).join(', ')} s), MariaDB ×3 (${reps('mariadb', 3).join(', ')} s), Linux MySQL 8.4.11 ×2 (${reps('mysql8411', 2).join(', ')} s) — <b>10/10 green</b>. SQL columns are read directly from <code>qwen_tool_execution</code>, <code>managed_workspace_execution_lease</code> and <code>qwen_managed_session_journal_tx</code> after the run (MySQL 8.4.7).</div></div>`));

// ---------- Figure 2: fault points the gate does not contain ----------
const probeLog = log('it-probe-3.log');
const sums = Object.fromEntries([...probeLog.matchAll(/PROBE_SUMMARY (\{.*\})/g)].map((m) => { const j = JSON.parse(m[1]); return [j.fault, j]; }));
const pled = ledgers(probeLog);
const PROBES = {
  'assistant-reply': 'assistant message (with the tool call) applied; reply dropped',
  'intent-reply': '<code>toolIntent</code> commit applied; reply dropped',
  'await-runtime-reply': '<code>await_runtime</code> checkpoint applied; reply dropped — the last write before Broker start',
  'result-checkpoint-reply': '<code>results_ready</code> checkpoint applied; reply dropped',
  'batch-result-message': 'two <code>edit</code> calls in one batch; SQL trigger rejects the <b>first</b> tool_result',
};
const rows2 = Object.keys(PROBES).map((p) => {
  const s = sums[p], l = pled[p];
  const broker = s.broker.filter((x) => !x.startsWith('prepare#2')).filter((x) => x !== 'warm').join(' → ');
  const ex = l.executions.length ? l.executions.map((e) => `gen=${e.dispatch_generation} ${e.execution_status}`).join('<br>') : '<span class="mute">none (no prepare)</span>';
  const file = p.startsWith('batch-') ? `proof ${s.file} · proof2 ${s.file2}` : s.file;
  const next = s.nextPrompt.startsWith('409') ? '<span class="warn">409 recovery_required</span>' : esc(s.nextPrompt);
  const cold = s.coldLoad.startsWith('409') ? '<span class="warn">409 recovery_required</span>' : esc(s.coldLoad);
  const restored = s.coldTargetRestored === 'no target' ? '—' : s.coldTargetRestored === 0 ? '0 (rejected)' : `${s.coldTargetRestored}×`;
  return `<tr><td class="mono">${p}</td><td>${PROBES[p]}</td><td class="mono">${esc(broker)}</td><td class="mono">${file}</td><td class="mono">${ex}</td><td>${next}</td><td>${cold}</td><td class="mono">${restored}</td><td class="mono">${s.coldBrokerCalls.length} / ${s.coldModelCalls}</td></tr>`;
}).join('');
const tl = (p) => sums[p].commits.slice(4).map((x) => '  ' + x).join('\n');
fs.writeFileSync(path.join(OUT, '02.html'), page(
  'Beyond the PR gate — five more Store fault points on the same real stack (MySQL 8.4.7)',
  'Verification-only probe driver reusing the PR\'s IT scaffolding (triggers, proxy, fresh Harness, SQL ledger); the edit is non-idempotent (<code>x → xx</code>), so any replay would show <code>xxxx</code>',
  `<table><tr><th>probe</th><th>fault</th><th>Broker calls (live)</th><th>file</th><th>SQL: tool execution(s)</th><th>next live prompt</th><th>fresh-Harness load</th><th>target tx restored</th><th>cold Broker / model calls</th></tr>${rows2}</table>
  <div class="grid2"><div><div class="label">await-runtime-reply — Store commits seen by the proxy (after session setup)</div><pre>${esc(tl('await-runtime-reply'))}\n\n  Broker: acquire → prepare → cancel   (no start; execution gen=0 cancelled)</pre></div>
  <div><div class="label">batch-result-message — the second call is never started</div><pre>${esc(tl('batch-result-message'))}\n\n  Broker: acquire → prepare ×2 → start ×1 → status → cancel ×2\n  proof.txt = xx (call 1 ran once) · proof2.txt = y (call 2 never ran)</pre></div></div>
  <div class="note ok">Every probe fails closed: an applied-but-unacknowledged pre-start write (assistant, intent, await_runtime) never leads to a Broker start — the reservation is cancelled at generation 0 and the file stays <code>x</code>. A lost <code>results_ready</code> ACK keeps the single effect. In a two-call batch, a rejected first result stops the loop before call 2 starts. The live session refuses the next prompt, a fresh Harness refuses the unsettled turn, and neither cold load contacts the Broker or the model. The Store returned the original receipt with <code>replayed: true</code> for each dropped reply.</div>`));
console.log('ok');

// ---------- Figure 3: independent mutants + dedicated-user check ----------
const MUT = [
  ['T1', 'tool-turn.ts', 'commit <code>results_ready</code> before the <code>tool_result</code> message', 'killed', 'result-checkpoint · durable tool_result 0 ≠ 1 (driver)'],
  ['T2', 'harness-session.ts', 'live session ignores <code>session.blocked</code> for new prompts', 'killed', 'arguments · next prompt 503 <code>hosted_prompt_admission_failed</code> ≠ 409 (driver)'],
  ['T4', 'harness-session.ts', 'fresh load drops the <code>hasUnsettledInput</code> half of the gate', 'killed', 'arguments · fresh-Harness load 200 ≠ 409 (driver)'],
  ['T5', 'core http-managed-session-store.ts', 'Store client retries a commit once after a transport failure', 'killed', 'result-reply · “Harness must not retry the failed write” 1 ≠ 0 (proxy)'],
  ['T6', 'tool-turn.ts', 'no best-effort cancel of reserved executions after a Store failure', 'killed', 'arguments · execution PREPARED ≠ SETTLED — <b>only the Java SQL ledger</b>; the TS driver printed <code>HOSTED_STORE_FAILURES_OK</code>'],
  ['A', 'core managed-session-authority.ts', 'authority keeps writing after an earlier failed/unacknowledged write', 'killed', 'turn-reply · settlement retry reaches the Store → 409 <code>managed_session_head_conflict</code> (proxy)'],
  ['T7', 'tool-turn.ts', '<code>tool_result</code> commit failure swallowed (loop continues)', 'survived', 'masked by <code>writeFailure</code> in the authority: the next write is refused locally — same observable outcome'],
  ['T7+A', 'both', 'swallow the failure <b>and</b> drop the authority guard', 'killed', 'result-message · recoveryBlocked false, 2 model calls (driver)'],
  ['T3', 'harness-session.ts', 'fresh load drops the <code>restore.recoveryStatus !== \'ok\'</code> half', 'survived', 'expected — all 7 refusals are carried by <code>hasUnsettledInput</code>; <code>hosted-harness-session.test.ts</code> also 16/16 on this mutant (pre-existing, outside this test-only PR)'],
];
const rows3 = MUT.map(([id, f, what, res, where]) => `<tr><td class="mono">${id}</td><td class="mono">${f}</td><td>${what}</td><td>${res === 'killed' ? '<span class="pill ok">killed</span>' : '<span class="pill warn">survived</span>'}</td><td>${where}</td></tr>`).join('');
const nonroot = log('it-nonroot-binlog.log');
const errLine = nonroot.match(/Caused by: java.sql.SQLException: (You do not have the SUPER privilege[^\n]*)/)?.[1] ?? '?';
const trust = log('it-nonroot-trust.log').match(/Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: ([0-9.]+) s/)?.[1];
fs.writeFileSync(path.join(OUT, '03.html'), page(
  'Reverse checks — 9 independent mutants (not the author\'s 11) against the unmodified FG6b gate, plus a dedicated-user run',
  'Each mutant: edit source → re-bundle <code>dist/cli.js</code> (core is bundled from <code>src/</code> via <code>packages/cli/tsconfig.json</code> paths) → run <code>HostedWorkspaceToolTurnIT#sessionStoreFailuresNeverReplayEffectsOnMySql</code> on MySQL 8.4.7 → restore. Restored bundle is byte-identical to the PR build (<code>diff -rq dist</code> empty).',
  `<table><tr><th>id</th><th>file</th><th>guard removed</th><th>gate</th><th>first failing case · assertion (layer)</th></tr>${rows3}</table>
  <div class="grid2"><div class="note ok">7 of 9 killed at the intended behaviour, never by a startup/compile error. T6 is caught <b>only</b> by the independent SQL ledger, which justifies the Java-side assertions. T7 survives because of a second, deeper guard (the authority's <code>writeFailure</code>) — removing both is killed. T5 shows the gate deliberately pins “no automatic Store retry”: a future idempotent-retry feature must update this gate on purpose.</div>
  <div><div class="label">Dedicated non-root user (<code>GRANT ALL ON it_nonroot.*</code>) · MySQL 8.4.7 · default <code>log_bin=1</code></div><pre>log_bin_trust_function_creators=0  →  ERROR at createStoreFaultTrigger (before any fault)
  java.sql.SQLException: ${esc(errLine.split(" (you")[0])}
    (you${esc(errLine.split(" (you")[1] ?? "")}
log_bin_trust_function_creators=1  →  FG6b 1/1 green in ${trust} s, 0 triggers left
CI is unaffected: the Hosted MySQL job connects as root.</pre></div></div>`));
console.log('ok3');

// ---------- Figure 4: merge order with #12848 ----------
const mg = log('it-merge-ci-mysql8411.log');
const mgT = (n) => mg.match(new RegExp(`Tests run: ${n}, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: ([0-9.]+) s -- in com.alibaba.qwen.code.managedagent.(HostedWorkspaceToolTurnIT|HostedHarnessMySqlIT)`, 'g'));
const classMerge = mg.match(/Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: ([0-9.]+) s -- in com.alibaba.qwen.code.managedagent.HostedWorkspaceToolTurnIT/)?.[1];
const harnessMerge = mg.match(/Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: ([0-9.]+) s -- in com.alibaba.qwen.code.managedagent.HostedHarnessMySqlIT/)?.[1];
const rowsM = CASES.map((cs) => { const x = fg(mg, cs), r = fg(a, cs); return `<tr><td class="mono">${cs}</td><td class="mono">${r.faults}/${r.model}/${r.starts}/${r.cold}</td><td class="mono">${x ? `${x.faults}/${x.model}/${x.starts}/${x.cold}` : 'missing'}</td><td>${x && JSON.stringify(x) === JSON.stringify(r) ? '<span class="ok">same</span>' : '<span class="bad">differs</span>'}</td></tr>`; }).join('');
fs.writeFileSync(path.join(OUT, '04.html'), page(
  'Merge order with in-flight #12848 (Hosted Shell) — textual conflict, green once resolved',
  '<code>git merge-tree 21f555d6 6846d1e2</code>: one conflicted file, <code>HostedWorkspaceToolTurnIT.java</code> (2 hunks). #12848 also rewrites <code>hosted-workspace-tool-turn.ts</code> (+217 lines), the code FG6b exercises. Trial merge built from scratch; Linux MySQL 8.4.11.',
  `<div class="grid2" style="margin-top:0"><div><div class="label">resolution — keep both sides (#12848's six-case happy path + this PR's driverName/storeFaults)</div><pre>@Timeout(360)   // from #12848
void packagedHarnessUses…() {
    runDriver(List.of("alpha", "beta", "shell", "storage-failure",
            "raw-reply-loss", "cancel"), "workspace-tool-turn");
}
…
assertThat(Files.readString(log)).contains(storeFaults ? "HOSTED_STORE_FAILURES_OK"
        : faults ? "HOSTED_REPLY_LOSS_OK" : "HOSTED_WORKSPACE_TOOLS_OK");
if (faults) {                        // #12848's restructured block
    JsonNode reports = …driver.json.results…;
    if (cases.contains("status")) assertThat(statusGate.isDone()).isTrue();
    for (int index = 0; index < workspaces.size(); index++) {
        assertFaultLedger(jdbc, tenant, sessions.get(index), index,
                reports.get(index), storeFaults);   // + storeFaults
        assertThat(workspaces.get(index).resolve("proof.txt")).doesNotExist();
    }
} else { … workspaces.subList(0, 2) … }</pre></div>
  <div><table><tr><th>FG6b case</th><th>PR head</th><th>merged tree</th><th></th></tr>${rowsM}</table>
  <div class="note ok">Merged tree, <code>-Phosted-harness-mysql clean verify checkstyle:check</code>: 137/137 unit, <code>HostedWorkspaceToolTurnIT</code> 3/3 in <b>${classMerge} s</b> (#12848's happy path alone ≈ 76 s), <code>HostedHarnessMySqlIT</code> ${harnessMerge} s, Checkstyle clean. The five extra probes from card 2 give the same outcome on the merged tree (only the number of Broker <code>status</code> polls in turn-reply varies with timing).</div>
  <div class="note warn">Fork budget: <code>forkedProcessTimeoutInSeconds</code> is <b>180 s</b> for all <code>Hosted*IT</code> in <code>-Phosted-harness-mysql</code>. Combined tree ≈ ${Math.round(Number(classMerge) + Number(harnessMerge))} s here (#12848's CI class alone: 80.7 s). ≈ ${180 - Math.round(Number(classMerge) + Number(harnessMerge))} s of headroom on this host; in CI, #12848's class (80.7 s) plus FG6b (≈ 19 s there) lands in the same range. Worth watching as more gates join this class.</div></div></div>`));
console.log('ok4');
