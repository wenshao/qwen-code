"""Round-5 figures, generated only from ../results.json."""
import json, os, re
D = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(D, '..', 'results.json')))
CSS = open('/Users/wenshao/pr13554-rig/figs/gen.py').read().split('CSS = """')[1].split('"""')[0]
CSS += ".ctl{color:#d29922;font-weight:600}\n"
ENG = {'mysql84': 'MySQL 8.4.6', 'mariadb': 'MariaDB 10.11.18', 'h2': 'H2'}


def page(name, title, sub, body):
    open(os.path.join(D, name + '.html'), 'w').write(
        f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='card'>"
        f"<h1>{title}</h1><div class='sub'>{sub}</div>{body}</div></body></html>")


def table(head, rows):
    h = ''.join(f'<th>{c}</th>' for c in head)
    return '<table><tr>' + h + '</tr>' + ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows) + '</table>'


OK = "<span class='ok'>{}</span>".format      # the shipped behaviour the claim promises
BAD = "<span class='bad'>{}</span>".format    # the shipped code or test missing its claim
CTL = "<span class='ctl'>{}</span>".format    # a control or a hazard cell behaving as predicted


def totals(t):
    return f"{t[0]} run, {t[1]} failed, {t[2]} errors, {t[3]} skipped" if t else 'not run'


# 01: migration order ----------------------------------------------------------
mig = {(m['db'], m['cell']): m for m in data['migration_probe']}
labels = [
    ('upgrade-from-main-head', 'database at main V64, then the merged set (V65)', True),
    ('upgrade-from-main-v58-control', 'control: same bytes numbered V58 (the pre-renumber name)', False),
    ('upgrade-after-v66-lands-first', 'hazard: another open PR’s V66 lands first, then this PR’s V65', False),
    ('rollback-main-on-v65', 'rollback: main’s broker on the V65 schema', True),
]


def mig_cell(db, cell, expect_ok):
    m = mig.get((db, cell))
    if not m:
        return '<span class="dim">not run</span>'
    line = m['line']
    if cell.startswith('rollback'):
        ok = 'main-broker-migrate=OK' in line
        txt = re.search(r'main-broker-migrate=(\S+ \S+)', line).group(1) + f"; schema stays {m['maxApplied']}"
        return OK(txt) if ok else BAD(txt)
    ok = 'phase2=OK' in line
    if ok:
        txt = f"applied, schema {m['maxApplied']}, ledger table {'present' if m['ledgerTable'] == '1' else 'absent'}"
    else:
        txt = 'FlywayValidateException: ' + re.search(r'(Detected resolved migration not applied to database: \d+)', line).group(1) + f"; schema stays {m['maxApplied']}"
    return OK(txt) if ok == expect_ok and expect_ok else (CTL(txt) if ok == expect_ok else BAD(txt))


rows_a = [[lab] + [mig_cell(db, cell, exp) for db in ('mysql84', 'mariadb')] for cell, lab, exp in labels]

order = {}
for db, lines_ in data['order5'].items():
    for l in lines_:
        d = dict(re.findall(r'(\w+)=(\S+)', l))
        order[(db, d['cell'])] = d
blabels = [('u1', 'main broker (V64), then the merged broker', True),
           ('u2', 'control: main broker, then a broker carrying the bytes as V58', False),
           ('u3', 'hazard: main + V66 broker, then that tree merged with V65', False)]


def boot_cell(db, cell, expect_ok):
    d = order.get((db, cell))
    if not d:
        return '<span class="dim">not run</span>'
    if d['started'] == '1':
        txt = f"started; schema {d['schemaBefore']} → {d['schemaAfter']}; ledger table {'present' if d['ledgerTable'] == '1' else 'absent'}"
        return OK(txt) if expect_ok else BAD(txt)
    txt = f"Application run failed ({d['cause'].replace('_', ' ')}); process exited: {'yes' if d.get('processAlive') == 'no' else '?'}; schema stays {d['schemaAfter']}"
    return CTL(txt) if not expect_ok else BAD(txt)


rows_b = [[lab] + [boot_cell(db, c, exp) for db in ('mysql84', 'mariadb')] for c, lab, exp in blabels]

it = data['it']


def it_cell(tag, db, expect_red):
    r = it.get(f'{tag}-{db}')
    if not r or not r['totals']:
        return '<span class="dim">not run</span>'
    run, f, e, s = r['totals']
    green = f == '0' and e == '0'
    txt = f"{run}/{run} passed" if green else f"{f} failed, {e} errors of {run}"
    if expect_red is None:
        return OK(txt) if green else BAD(txt)
    return BAD(txt + ' — the new upgrade test cannot fail here') if green else OK(txt)


rows_c = [
    ['merged tree (V65)'] + [it_cell('it-head-mig', db, None) for db in ('mysql84', 'mariadb')],
    ['migration numbered V58 (the R12-1 shape)'] + [it_cell('mutmig-v58', db, True) for db in ('mysql84', 'mariadb')],
    ['synthetic V66 present (another PR landed first)'] + [it_cell('mutmig-v66', db, True) for db in ('mysql84', 'mariadb')],
]
page('01-migration-order', 'Migration order: V65 landed in order; the new upgrade test cannot detect the hazard it was added for',
     'Flyway 11 with the module’s defaults (no outOfOrder, no ignoreMigrationPatterns). Fresh schema per cell. '
     'Main = e9582993bf (newest migration V64); merged = PR head 957a821bc1, byte-identical under packages/sdk-java to the squash commit ca08a3d152.',
     '<h2>Flyway API on the repository’s migration files</h2>' + table(['cell', ENG['mysql84'], ENG['mariadb']], rows_a) +
     '<h2>Production broker boots on a database a previous broker already migrated</h2>' + table(['cell', ENG['mysql84'], ENG['mariadb']], rows_b) +
     '<h2>The PR’s WorkspaceMigrationMySqlIT (incl. upgradedSchemaAppliesStreamCaptureCollectionAfterPublishedHead) on mutant trees</h2>' +
     table(['tree', ENG['mysql84'], ENG['mariadb']], rows_c) +
     "<div class='note'>Green: the shipped behaviour. Amber: a control or hazard cell failing as predicted. "
     "Red: a test passing where it was claimed to fail. target(\"64\") also applies a lower-numbered file in phase 1, so the test passes for V58; "
     "a V66 is applied after V65 in phase 2 of a fresh schema, so it passes there too.</div>")

# 02: R11-1 -------------------------------------------------------------------
store = {}
for k, r in it.items():
    for l in r['results']:
        d = dict(re.findall(r'(\w+)=(\S+)', l))
        if 'case' in d:
            store[(d['arm'], d['case'])] = d
rows_s = []
for arm, lab in (('main', 'main e9582993bf'), ('r4', 'round-4 head 1caed4382a'), ('r5', 'round-5 head 957a821bc1')):
    row = [lab]
    for case in ('collectedResourceInvalidatesTheCapture', 'collectedPublicationObjectInvalidatesTheCapture'):
        d = store.get((arm, case))
        if not d:
            row.append('<span class="dim">not run</span>'); continue
        txt = f"{d['error'].replace('Workspace_recovery:_', '')} → {d['state']}, live pins {d['livePins']}"
        row.append(OK(txt) if d['state'] == 'INVALIDATED' else BAD(txt) if arm == 'r5' else CTL(txt))
    rows_s.append(row)
rows_p = []
for arm, lab in (('p5-main', 'main'), ('p5-h4', 'round-4 head'), ('p5-x5', 'round-5 head')):
    lines_ = data['pubobj'].get(f'pubobj-{arm}-mariadb', [])
    reads = [l for l in lines_ if 'after publication-object-read' in l]
    verdicts = sorted(set(re.sub(r'.*-> REFUSED Workspace recovery: ', '', l) for l in reads))
    inline = sorted(set(re.sub(r'.*-> (REFUSED Workspace recovery: )?', '', l) for l in lines_ if 'recovery-read' in l and 'freed=true' in l))
    v = ', '.join(verdicts) or 'not run'
    rows_p.append([lab, f'{len(reads)} slots', OK(v) if v == 'resource_collected' else CTL(v), ', '.join(inline)])
page('02-collected-publication-object', 'R11-1: a collected publication object now ends the capture instead of wedging it',
     'Store level (H2): the PR’s two collected-shape tests with their assertions replaced by prints, on three trees. '
     'Real shape (MariaDB): the repository’s committed foreground-capture flow, production retirement, the production O4-2 collector, then publicationObject() for every catalogued slot.',
     '<h2>WorkspaceRecoveryStore.call on a collected copy</h2>' +
     table(['tree', 'stream-capture row (state COLLECTED)', 'publication object (state COLLECTED)'], rows_s) +
     '<h2>After real O4-2 collection</h2>' +
     table(['tree', 'objects read', 'publicationObject() verdict', 'resource() on the freed inline copies'], rows_p) +
     "<div class='note'>On main neither shape is terminal: the capture stays CAPTURING with its pins, and no code path times it out. "
     "Both collectors are gated by the same tool-publication.gc-enabled flag, so F5 (no capture of a storage succeeds after collection) "
     "already exists on main as a wedge; the merged code turns it into a terminal INVALIDATED.</div>")

# 03: race ----------------------------------------------------------------------
race = data['race']


def rfind(db, scenario, isolation):
    hits = [r for r in race if r['db'] == db and r['scenario'] == scenario and r['isolation'] == isolation]
    return hits[-1] if hits else None


def rcell(db, scenario, isolation):
    r = rfind(db, scenario, isolation)
    if r is None:
        return '<span class="dim">not run</span>'
    if scenario in ('inflight', 'gap'):
        good = r['page'] == 'deferred'
        text = r['page'] + (f" after {r['pageMs']} ms" if scenario == 'inflight' else '') + f", {r['rowsWithBytes']}/3 rows keep bytes"
    elif scenario == 'collectorFirst':
        waited = int(r['registrarMs'])
        good = waited >= 2500 and r['opAfterRead'] == 'INVALIDATED'
        text = f"registration waited {waited} ms; capture {r['opAfterRead']}"
    else:
        good = r['violations'] == '0'
        text = f"{r['violations']}/{r['rounds']} violations"
    return OK(text) if good else BAD(text)


rrows = []
for iso, lab in (('REPEATABLE-READ', 'server REPEATABLE READ'), ('READ-COMMITTED', 'server READ COMMITTED')):
    for db in ('mysql84', 'mariadb'):
        rrows.append([lab if db == 'mysql84' else '', ENG[db]] + [rcell(db, s, iso) for s in ('inflight', 'gap', 'collectorFirst', 'stress')])
page('03-race-confirmation', 'The adopted fence on the merged code: confirmation run of the round-4 race probe',
     'Collector, WorkspaceRecoveryStore and ToolPublicationRetentionStore are byte-identical to the round-4 rrpin arm (SHA-256), and the two InnoDB tests are identical to the round-4 candidate. '
     'Production registration vs production claim()/collect(), fresh schema per scenario; stress = 30 rounds with random offsets.',
     table(['isolation', 'engine', 'inflight', 'gap', 'collectorFirst', 'stress'], rrows))

# 04: mutation ------------------------------------------------------------------
mut = {m['tag']: m for m in data['mutation']}
r4surv = 'M02 M04 M08 M13 M14 M15 M26 M27 M29 N04 N10 R03 R04 R06'.split()
surv = [m['id'] for m in data['mutation'] if m['tree'] == 'tree' and m['id'] != 'CONTROL' and m['totals'] and m['totals'][1] == '0' and m['totals'][2] == '0']


def mrow(tag, label):
    m = mut.get(tag)
    if not m or not m['totals']:
        return [label, 'not run', '']
    killed = m['totals'][1] != '0' or m['totals'][2] != '0'
    who = ', '.join(k.split('.', 1)[1] for k in m['killers'])
    if killed:
        return [label, OK('killed'), who]
    if tag == 'P02':
        return [label, CTL('survives (equivalent)'), 'unreachable through production writers, see note']
    if '@tree-r4tests' in tag:
        return [label, CTL('survives'), 'the round-4 fixture used SEALED']
    return [label, BAD('survives'), '']


delta = [mrow(t, f"<code>{t.split('@')[0]}</code> {mut[t]['desc'] if t in mut else ''}" + (' <span class="dim">(round-4 test file)</span>' if '@tree-r4tests' in t else '') + (' <span class="dim">(candidate test)</span>' if '@tree-cand' in t else ''))
         for t in ('P01', 'P02', 'P03', 'P04', 'P05', 'P05@tree-r4tests', 'P05@tree-cand', 'P06', 'P06@tree-r4tests', 'P06@tree-cand')]
imut = []
for mid in ('R02', 'R03', 'R04', 'R06', 'P03', 'P04'):
    row = [f"<code>{mid}</code> {mut[mid]['desc'] if mid in mut else ''}", OK('killed') if mid in mut and mid not in surv else BAD('survives')]
    for db in ('mariadb', 'mysql84'):
        r = it.get(f'imut-{mid}-{db}')
        if not r or not r['totals']:
            row.append('<span class="dim">not run</span>'); continue
        run, f, e, s = r['totals']
        row.append(OK(f'killed ({f} failed, {e} errors)') if (f != '0' or e != '0') else BAD('survives'))
    imut.append(row)
ctrl = mut.get('CONTROL', {}).get('totals')
page('04-mutation', 'Mutation sweep on the merged code',
     f"{len([m for m in data['mutation'] if m['tree'] == 'tree' and m['id'] != 'CONTROL'])} mutants of the PR’s production lines, H2, three test classes "
     f"(control: {totals(ctrl)}). Survivors now: {' '.join(surv)}. Round 4: {' '.join(r4surv)}.",
     '<h2>Mutants of this round’s changes</h2>' + table(['mutant', 'H2', 'killed by'], delta) +
     '<h2>Locking mutants on InnoDB (SessionResourceCollectionMySqlIT, the CI MariaDB lane’s class)</h2>' +
     table(['mutant', 'H2', ENG['mariadb'], ENG['mysql84']], imut) +
     "<div class='note'>P02 is equivalent in production: both quarantine writers set qwen_tool_publication.quarantined in the same transaction as the object state, "
     "and the reader refuses a quarantined publication (publication_out_of_cut) before it reaches the object state.</div>")

# 05: gates and production app ------------------------------------------------
g = data['gates']


def gl(name):
    return g.get(name, {})


g1 = gl('G1-mariadb-verify.log')
unit, its = (g1.get('totals') or [None, None])[:2] if len(g1.get('totals', [])) >= 2 else (None, None)
aa = {}
for k, r in it.items():
    m = re.match(r'aa-(hook|worktree)-(x5|main5)-(\d)-(mariadb|h2)$', k)
    if m and r['totals']:
        aa.setdefault((m.group(1), m.group(2)), []).append(r['totals'])
mac = it.get('aa-worktree-x5-macos')
aatxt = []
for (kind, arm), ts in sorted(aa.items()):
    aatxt.append(f"{kind} {arm}: " + '; '.join(f"{t[1]} failed/{t[2]} errors of {t[0]}" for t in ts))
grows = [
    ['CI MariaDB-lane command (-Pmysql-integration clean verify checkstyle:check), trial merge',
     f"unit: {totals(unit)}; integration: {totals(its)}; Checkstyle violations {'/'.join(g1.get('checkstyle', []))}; "
     f"SpotBugs BugInstance {'/'.join(g1.get('spotbugs', []))}; " + '; '.join(g1.get('tail', []))],
    ['Failing tests in that run', ', '.join(x.split('.')[-1] for x in g1.get('failing', []))],
    ['A/A of those tests (same container, merged tree vs main)', '<br>'.join(aatxt)
     + (f"<br><span class='dim'>macOS host, merged tree: the two pid-liveness tests pass (the container has no init to reap orphans); "
        f"{', '.join(x.split('.')[-1] for x in mac['failing'])} fails there instead (APFS refuses non-UTF-8 names; main's test)</span>" if mac else '')],
    ['Flyway version guard on the trial merge', '; '.join(gl('flyway-x5.txt').get('tail', []))],
]
lif = []
for arm, lab in (('it-head', 'merged: one schema per class, truncate after each test'), ('it-pertest', 'round-4 shape: new database per test'), ('it-notrunc', 'mutant: no truncation')):
    row = [lab]
    for db in ('mariadb', 'mysql84'):
        runs = [it.get(f'{arm}-seed{s}-{db}') for s in (1, 2, 3)]
        runs = [r for r in runs if r and r['totals']]
        if not runs:
            row.append('<span class="dim">not run</span>'); continue
        secs = [float(dict((c, t) for t, c in r['classElapsed']).get('SessionResourceCollectionMySqlIT', 'nan')) for r in runs]
        fails = [int(r['totals'][1]) + int(r['totals'][2]) for r in runs]
        txt = f"{len(runs)} random-order runs, failures {fails}, class time {', '.join(f'{x:.0f}' for x in secs)} s"
        row.append(OK(txt) if sum(fails) == 0 else (CTL(txt) if arm == 'it-notrunc' else BAD(txt)))
    lif.append(row)
e2e = data.get('e2e', {})
page('05-gates-and-app', 'Gates, IT lifecycle and the production app on the merged code',
     'Local: colima Linux aarch64 VM, JDK 21.0.9, Maven 3.9.11, mysql:8.4.6 / mariadb:10.11.18. The host carried other work (load average 35–90 on 10 cores).',
     table(['gate', 'result'], grows) +
     '<h2>SessionResourceCollectionMySqlIT lifecycle (001b1720d4)</h2>' + table(['arm', ENG['mariadb'], ENG['mysql84']], lif) +
     '<h2>Production app</h2>' + table(['run', 'result'], e2e.get('rows', [])))
print('pages written')
