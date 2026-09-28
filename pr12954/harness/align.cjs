const fs = require('fs');
const f = process.argv[2];
const spec = JSON.parse(fs.readFileSync(f, 'utf8'));
const row = (p, cols, w) => p + cols.map((c, i) => (i < cols.length - 1 ? String(c).padEnd(w[i]) : String(c))).join('');
const W1 = [44];
const g = spec[0].lines;
g[0] = row('## ', ['Where', 'Result'], W1);
g[1] = row('++ ', ['native MySQL 8.4.7 (macOS arm64)', '4/4 cases 35.2 s · 4 repeats 4/4 (41–45 s, load avg 28–76)'], W1);
g[2] = row('++ ', ['MariaDB 10.11.18 (container)', '4/4 cases 36.6 s · 4 repeats 4/4 (42–59 s, load avg 24–38)'], W1);
g[3] = row('++ ', ["mysql:8.4.6 = CI image, CI's exact command", '-Phosted-harness-mysql clean verify checkstyle:check'], W1);
g[4] = row('   ', ['', '178 unit · HostedWorkspaceToolTurnIT 6/6 152.8 s (FG6f 34.5 s)'], W1);
g[5] = row('   ', ['', 'HostedProcessCrashIT + HostedHarnessMySqlIT green · Checkstyle 0 · failsafe audit OK'], W1);
g[6] = row('++ ', ['GitHub CI job 109056353459 (ubuntu, 8.4.6)', 'FG6F_DATABASE 8.4.6 + 4× FG6F + 4× FG6F_LEDGER (17:55:24→17:56:00)'], W1);
g[7] = row('   ', ['', 'Verify step 5 min 39 s of its 12 min budget'], W1);
const W2 = [6, 52, 6, 6, 6, 6];
const t = [
  ['## ', 'id', 'production change', 'PK', 'WK', 'RF', 'RR', 'unit suites'],
  ['-- ', 'A1', 'cold load ignores hasUnsettledInput (author)', 'KILL', 'KILL', 'KILL', 'KILL', 'survive'],
  ['-- ', 'A2', 'worker settles on acceptance failure (author)', '·', '·', 'KILL', 'KILL', '1 test'],
  ['== ', 'T3', 'cold load ignores restore.recoveryStatus', 'surv', 'surv', 'surv', 'surv', 'survive (redundant half)'],
  ['-- ', 'A1T3', 'whole cold-load guard removed', 'KILL', 'KILL', 'KILL', 'KILL', 'survive'],
  ['== ', 'H1', 'Harness settles recovery-required turn as error', '·', 'equiv', 'equiv', 'equiv', 'survive (finish() re-raises)'],
  ['-- ', 'H2', 'Harness calls Broker release after UNKNOWN', '·', 'KILL', 'KILL', 'KILL', '4 tests'],
  ['-- ', 'S1', 'Store commit non-atomic (noRollbackFor)', '·', '·', 'KILL', '·', '4 Java tests'],
  ['-- ', 'B1', 'Broker settles lost dispatch with synthetic error', 'KILL', 'KILL', 'KILL', 'KILL', '27/394 Java tests'],
  ['!! ', 'H2B', 'H2 + driver blind to release', '·', 'KILL', '·', 'KILL', 'Broker refuses release itself'],
];
spec[1].lines.splice(0, 10, ...t.map((r) => row(r[0], r.slice(1), W2)));
const W3 = [40];
const m = spec[2].lines;
m[6] = row('++ ', ['PR ⊕ main a77d80d1', 'clean'], W3);
m[7] = row('!! ', ['PR ⊕ #12945 (Hosted latency baseline)', '1 file, 2 hunks in HostedWorkspaceToolTurnIT.java'], W3);
m[8] = row('   ', ['', '(marker ternary chain + per-Workspace report dispatch) — keep both branches'], W3);
m[9] = row('++ ', ['resolved tree, whole class on MySQL', '7/7 in 180.4 s (FG6f 32.3 s, latency 33.0 s)'], W3);
m[10] = row('!! ', ['focused -Phosted-workspace-tools', 'forkedProcessTimeoutInSeconds 210 → ~86% used at load ~30'], W3);
m[11] = row('== ', ['', 'CI uses -Phosted-harness-mysql (600 s): whole Hosted fork ≈ 300 s'], W3);
fs.writeFileSync(f, JSON.stringify(spec, null, 1));
console.log(spec[1].lines.slice(0, 10).join('\n'));
