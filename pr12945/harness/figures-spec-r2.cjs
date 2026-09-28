// Round-2 figure (head bccf3d60). usage: node spec-r2.cjs <results dir>
const fs = require('fs');
const path = require('path');
const R = process.argv[2];
const load = (n) => JSON.parse(fs.readFileSync(path.join(R, 'bccf3d60', `report-${n}.json`), 'utf8'));
const f = (x) => (x == null ? '-' : String(Math.round(x)));
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
const W = [48, 70];
const m = (p, a, b, c) => C(p, [a, b, c], W);

const spec = [
  {
    name: 'r2-01-bccf3d60',
    title: '#12945 @ bccf3d60 (merge of main a77d80d1) — re-verification on the real stack',
    subtitle: 'PR-own files unchanged since 0c878352 except the hand-resolved IT hunk; main brought #12950 (file_path refusals), #12932 (D5 Turn queries), #12948, #12944',
    lines: [
      '## Merge resolution (git show --remerge-diff bccf3d60): 1 conflict, HostedWorkspaceToolTurnIT',
      '++ latency skips main\'s secondary Session (faults || latency ? "" : …); driver.json keeps latency metadata + secondarySessionId',
      '',
      '## CI-equivalent -Phosted-harness-mysql clean verify checkstyle:check on MySQL 8.4.7 → 178 unit + 9 IT green',
      '++ check-failsafe-reports.js ✓   test -s target/hosted-latency-baseline.json ✓   vitest cli/hosted-latency-baseline.test.ts 18/18',
      '',
      '## Latency method runs (unmodified product and driver)',
      group,
      header,
      row('CI-equivalent (in class run)', load('mysql-ci-1')),
      row('method only', load('bccf-mysql-2')),
      row('method only (mutant rig)', load('b-none')),
      row("author's cmd (H2 + unit tests)", load('bccf-h2-author')),
      row('method only', load('bccf-mariadb')),
      row('method only, JVM TZ=UTC', load('bccf-mariadb-utc')),
      row('GitHub CI job 109054667565', load('ci-linux-mysql846')),
      '',
      '## Bundle mutants (server-FG4P3XYK.js, MySQL 8.4.7): same outcome as 0c878352',
      m('++ ', 'P1 inference awaits warm-up', 'KILLED "model text precedes readiness"', ''),
      m('++ ', 'P2 warm-up only at first tool call', 'KILLED no-tool never warms (45 s wait)', ''),
      m('++ ', 'P3 tool dispatch skips readiness wait', 'KILLED "Broker use must wait for Runtime readiness"', ''),
      m('++ ', 'P4 continuation drops context', 'KILLED fake-model prefix assertion', ''),
      m('++ ', 'P5 :start sent twice', 'KILLED "one acquisition and execution"', ''),
      m('!! ', 'I1 / I2 pre-tool text made visible', 'REJECTED by the bare visible-text assert (S1, deferred)', ''),
      m('++ ', 'S1 candidate patch (still applies)', 'unit 19/19; I2 passes, firstVisibleTextDeltaMs −15,546 ms', ''),
      '',
      '## Correction to my previous report',
      '!! baseline sourceHashes: 4/5 match at bccf3d60 (and at 0c878352). HostedWorkspaceToolTurnIT.java differs since the first main merge;',
      '!! my earlier "5/5 match" was only true at f412baa5. The IT\'s latency path is unchanged → stale provenance metadata, not a behaviour change.',
    ],
    note: 'All green at bccf3d60: every Test Plan item re-verified on MySQL, MariaDB and H2, CI green (19 pass, 2 pending: web-shell smoke, review-pr). Earlier non-blocking items are explicitly deferred by the author; none of them blocks merge.',
  },
];
fs.writeFileSync(path.join(__dirname, 'spec-r2.json'), JSON.stringify(spec, null, 1));
console.log(spec.map((s) => `${s.name}: max line ${Math.max(...s.lines.map((l) => l.length))}`).join('\n'));
