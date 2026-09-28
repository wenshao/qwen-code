// Builds spec.json for rig/render.cjs from the saved latency reports.
// usage: node spec.cjs <results dir>
const fs = require('fs');
const path = require('path');
const R = process.argv[2];
const load = (h, n) => JSON.parse(fs.readFileSync(path.join(R, h, `report-${n}.json`), 'utf8'));
const f = (x) => (x == null ? '-' : String(Math.round(x)));
// Pad every cell but the last to its column width.
const C = (prefix, cells, widths) =>
  prefix + cells.map((c, i) => (i < cells.length - 1 ? String(c).padEnd(widths[i]) : String(c))).join('');
const R1 = [32, 18];
function row(label, r) {
  const n = r.samples.find((s) => s.scenario === 'no-tool');
  const t = r.samples.find((s) => s.scenario === 'tool');
  const db = r.environment.database.replace('MySQL 5.5.5-', 'MariaDB ').replace(/-MariaDB.*/, '').replace(/ \(.*\)/, '');
  const nums = [
    f(n.modelRounds[0].firstTextMs).padStart(5), f(n.turnCompleteMs).padStart(6), f(n.runtimeReadyMs).padStart(7), '  |',
    f(t.modelRounds[0].firstTextMs).padStart(6), f(t.runtimeReadyMs).padStart(7), f(t.acquireMs).padStart(8),
    f(t.toolWaitMs).padStart(7), f(t.firstVisibleTextMs).padStart(8), f(t.turnCompleteMs).padStart(7), '  |',
    `${n.storeRequests}/${t.storeRequests}`.padStart(6),
  ].join(' ');
  return C('++ ', [label, db, nums], R1);
}
const header = C('== ', ['run', 'database', [
  'text'.padStart(5), 'done'.padStart(6), 'ready'.padStart(7), '  |', 'text'.padStart(6), 'ready'.padStart(7),
  'acquire'.padStart(8), 'wait'.padStart(7), 'visible'.padStart(8), 'done'.padStart(7), '  |', 'store'.padStart(6),
].join(' ')], R1);
const group = '== ' + ' '.repeat(R1[0] + R1[1]) + 'no-tool Turn'.padEnd(23) + '|  tool Turn'.padEnd(52) + '| no-tool/tool';

const W2 = [52, 46, 30];
const m2 = (p, a, b, c, d) => C(p, [a, b, c, d], W2);
const W3 = [12, 15, 13, 26];
const m3 = (p, a, b, c, d, e) => C(p, [a, b, c, d, e], W3);
const W4 = [18, 16, 22, 12, 44];
const m4 = (p, a, b, c, d, e, g) => C(p, [a, b, c, d, e, g], W4);

const spec = [
  {
    name: '01-real-stack-runs',
    title: '#12945 @ 0c878352 — delayed-Runtime latency gate on the real stack: green on MySQL, MariaDB, H2 and CI',
    subtitle: 'Packaged Hosted Harness + Spring SQL Session Store + real local-process Broker/worker; worker import delayed 15 s; ms from prompt submission',
    lines: [
      '## CI-equivalent job: -Phosted-harness-mysql clean verify checkstyle:check on MySQL 8.4.7  →  172 unit + 9 IT green (both heads)',
      '++ check-failsafe-reports.js: HostedHarnessMySqlIT 2 · HostedProcessCrashIT 1 · HostedWorkspaceToolTurnIT 6',
      '++ test -s target/hosted-latency-baseline.json  ✓     cd integration-tests && npx vitest run cli/hosted-latency-baseline.test.ts  18/18',
      '++ checked-in baseline byte-identical after every run; its 5 sourceHashes match the committed files',
      '',
      '## Latency method runs at 0c878352 (unmodified product and driver)',
      group,
      header,
      row('CI-equivalent (in class run)', load('0c878352', 'mysql-ci-1')),
      row('whole class, 210 s profile', load('0c878352', 'mysql-class-wstools')),
      row('method only', load('0c878352', '0c87-mysql-2')),
      row('method only', load('0c878352', 'n-none')),
      row("author's cmd (H2 + unit tests)", load('0c878352', '0c87-h2-author')),
      row('method only', load('0c878352', '0c87-mariadb')),
      row('method only, JVM TZ=UTC', load('0c878352', '0c87-mariadb-utc')),
      row('GitHub CI job 108999593669', load('0c878352', 'ci-linux-mysql846')),
      '',
      '## Also at f412baa5 (pre-merge head): 8 more local runs green, incl. the refresh flow',
      '++ QWEN_HOSTED_UPDATE_BASELINE=1 rewrote integration-tests/baselines/hosted-latency.json (26 lines); the refreshed file passes 18/18;',
      '++ the next run without the variable compared against it (turnComplete deltas −1414 / −487 ms)',
      '== 15 local runs, both heads: no-tool done 547–3622 ms, ready 15592–17946 ms (margin ≥ 14.3 s); tool wait 15371–18279 ms, acquire 2–10 ms after ready',
      '== comparison deltas ranged −1.4 s … +14.7 s (host load 30–160) and never failed the gate',
    ],
    note: 'Every Test Plan item reproduced: provider text before readiness in both scenarios; no-tool completes during provisioning with 0 executions; the tool Turn waits, writes proof.txt once (SQL: 1 success, dispatch_generation 1, 1 settleTurn), resumes with the original prefix + matching call/result. Store counts 18/95 on the MariaDB container come from a pre-existing time-zone issue (figure 04).',
  },
  {
    name: '02-mutation-matrix',
    title: 'What the gate catches — bundle mutants of the Hosted Harness, MySQL 8.4.7, head 0c878352',
    subtitle: 'Each mutant patched into dist/chunks (server-*.js); same mutants cross-run against the pre-existing Workspace IT and the 133 Hosted unit tests',
    lines: [
      m2('== ', 'mutant', 'latency gate (this PR)', 'existing Workspace IT', '133 Hosted unit tests'),
      '## Regressions (must fail)',
      m2('++ ', 'P1 inference awaits Runtime warm-up first', 'KILLED "model text precedes readiness"', 'killed (30 s timeout)', 'survive'),
      m2('++ ', 'P2 warm-up only when a tool call arrives', 'KILLED no-tool never warms (45 s wait)', 'killed ("Warmup was not…")', 'survive'),
      m2('++ ', 'P3 tool dispatch skips the readiness wait', 'KILLED "Broker use must wait for…"', 'survive', 'survive'),
      m2('++ ', 'P4 continuation drops the original context', 'KILLED fake-model prefix assertion', 'killed (fake-model assert)', 'survive'),
      m2('++ ', 'P5 execution :start sent twice', 'KILLED "one acquisition and execution"', '-', 'killed (tool-turn tests)'),
      '',
      '## Improvements (should be allowed)',
      m2('!! ', 'I1 show the text part of a tool-call record', 'REJECTED by the bare assert', 'assert(sample.modelRounds.at(-1)!.finishedMs ', '<= sample.firstVisibleTextMs)'),
      m2('!! ', 'I2 I1 + commit it before the readiness wait', 'REJECTED by the same assert', '(candidate runs: visible at 267–327 ms, ', '>15 s before readiness)'),
      '',
      '## P3 probe (proxy readiness assert removed, f412baa5)',
      '== acquire granted at 117 ms (before readiness 15892) · Broker still started execution at 16314 · Turn completed, file written once, context kept',
      '== → fails only on assert(runtimeReadyMs <= acquireMs): the unique catch is a request-ordering rule, not an unsafe execution',
    ],
    note: 'Same outcome at f412baa5. Unit-test "kills" of P1/P2/P3/I1 seen under host load 120–160 were flakes: the unmutated baseline also failed (94/95, 132/133) and clean reruns survived. P5 kills are genuine (hosted-workspace-tool-turn.test.ts).',
  },
  {
    name: '03-visible-text-assert',
    title: 'Suggestion S1 — the visible-text assertion rejects a tool-Turn latency improvement',
    subtitle: 'integration-tests/helpers/hosted-latency-baseline.ts:81 · for the tool scenario at(-1) is the continuation round, which necessarily follows readiness',
    lines: [
      '## PR validator',
      '-- assert(sample.modelRounds.at(-1)!.finishedMs <= sample.firstVisibleTextMs);',
      '-- I1 / I2 on the real stack → AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value   (both heads)',
      '== design doc: "visible tool-Turn text may therefore follow readiness"; PR body: "currently arrives after readiness"',
      '',
      '## Candidate (+8/−1 validator, +8 test; patch on the assets branch)',
      "++ assert(first.firstTextMs <= sample.firstVisibleTextMs, 'visible text follows provider text');",
      "++ new case 'accepts tool-Turn text that becomes visible before readiness'  → 19/19; the new case FAILS on the PR validator",
      "++ removing the new assert is still caught by 'rejects text before model output' (pinning kept)",
      '',
      '## Candidate on the real stack, MySQL 8.4.7, 0c878352',
      m3('== ', 'run', 'tool visible', 'tool ready', 'visibleTextDelta', 'result'),
      m3('++ ', 'pristine', '16330', '15593', '+522 ms', 'pass'),
      m3('++ ', 'I1', '16061', '15805', '+253 ms', 'pass'),
      m3('++ ', 'I2', '267', '15630', '−15,541 ms', 'pass  ← the improvement shows up as a delta instead of a red job'),
      m3('++ ', 'P1', '-', '-', '-', 'KILLED "model text precedes readiness" (regressions still fail)'),
    ],
    note: 'Non-blocking. If pinning the current behaviour is intended, at least give the assert a message; the checked-in capture would need a refresh either way because its sourceHashes cover hosted-latency-baseline.ts.',
  },
  {
    name: '04-store-requests-tz',
    title: 'Observation — storeRequests includes writer-lease renewals; a DB/JVM time-zone mismatch turns them into a 250 ms loop',
    subtitle: 'MariaDB 10.11.18 container (session time zone UTC) + Spring JVM in Asia/Shanghai; pre-existing Store behaviour, not introduced by this PR',
    lines: [
      '## Driver copy logging /store/* requests (tool Session; route counts at f412baa5, lease values at 0c878352)',
      m4('== ', 'JVM zone', 'writers:renew', 'transactions:commit', 'resources', 'leaseUntil − now (acquire/renew)', 'storeRequests no-tool/tool'),
      m4('-- ', 'Asia/Shanghai', '79–80', '15', '12', '≈ −28,740 s (8 h − 60 s in the past)', '18 / 95–98'),
      m4('++ ', 'TZ=UTC', '0', '15', '12', '≈ +60 s', '9 / 23'),
      m4('++ ', 'MySQL 8.4.7 host', '0', '15', '12', '(CST session zone = JVM zone)', '9 / 23'),
      '',
      '## Why',
      '== ManagedSessionStore.databaseNow(): SELECT CURRENT_TIMESTAMP(6) → java.sql.Timestamp read in the JVM zone → leaseUntil 8 h early',
      '== HttpManagedSessionStore.ensureWriter(): renew when leaseUntil − now ≤ lease/3; scheduleRenewal() floors the timer at 250 ms',
      "== CI (UTC service + UTC runner) and the author's native MariaDB are unaffected; the gate still passed (store counts are descriptive only)",
    ],
    note: 'Out of scope for #12945. Worth a separate issue: every active writer renews ~4×/s whenever the DB session zone differs from the JVM zone. For this PR it only means storeRequests deltas can reflect lease traffic, not persistence work.',
  },
];
fs.writeFileSync(path.join(__dirname, 'spec.json'), JSON.stringify(spec, null, 1));
console.log(spec.map((s) => `${s.name}: max line ${Math.max(...s.lines.map((l) => l.length))}`).join('\n'));
