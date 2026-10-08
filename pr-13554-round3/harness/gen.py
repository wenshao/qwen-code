import html, os
OUT = os.path.dirname(os.path.abspath(__file__))
CSS = """
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
.card{width:1360px;padding:26px 30px 30px 30px;box-sizing:border-box}
h1{font-size:23px;margin:0 0 4px 0;font-weight:650}
.sub{color:#8b949e;font-size:14px;margin:0 0 16px 0}
h2{font-size:16px;margin:18px 0 8px 0;color:#c9d1d9;font-weight:600}
table{border-collapse:collapse;width:100%;margin:2px 0 6px 0;font-size:14px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
td.num{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{border-left:4px solid #388bfd;background:#0d1d33;padding:9px 13px;margin:12px 0 0 0;font-size:14px}
.note.red{border-color:#f85149;background:#2a1215}.note.green{border-color:#3fb950;background:#0f2a17}.note.amber{border-color:#d29922;background:#2b2111}
pre{background:#161b22;border:1px solid #30363d;padding:9px 12px;margin:4px 0;font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
"""

def page(name, title, sub, body):
    doc = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='card'><h1>{title}</h1><div class='sub'>{sub}</div>{body}</div></body></html>"
    open(os.path.join(OUT, name + '.html'), 'w').write(doc)

def table(head, rows, num=()):
    h = ''.join(f'<th>{c}</th>' for c in head)
    out = []
    for r in rows:
        out.append('<tr>' + ''.join(f"<td class='num'>{c}</td>" if i in num else f'<td>{c}</td>' for i, c in enumerate(r)) + '</tr>')
    return f"<table><tr>{h}</tr>{''.join(out)}</table>"

OK = "<span class='ok'>{}</span>".format
BAD = "<span class='bad'>{}</span>".format
WARN = "<span class='warn'>{}</span>".format

# 01 overview -------------------------------------------------------------
page('01-gates', '#13554 round 3: gates at the current head',
     'Head <code>002f8eb95a</code> (docs-only on top of <code>2c5a6199af</code>, 0 non-Markdown lines changed). '
     'The sdk-java tree of <code>2c5a6199af</code> is identical to its trial merge with main <code>29aef7de40</code>.',
     '<h2>What changed since round 2 (<code>2e892a9d</code>)</h2>' +
     table(['Commit', 'Change', 'Exercised by'], [
         ['<code>cc361831ce</code>', 'LIMIT 101 look-ahead replaces the exhaustion probe; blocked-transition log; completion log total; reader names publication-nulled copies', 'E2E-1 page boundaries + statement count, mutants N02–N05, N12, N13'],
         ['<code>ccb5c8a369</code>', '<code>AND inline_bytes IS NOT NULL</code> in the page query (phantom double count)', 'E2E-1 phantom A/B, LOB cost (F1)'],
         ['<code>baac58259a</code>', 'monotonic ledger-scan cadence; positive-evidence <code>resource_collected</code>', 'CAD wall-clock step A/B, real O4-2 probe'],
         ['<code>71d7d6a6a5</code>', 'V51 to V53; <code>containsSequence</code> IT expectation; COLLECTED-state test', 'upgrade V52 to V53 on both DBs, MariaDB IT lane'],
         ['<code>2c5a6199af</code> / <code>002f8eb95a</code>', 'empty commit / 5 Markdown files (both pre-V53 verdicts named)', 'diff check; probe confirms the doc claim'],
     ]) +
     '<h2>Gates</h2>' +
     table(['Gate (local: colima Linux aarch64 VM, JDK 21.0.9, Maven 3.9.11, mysql:8.4.6 / mariadb:10.11.18)', 'Result'], [
         ['CI MariaDB-lane command <code>-Pmysql-integration clean verify checkstyle:check</code>', OK('1444/1444') + ' (2 skipped), ITs ' + OK('125/125') + ', Checkstyle 0'],
         ['<code>-Po4-mysql-gates</code> on MySQL 8.4.6', 'O4MySqlGate ' + OK('48/48') + ', Checkstyle 0'],
         ['PR suite through a <code>dataSource()</code> override, MySQL 8.4.6 / MariaDB 10.11.18', OK('52/52') + ' / ' + OK('52/52') + ' (52 fresh schemas each, 53 migrations)'],
         ['Flyway uniqueness over the trial merge', '53 migrations, all unique. ' + WARN('V53 is also claimed by 10 other open PRs')],
         ['CI at <code>2c5a6199af</code>', 'MariaDB lane 1444 + ITs 125; Hosted lane 1444 x2, HostedWorkspaceToolTurnIT 8/8, O4MySqlGate 48/48'],
         ['CI at <code>002f8eb95a</code>', 'all Java lanes, MariaDB lane, Hosted lane, Flyway: ' + OK('success')],
     ]) +
     "<div class='note green'>Every round-2 result still holds. The round-3 fixes work on the production app (next figures). One new performance regression (F1) and one test gap (F2) came out of the delta; both have verified candidate patches.</div>")

# 02 LOB ------------------------------------------------------------------
lob = table(['Page query (one execution, warm server)', 'MySQL 150 x 1 MiB', 'MySQL 40 x 16 MiB', 'MariaDB 150 x 1 MiB', 'MariaDB 40 x 16 MiB'], [
    ['r2 <code>2e892a9d</code> (no BLOB predicate, LIMIT 100)', '26-29 ms / 133-220', '24-27 ms / 56', '5-32 ms / 111', '5-24 ms / 45'],
    ['<b>head</b> (<code>AND inline_bytes IS NOT NULL</code>, LIMIT 101)', BAD('70-75 ms / ~6,890'), BAD('259-281 ms / ~41,470'), BAD('60-87 ms / 6,677-7,017'), BAD('309-466 ms / 41,229')],
    ['candidate (guard moved into the UPDATE, LIMIT 101)', OK('24-25 ms / 134'), OK('24-25 ms / 56'), OK('5 ms / 112'), OK('4-6 ms / 45')],
], num=(1, 2, 3, 4))
app = table(['Production app, E2E-1 (MySQL)', 'page-query executions', 'total time', 'ledger outcome'], [
    ['r2', '28 (page + exhaustion probe)', '13.0 ms', 'phantom double counted'],
    ['head', '14 (one per page)', BAD('88.6 ms'), 'byte-exact'],
    ['candidate', '14 (one per page)', OK('9.7 ms'), 'byte-exact, identical to head'],
])
upd = table(['Page UPDATE (rolled back)', 'MySQL 32 x 1 MiB', 'MySQL 2 x 16 MiB', 'MariaDB 32 x 1 MiB', 'MariaDB 2 x 16 MiB'], [
    ['head form', '3,015-3,021', '2,106', '2,710-2,774', '2,090-2,094'],
    ['candidate form (+ <code>AND inline_bytes IS NOT NULL</code>)', '3,012-3,015', '2,106-2,111', '2,710', '2,090'],
], num=(1, 2, 3, 4))
page('02-lob-read-amplification', 'F1: the phantom guard makes every page query read the candidates’ BLOBs',
     'Cells are wall time / InnoDB buffer-pool read requests. The head form also missed the buffer pool about 6,400-6,700 (1 MiB) and 36,000-37,000 (16 MiB) times per query.',
     lob + '<h2>On the production app</h2>' + app + '<h2>The UPDATE already reads those pages, so moving the guard costs nothing</h2>' + upd +
     "<div class='note red'>InnoDB materializes an externally stored BLOB that the WHERE clause references, even for <code>IS NOT NULL</code>. "
     "The page query fetches up to 101 rows but frees at most 32 MiB. With 1 MiB background-Shell segments it reads about 101 MiB per page, roughly 3x the bytes it frees. "
     "With 16 MiB content rows (the contract maximum) it reads up to about 1.6 GiB to free 32 MiB. The candidate moves the guard into the UPDATE and counts only rows that the UPDATE freed. "
     "It passes 53/53 on H2, MySQL and MariaDB, and both of its guards are pinned by the existing <code>alreadyFreedRowsAreNotCountedAgain</code>.</div>")

# 03 E2E-1 + CAD ----------------------------------------------------------
e1 = table(['Session (real HTTP producer, retired by the production transaction)', 'rows', 'head: pages / bytes', 'r2: pages / bytes'], [
    ['s7 exactly 100 rows', '100', '1 / 203,776', '1 / 203,776'],
    ['s8 101 rows', '101', '2 / 205,824', '2 / 205,824'],
    ['s9 exactly 32 MiB (32 x 1 MiB)', '32', '1 / 33,554,432', '1 / 33,554,432'],
    ['s10 32 MiB + one 2 KiB page', '33', '2 / 33,556,480', '2 / 33,556,480'],
    ['s1 background Shell 40 MiB', '71', '2 / 42,005,504', '2 / 42,005,504'],
    ['s2 251 small rows', '251', '3 / 513,024', '3 / 513,024'],
    ['s3 empty / s6 other tenant', '0 / 6', '1 / 0, 1 / 2,104,320', '1 / 0, 1 / 2,104,320'],
    ['s5 recovery_protected', '4', 'blocked, bytes kept', 'blocked, bytes kept'],
    ['s11 phantom (one 2 KiB row freed out of band)', '4', OK('1 / 5,120: phantom stays PUBLISHED'), BAD('1 / 7,168: phantom counted and marked COLLECTED')],
    ['recovery read of the phantom row', '', OK('resource_corrupt (fail-closed)'), BAD('resource_collected')],
], num=(1,))
cad = table(['CAD: JVM wall clock steps back 600 s at runtime (libfaketime; DB and monotonic clocks untouched)', 'head', 'r2'], [
    ['control session retired before the step', 'collected', 'collected'],
    ['session retired 2 s after the step', OK('ledger + collection 46 s after retirement'), BAD('no ledger after 200 s (stalls about 11 min)')],
])
page('03-e2e-ab', 'Round-3 fixes on the production app: head vs round-2 head',
     'One production Spring instance per arm on MySQL 8.4.6, grace 20 s, gc-enabled. Reads returned 409 tool_output_session_retired before and after collection; 0 retry WARNs; 0 object-store calls.',
     e1 + '<h2>Monotonic ledger-scan cadence (R2-5)</h2>' + cad +
     "<div class='note green'>The look-ahead page logic produces the same page counts as the old probe at every boundary, with half the page-query executions. "
     "The phantom fix removes the double count and keeps the row on the fail-closed path. The cadence fix keeps working through a backward wall-clock step.</div>")

# 04 recovery probe -------------------------------------------------------
rp = table(['WorkspaceRecoveryReader after a real O4-2 collection', 'main <code>29aef7de</code>', 'r2 <code>2e892a9d</code>', 'head'], [
    ['managed-tool-outcome copy (REFERENCED, bytes nulled by O4-2)', 'resource_corrupt', 'resource_corrupt', OK('resource_collected')],
    ['managed-tool-result-manifest copy (REFERENCED, bytes nulled by O4-2)', 'resource_corrupt', 'resource_corrupt', OK('resource_collected')],
    ['same copies after the catalog rows are set back to VERIFIED', 'resource_corrupt', 'resource_corrupt', OK('resource_corrupt')],
    ['stream-capture row collected by this PR (state COLLECTED)', 'resource_layout_unsupported', 'resource_collected', OK('resource_collected')],
    ['E2E-1 phantom row (PUBLISHED, bytes gone, no catalog marker)', '<span class="dim">n/a (no stream-capture collector)</span>', 'resource_collected', OK('resource_corrupt')],
])
page('04-recovery-verdicts', 'Positive-evidence resource_collected on a real publication (R2-6)',
     'The probe runs the repository’s committed foreground-capture flow (segments, page, manifest, finish, admission, receipt) on a real schema. '
     'It then retires the Session with the production transaction, runs the production ToolPublicationCollector (1 tick, 2 object deletes) and the production reader. MySQL 8.4.6 and MariaDB 10.11.18 give identical results.',
     rp + "<pre>PROBE O4-2 collector ticks=1 deleted-object-keys=2\n"
          "PROBE recovery-read kind=managed-tool-outcome state=REFERENCED storage=MYSQL_INLINE freed=true -> REFUSED Workspace recovery: resource_collected\n"
          "PROBE recovery-read kind=managed-tool-result-manifest state=REFERENCED storage=MYSQL_INLINE freed=true -> REFUSED Workspace recovery: resource_collected\n"
          "PROBE negative control: 6 catalog rows set to state=VERIFIED\n"
          "PROBE recovery-read kind=managed-tool-outcome -> REFUSED Workspace recovery: resource_corrupt</pre>" +
     "<div class='note green'>The marker written by the real <code>ToolPublicationCollector.confirm()</code> matches the reader’s <code>scope(head)</code> key. "
     "The unit tests write that shape by hand; this run produces it with the production collector. "
     "It also confirms the doc change in <code>002f8eb95a</code>: before V53 a broker answers either <code>resource_layout_unsupported</code> or <code>resource_corrupt</code>.</div>")

# 05 multi / crash / upgrade ----------------------------------------------
mc = table(['Scenario (head classes, production app)', 'Result'], [
    ['E2E-2: 3 instances, 51 retired Sessions, 7,176 rows, 388 MiB, live writes during collection', OK('51/51 byte-exact') + ', 407,092,224 bytes, split 17/17/17, all done at 72 s, ER_LOCK_DEADLOCK 0, ER_LOCK_WAIT_TIMEOUT 0, live rows 93/93 intact'],
    ['E2E-3a: kill -9 inside an uncommitted page (19 rows modified, in LOCK WAIT)', 'all 41 rows PUBLISHED, 41/41 digests intact, ledger gen 1 / 0 bytes; takeover finished at ' + OK('41,944,064') + ' bytes'],
    ['E2E-3b: kill -9 right after page 1 committed (32 rows, 32,506,880 bytes)', 'takeover at gen 2 finished at ' + OK('41,944,064') + ' = 32,506,880 + 9,437,184, no double count'],
    ['Upgrade, MySQL 8.4.6: main (V52) runs with gc on for 70 s, then head starts', 'main left 3 retired Sessions PUBLISHED with bytes; head applied 1 migration (V53) and collected all 3 byte-exact ' + OK('1 s') + ' later; live Session untouched'],
    ['Upgrade, MariaDB 10.11.18: same', 'identical: V53 applied, 3 x 3,187,712 bytes collected in 1 s, live untouched'],
    ['Mixed fleet: main restarts on the V53 schema (both DBs)', '<code>Successfully validated 53 migrations</code>, boots, accepts new stream captures, answers <code>409 tool_output_session_retired</code>'],
])
page('05-multi-crash-upgrade', 'Multi-instance, crash points and the V52 to V53 upgrade',
     'Re-run on the round-3 head because the page logic changed (LIMIT 101 look-ahead, no exhaustion probe).',
     mc + "<div class='note green'>Fencing, crash atomicity, cross-instance takeover and byte-exact accounting all hold with the new page logic. The renumbered V53 upgrades a populated V52 schema on both databases.</div>")

# 06 mutation + binlog ----------------------------------------------------
mt = table(['Mutant (H2, the PR suite, 52 tests)', 'Result'], [
    ['30 round-1 mutants re-applied to the round-3 head', '22 killed. M29 is now killed; M02/M04/M08/M13/M14/M15/M26/M27 survive as in round 1'],
    ['N01 drop <code>inline_bytes IS NOT NULL</code>; N02 LIMIT 100; N03 drop <code>more = true</code> on the byte budget; N05 consume the look-ahead row', OK('killed')],
    ['N06 probe ignores state; N07 wrong scope key; N09 unexplained loss named collected', OK('killed')],
    ['N11 1 s cadence; N12 log every evaluation; N13 completion log reports last page', OK('killed')],
    ['N08 probe ignores <code>resource_id</code> (any COLLECTED object in the Session)', BAD('survives') + ' (killed by the candidate test)'],
    ['N14 probe ignores <code>scope_key</code> (same resource id in another Session)', BAD('survives') + ' (killed by the candidate test)'],
    ['N04 exactly-100 page reports another page', WARN('survives') + ': an extra empty page only (E2E-1: s7 = 1 page on head)'],
    ['N10 production constructor reads the wall clock', WARN('survives') + ': tests inject the clock; covered by the CAD A/B'],
])
bl = table(['Collecting a 40 MiB Session on MySQL 8.4.6 with its default binary log (ROW)', 'binlog bytes written'], [
    ['binlog_row_image=FULL (default)', BAD('42,066,005 (1.00 x collected bytes)')],
    ['binlog_row_image=NOBLOB', '58,423'],
    ['binlog_row_image=MINIMAL', '13,197'],
])
page('06-mutation-binlog', 'Mutation sweep 32/44, and binlog cost of the byte drop',
     'Mutation runs on macOS arm64, JDK 21, H2. Candidate test: +32 lines in SessionResourceCollectionCollectorTest; 53/53 on H2, MySQL and MariaDB.',
     mt + '<h2>Ops note (not new in this round; applies to O4-2 as well)</h2>' + bl +
     "<div class='note amber'>With MySQL’s default <code>binlog_row_image=FULL</code>, the <code>inline_bytes = NULL</code> UPDATE copies every freed BLOB into the binary log. "
     "Collection therefore writes about as many binlog bytes as it frees, and they stay on disk for <code>binlog_expire_logs_seconds</code> (30 days by default). <code>NOBLOB</code> or <code>MINIMAL</code> avoids this.</div>")
print('ok')
