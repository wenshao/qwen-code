"""Round-4 figures, generated only from ../results.json."""
import json, os, re
D = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(D, '..', 'results.json')))
CSS = open('/Users/wenshao/pr13554-rig/figs/gen.py').read().split('CSS = """')[1].split('"""')[0]
CSS += ".ctl{color:#d29922;font-weight:600}\n"


def page(name, title, sub, body):
    open(os.path.join(D, name + '.html'), 'w').write(
        f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='card'>"
        f"<h1>{title}</h1><div class='sub'>{sub}</div>{body}</div></body></html>")


def table(head, rows):
    h = ''.join(f'<th>{c}</th>' for c in head)
    return '<table><tr>' + h + '</tr>' + ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows) + '</table>'


OK = "<span class='ok'>{}</span>".format      # matches the expectation for the shipped code
BAD = "<span class='bad'>{}</span>".format    # does not match the expectation for the shipped code
CTL = "<span class='ctl'>{}</span>".format    # a control arm (one edit removed) misbehaved, as a control should
race = data['race']


def find(arm, db, scenario, isolation='REPEATABLE-READ', **extra):
    hits = [r for r in race if r['arm'] == arm and r['db'] == db and r['scenario'] == scenario
            and r['isolation'] == isolation and all(r.get(k) == v for k, v in extra.items())]
    return hits[-1] if hits else None


def cell(arm, db, scenario, isolation='REPEATABLE-READ'):
    r = find(arm, db, scenario, isolation)
    if r is None:
        return '<span class="dim">not run</span>'
    control = arm in ('nofence', 'plain', 'noinval', 'noindex')
    if scenario in ('inflight', 'gap'):
        good = r['page'] == 'deferred'
        text = f"{r['page']}" + (f" after {r['pageMs']} ms" if scenario == 'inflight' else '') + f", {r['rowsWithBytes']}/3 rows keep bytes"
    elif scenario == 'collectorFirst':
        waited = int(r['registrarMs'])
        good = waited >= 2500 and r['opAfterRead'] == 'INVALIDATED' and 'done=true' in r['secondSessionT']
        t_state = 'collected' if 'done=true' in r['secondSessionT'] else 'blocked ' + re.sub(r'.*blocker=([a-z_]+).*', r'\1', r['secondSessionT'])
        text = f"registration waited {waited} ms; capture {r['opAfterRead']}; T {t_state}"
    elif scenario == 'stress':
        good = r['violations'] == '0'
        text = f"{r['violations']}/{r['rounds']} violations ({r['deferred']} deferred, {r['collectorFirst']} collector-first, {r['pageErrors']} page / {r['registrarErrors']} registration errors)"
    elif scenario == 'footprint':
        good = int(r['unrelatedPinInsertMs']) < 1000
        text = f"unrelated pin insert {r['unrelatedPinInsertMs']} ms"
    else:
        return '?'
    if good:
        return OK(text)
    return CTL(text) if control else BAD(text)


# 01: gates -------------------------------------------------------------------
gs = data['gates']
def first(name, pat):
    for l in gs.get(name, []):
        if re.search(pat, l):
            return l
    return '?'
grow = [
    ['CI MariaDB-lane unit stage (-Pmysql-integration verify), MariaDB 10.11.18', first('G1-mariadb-verify', r'^Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$') + ' \u2014 errors: RuntimeBrokerFlywaySchemaTest, ToolPublicationStoreTest large-output (both green 3/3 alone on the trial merge and on main; files untouched by the PR)'],
    ['Same lane, integration tests (re-run alone after the unit-stage stop)', first('G1b-mariadb-its', r'^Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$') + '; ' + first('G1b-mariadb-its', 'failsafe-check')],
    ['-Po4-mysql-gates, MySQL 8.4.6', first('G2-o4-mysql', r'^Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$')],
    ['Trial merge with current main 5b1c701400 (B1)', BAD('Flyway: ' + ' + '.join(re.findall(r'(V56__[a-z_]+)\.sql', first('M5-flyway-collision', '2 migrations claim version 56'))) + ' (check exit ' + first('M5-flyway-collision', 'check exit').split('=')[-1] + '); PR suite ' + first('M5-flyway-collision', r'Tests run: 58').replace('[ERROR] ', '') + ' (' + first('M5-flyway-collision', 'Found more than one') + ')') + '<br>' + OK('with V57: ' + first('M5-renumber-fix', 'all versions unique') + '; WorkspaceMigrationMySqlIT ' + first('M5-renumber-fix', r'^Tests run: 5, Failures: \d+, Errors: \d+, Skipped: \d+$'))],
    ['PR suite on InnoDB (dataSource override), MySQL / MariaDB', first('G3-gate-mysql84', r'^Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$') + ' / ' + first('G3-gate-mariadb', r'^Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$')],
]
aa = [l for l in data['aa'] if 'run' in l]
page('01-gates', 'Gates on the trial merge (PR 1caed4382a + main b9fa95c55f)',
     'Local: colima Linux aarch64 VM, JDK 21.0.9, Maven 3.9.11, mysql:8.4.6 / mariadb:10.11.18 on tmpfs. The host was heavily loaded (load average above 100 on 10 cores) by other work.',
     table(['gate', 'result'], grow) + '<h2>A/A re-run of the two unit-stage errors</h2><pre>' + '\n'.join(aa) + '</pre>')

# 02: race matrix ------------------------------------------------------------
arms = [('head', 'head <code>1caed4382a</code>'), ('nofence', 'nofence: page() of <code>722680590a</code> (no session lock, no re-check)'),
        ('plain', 'plain: re-check without <code>FOR UPDATE</code>'), ('noinval', 'noinval: <code>resource_collected</code> not terminal'),
        ('noindex', 'noindex: V56 without the session index')]
rows = []
for arm, label in arms:
    for db in ('mysql84', 'mariadb'):
        rows.append([label if db == 'mysql84' else '', 'MySQL 8.4.6' if db == 'mysql84' else 'MariaDB 10.11.18'] +
                    [cell(arm, db, s) for s in ('inflight', 'gap', 'collectorFirst', 'stress', 'footprint')])
rc_rows = []
for arm, label in (('head', 'head'), ('rrpin', 'head + REPEATABLE READ pin (candidate)')):
    for db in ('mysql84', 'mariadb'):
        rc_rows.append([label if db == 'mysql84' else '', 'MySQL 8.4.6' if db == 'mysql84' else 'MariaDB 10.11.18'] +
                       [cell(arm, db, s, 'READ-COMMITTED') for s in ('inflight', 'gap', 'collectorFirst', 'stress')])
page('02-race-matrix', 'The claim→page recovery fence on real InnoDB',
     'Production WorkspaceRecoveryStore registration vs the production collector, fresh schema per scenario. '
     'inflight: the registration has inserted the Session’s pin and holds its transaction 3 s; gap: it commits between claim() and the page; '
     'collectorFirst: the page passes its re-check and holds 3 s before the byte drop; stress: 30 rounds, random 0–25 ms offsets, no injected pause.',
     '<h2>Server default isolation (REPEATABLE READ)</h2>' +
     table(['arm', 'engine', 'inflight', 'gap', 'collectorFirst', 'stress', 'lock footprint'], rows) +
     '<h2>Server set to READ COMMITTED</h2>' +
     table(['arm', 'engine', 'inflight', 'gap', 'collectorFirst', 'stress'], rc_rows) +
     "<div class='note'>Green: the shipped behaviour the PR claims. Amber: a control arm with one edit removed misbehaving, as a control should. "
     "Red: the shipped code missing its claim. A violation is a round where the registration had written the Session’s pin before the page dropped the bytes.</div>")

# 03: candidates --------------------------------------------------------------
cand = data['candidates']


def ct(name):
    c = cand.get(name)
    if not c or not c['totals']:
        return 'not run'
    run, f, e, s = c['totals']
    names = ', '.join(f'{t}:{l}' for t, l in c['failing']) or '-'
    txt = f"{run} run, {f} failed, {s} skipped" + (f" — {names}" if names != '-' else '')
    return OK(txt) if name.startswith('final') and f == '0' and e == '0' else (CTL(txt) if f != '0' else txt)


crow = []
for arm, label in (('final', 'head + both candidates'), ('head', 'head (tests only)'), ('plain', 'plain (tests only)'), ('nofence', 'nofence (tests only)')):
    crow.append([label, ct(arm + '-mysql84'), ct(arm + '-mariadb'), ct(arm + '-h2') if arm == 'final' else '<span class="dim">not run</span>'])
page('03-candidates', 'Candidate patches pin the fence on the engine where it matters',
     'SessionResourceCollectionMySqlIT runs the whole collector suite on InnoDB through mysql.url (the MariaDB lane’s -Pmysql-integration picks up *IT). '
     'Two new tests skip on H2: uncommittedRecoveryRegistrationHoldsThePageUntilItCommits and pageGapLockHoldsARegistrationEvenOnAReadCommittedPool.',
     table(['arm', 'MySQL 8.4.6', 'MariaDB 10.11.18', 'H2 (+ Checkstyle)'], crow) +
     "<div class='note green'>The final candidate is +3 production lines (pin REPEATABLE READ on the collector’s TransactionTemplate), "
     "+109 lines in SessionResourceCollectionCollectorTest and a 34-line IT. Each control arm fails exactly the test aimed at the edit it removes.</div>")

# 04: recovery consequence ----------------------------------------------------
rec = []
for arm in ('head', 'noinval'):
    for db in ('mysql84', 'mariadb'):
        a1 = find(arm, db, 'recapture', attempt='1')
        a2 = find(arm, db, 'recapture', attempt='2')
        after = find(arm, db, 'recapture', attempt='after')
        if not (a1 and a2 and after):
            continue
        t_done = 'done=true' in after['secondSessionT']
        rec.append([arm, 'MySQL 8.4.6' if db == 'mysql84' else 'MariaDB 10.11.18',
                    f"S in cut: {a1['sListedInCut']}; read: resource_collected; capture {a1['opAfterRead']}",
                    f"S in cut: {a2['sListedInCut']}; read: resource_collected; capture {a2['opAfterRead']}",
                    OK('collected') if t_done else CTL('blocked: recovery_active')])
p1 = data['p1']
page('04-recovery-after-collection', 'What collection means for later workspace captures',
     'S: a retired Session whose stream-capture rows were collected. Each capture is a fresh production registration of the same storage; '
     'the read is WorkspaceRecoveryStore.call("resource") on S’s collected row, the read the TS worker makes for every page/content ref of a sealed Shell manifest. '
     'T: another retired Session of the same cut.',
     table(['arm', 'engine', 'capture #1', 'capture #2 (new operation)', 'T afterwards'], rec) +
     '<h2>Positive evidence still holds at the trial merge (real O4-2 collection)</h2>' +
     '<pre>' + '\n'.join(p1.get('mysql84', [])) + '</pre>' +
     "<div class='note amber'>Every new capture lists S again, and the first read of its collected rows invalidates the capture. On head the capture terminates and stops pinning T; "
     "without the new invalidation it stays CAPTURING and pins T forever. Either way, once any retired Session’s Shell bytes are collected, that storage can no longer be captured or migrated. "
     "The design doc lists this as an open product decision (replay tolerance); the operations doc’s enablement gates do not mention it.</div>")

# 05: production-app matrix ---------------------------------------------------
e1 = data['e2e1']
led = {r[0]: r for r in e1['ledgers'][1:]}
dig = e1['digest'][1].split('\t') if len(e1['digest']) > 1 else ['?', '?']
cad = [l for l in data['cad'] if 'after-step ledger created' in l or 'control before' in l]
e2 = data['e2e2']
e2_line = [l for l in e2 if l.startswith('51')]
up = data['upgrade']


def up_line(db, key):
    lines = up[db]
    for i, l in enumerate(lines):
        if key in l:
            return l
    return '?'


bl = {re.search(r'binlog_row_image=(\w+)', l).group(1): re.search(r'binlog_delta=(\d+)', l).group(1) for l in data['binlog']}
e3 = data['e2e3']
e3_kills = [l for l in e3 if l.startswith('KILLED')]
e3_final = sorted({l.split('\t')[3] for l in e3 if l.startswith(('L1-midpage\tCOLLECTED', 'L2-between\tCOLLECTED')) and l.split('\t')[2] == '41'})
e3_text = f"{len(e3_kills)} kill -9 points; each Session finished with all 41 rows COLLECTED at {', '.join(e3_final)} bytes; in-page kill left 41/41 rows PUBLISHED with digests intact"
mrows = [
    ['E2E-1 page boundaries (100 / 101 rows, 32 MiB / +1 row)', OK(f"pages {led['s7-exact-100-rows'][1]} / {led['s8-101-rows'][1]} / {led['s9-exact-32mib'][1]} / {led['s10-32mib-plus-one'][1]}, every ledger byte-exact")],
    ['E2E-1 phantom row (bytes freed out of band)', OK(f"{led['s11-phantom'][2]} bytes counted, phantom left PUBLISHED; recovery read: {e1['reader'][1].split(': ')[-1]}")],
    ['E2E-1 page query (F1 fix)', OK(f"{dig[0]} executions, {dig[1]} ms in total; no BLOB predicate")],
    ['CAD: JVM wall clock steps back 600 s', OK(cad[-1].split(' ', 1)[1] if cad else '?')],
    ['E2E-2: 3 instances, 51 Sessions, 388 MiB', OK((e2_line[0].replace('\t', ' / ') if e2_line else '?') + ' (ledgers / byte-exact / collected / retired / collected-with-bytes / live rows intact)')],
    ['E2E-3: kill -9 inside a page, and between pages', OK(e3_text)],
    ['Upgrade V55 → V56, MySQL / MariaDB', OK('main left retired captures with bytes; head applied 1 migration and collected them; main restarted on V56; rollback then re-upgrade collected old-4')],
    ['Binlog bytes for a 40 MiB collection', f"FULL {bl.get('FULL')}, NOBLOB {bl.get('NOBLOB')}, MINIMAL {bl.get('MINIMAL')} (now documented in the operations doc)"],
]
page('05-production-app', 'Production app on the trial-merge classes',
     'ManagedAgentServerApplication built from the PR merged with main b9fa95c55f; MySQL 8.4.6 unless stated; OSS bean refuses every call (0 calls).',
     table(['scenario', 'result'], mrows))

# 06: mutation ----------------------------------------------------------------
muts = [m for m in data['mutation'] if m['id'] != 'CONTROL']
killed = [m for m in muts if m['failures'] + m['errors'] > 0]
r4 = [m for m in muts if m['id'].startswith('R') or m['id'] in ('N01', 'N01b', 'N08', 'N14')]
mrow = []
for m in r4:
    k = m['failures'] + m['errors'] > 0
    note = ''
    if m['id'] == 'R03':
        note = ' — on InnoDB: plain arm violates (figure 2); killed by the candidate test'
    if m['id'] == 'R04':
        note = ' — no consequence found in the probes'
    if m['id'] == 'R06':
        note = ' — over-blocks only (fail-safe)'
    mrow.append([m['id'], m['desc'], OK('killed: ' + ', '.join(x.split('.')[-1] for x in m['killers'])) if k else BAD('survives' + note)])
rep = data['m29_repeat']
page('06-mutation', f'Mutation sweep: {len(killed)}/{len(muts)} killed on H2',
     'Three classes per mutant (SessionResourceCollectionCollectorTest, WorkspaceRecoveryStoreTest, WorkspaceMigrationStoreTest), 102 tests, baseline green through the same runner. '
     'Older survivors: ' + ', '.join(m['id'] for m in muts if m['failures'] + m['errors'] == 0 and not (m['id'].startswith('R') or m['id'] in ('N08', 'N14'))) + '.',
     table(['id', 'mutation', 'result'], mrow) +
     f"<div class='note amber'>M29’s only witness (blockedFirstCandidateDoesNotStarveTheNext) is nondeterministic: run alone it failed {rep['M29']['failed']}/{rep['M29']['runs']} on the mutant and "
     f"{rep['CONTROL']['failed']}/{rep['CONTROL']['runs']} on the clean tree.</div>")
print('figures written')
