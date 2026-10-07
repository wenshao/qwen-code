"""Round-2 panels for PR #13548 (head 8deb72ee)."""
import collections, glob, json, re, sys

V = '/root/verify/pr13548'
L = f'{V}/logs-r2'
OUT = f'{V}/shots-r2'
SGR = re.compile(r'\x1b\[[0-9;]*m')
B, D, R0 = '\x1b[1m', '\x1b[2m', '\x1b[0m'
G, RD, Y = '\x1b[32m', '\x1b[31m', '\x1b[33m'
HDR, SUB = '\x1b[1;97;44m', '\x1b[1;36m'
hosted = sys.argv[1] if len(sys.argv) > 1 else 'in progress'


def strip(s): return SGR.sub('', s)
def hdr(t): return f'{HDR} {t} {R0}'
def sub(t): return f'{SUB}▌ {t}{R0}'
def ok(t): return f'{G}{t}{R0}'
def bad(t): return f'{RD}{t}{R0}'
def color(s): return s.replace('ACCEPTED', ok('ACCEPTED')).replace('REFUSED', bad('REFUSED'))
def write(name, lines):
    import os; os.makedirs(OUT, exist_ok=True)
    open(f'{OUT}/{name}.ansi', 'w').write('\n'.join(lines) + '\n')


# ---------- r2 fig 1: round-1 findings re-run at the new head ----------
f = [hdr('Round 2 @ 8deb72ee — every round-1 probe re-run unchanged against the new head'), '']
f.append(sub('R1-1  Java Session store, channel refs whose resources were never sent (Spring + H2)'))
for l in open(f'{L}/java-store-probes-head-r2.txt'):
    if l.startswith('PROBE') and ('route,' in l or 'delivery, no' in l or 'control' in l):
        f.append('  ' + color(l.rstrip().replace('PROBE ', '').replace('managed_session_resource_missing: A referenced Managed Session resource is missing.', 'resource_missing')))
f.append('')
f.append(sub('R1-2  sparse segment plan through the real TS Session authority'))
for l in open(f'{L}/probe-authority-r2.txt'):
    s = strip(l).rstrip()
    if s.startswith(('in-memory', 'commit:', 'reopen')):
        f.append('  ' + s.replace('REFUSED', bad('REFUSED')).replace('reopen: OK, revision undefined', 'reopen: ' + ok('OK') + ' (nothing was committed)'))
f.append('')
f.append(sub('F1  the seven-step chain — validators, TS authority, Java store'))
arms = collections.OrderedDict(); cur = None
for l in open(f'{L}/chain-r2.txt'):
    l = l.rstrip()
    if l.startswith('## '): cur = l[3:]; arms[cur] = {}
    elif l: k, v = l.split('\t', 1); arms[cur][k] = v
labels = {'3-step': 'unknown', '4-step': 'partial, NO new receipt', '5-step': 'sending again', 'direct-unknown-to-sending': 'direct unknown -> sending'}
for k, lab in labels.items():
    cells = '  '.join(((ok if arms[a][k].endswith('T') else bad)('accept' if arms[a][k].endswith('T') else 'refuse') + f' {D}({a.split()[0]}){R0}') for a in arms)
    f.append(f'  validators  {lab:<27} {cells}')
for l in open(f'{L}/probe-authority-chain-r2.txt'):
    s = strip(l).rstrip()
    if s.startswith('commit ') and any(x in s for x in ('commit 4', 'commit 5', 'commit 6', 'commit 7')):
        s = s.replace('channel_delivery record delivery-1 cannot follow its revision 4.', 'cannot follow revision 4')
        f.append('  TS auth.    ' + color(s))
for arm in ('base-r2', 'head-r2'):
    for l in open(f'{L}/java-store-probes-{arm}.txt'):
        if l.startswith(('PROBE A5', 'PROBE A6', 'PROBE B ')):
            s = l.rstrip().replace('PROBE ', '').replace('managed_session_extension_record_rejected: channel_delivery record delivery-1 cannot follow its revision 4.', 'cannot follow revision 4')
            f.append(f'  Java store  {D}{arm:<8}{R0} ' + color(s))
f.append('')
f.append(sub('Corpus composition (round 1: all three true)'))
for l in open(f'{L}/compose-check.txt'):
    s = l.rstrip()
    if '==' in s or 'identical' in s:
        f.append('  ' + s.replace(': false', ': ' + ok('false')).replace(': true', ': true'))
write('r2-fig1-findings', f)

# ---------- r2 fig 2: gates, differential, CI ----------
f = [hdr('Round 2 @ 8deb72ee — gates, differential, CI'), '']
f.append(sub('Suites (Linux x86_64, JDK 21.0.10, Node 22.22.2)'))
for line in open(f'{L}/g1-ts-head.ansi'):
    s = strip(line).rstrip()
    if s.startswith(' ✓') or 'Tests ' in s: f.append('  ' + line.rstrip())
f.append('  Java gate classes (9): ' + ok(open(f'{L}/java-gates-head.txt').read().split()[0]) + f'   ManagedExtensionRecordStoreTest {ok("26/26")} (verifiesTheChannelResourceClosure discovered)')
full = [strip(l).strip() for l in open(f'{L}/java-full-head.log') if re.search(r'Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$', strip(l).strip())][-1]
f.append('  managed-agent-server full module: ' + ok(full.replace('[INFO] ', '')) + '  BUILD SUCCESS')
for arm, lab in (('base-r2', 'main 1aba19c8'), ('head-r2', 'PR   8deb72ee')):
    r = json.load(open(f'{L}/mr-full-{arm}.json'))
    f.append(f'  src/managed-runtime {lab}: {len(r["testResults"])} files  ' + ok(f'{r["numPassedTests"]}/{r["numTotalTests"]}'))
f.append('')
f.append(sub('TS vs Java differential on the new corpus (92 shape / 57 successor seeds)'))
total = 0; div = 0
for d in sorted(glob.glob(f'{V}/diff-r2/*/diff-*.txt')):
    div += sum(1 for l in open(d) if l.startswith('<'))
for h in glob.glob(f'{V}/diff-r2/big/hist-*.txt'):
    total += sum(int(l.split()[0]) for l in open(h))
total += sum(1 for _ in open(f'{V}/diff-r2/keep/ts-101.txt'))
f.append(f'  {total:,} inputs, divergences {ok(str(div))}; anchors 149/149 match the fixtures on both sides;')
f.append('  coverage: 11/11 accepted (line, run) combinations, 18/18 accepted line steps (unknown->partial only with a new receipt)')
f.append('')
f.append(sub('CI on 8deb72ee (managed-agent-server runs only in the two DB lanes)'))
f.append('  Runtime Broker and Managed Agent MariaDB / Java 21   ' + ok('success') + '  07:48Z -> 07:58Z')
f.append('    managed-agent-server 1258/0/0, MySQL IT 53/53, RecordStore 26/26, ChannelRecordContract 2/2, SessionStoreIntegration 5/5,')
f.append('    no log line over 100k chars')
f.append('  Hosted process fault gates / MySQL 8.4 / Java 21     ' + (ok(hosted) if hosted.startswith('success') else Y + hosted + R0))
write('r2-fig2-gates', f)

# ---------- r2 fig 3: mutants ----------
rows = {}
r1 = {}
for lang in ('ts', 'java'):
    for l in open(f'{L}/mutants-{lang}.jsonl'):
        r = json.loads(l); rows[r['id']] = r
    for l in open(f'{V}/logs/mutants-{lang}.jsonl'):
        r = json.loads(l); r1[r['id']] = r
f = [hdr('Round 2 mutation sweep — same 124 mutants + 9 new ones, PR suites and 300k-input differential'), '']
f.append(f'  {B}{"id":<4}{"rule removed":<52}{"round 1":<16}{"round 2 TS":<17}{"round 2 Java":<14}{R0}')
def st(r):
    if r is None: return f'{D}{"—":<17}{R0}'
    return ok(f'{"killed":<17}') if r.get('failed', 0) > 0 else (f'{D}{"equivalent":<17}{R0}' if r['id'][1:] in ('17', '31', '49', '50', '51') else bad(f'{"LIVE (fuzz " + str(r.get("fuzz_diffs")) + ")":<17}'))
show = ['04', '07', '08', '18', '26', '27', '29', '33', '52', '53', '54', '55']
for i in show:
    was = r1.get('T' + i)
    wasx = 'LIVE' if was and was.get('failed', 0) == 0 else 'killed'
    f.append(f'  {i:<4}{rows["T" + i]["desc"][:50]:<52}{(bad if wasx == "LIVE" else ok)(f"{wasx:<16}")}{st(rows.get("T" + i))}{st(rows.get("J" + i))}')
f.append(f'  {D}... 41 further rule mutants: killed in both rounds, both languages; 5 equivalent (17 31 49 50 51) unchanged;{R0}')
f.append(f'  {D}    authority A1-A4, projection P1-P3 (TS) and the comparator revert S0 (Java): killed again{R0}')
for i in ('59', '60', '61'):
    f.append(f'  {i:<4}{rows["T" + i]["desc"][:50]:<52}{D}{"new":<16}{R0}{st(rows.get("T" + i))}{st(rows.get("J" + i))}')
for i in ('C1', 'C2', 'C3', 'C4'):
    f.append(f'  {i:<4}{rows["J" + i]["desc"][:50]:<52}{D}{"new":<16}{R0}{D}{"—":<17}{R0}{st(rows.get("J" + i))}')
tk = sum(1 for k, r in rows.items() if k.startswith('T') and k != 'T000' and r.get('failed', 0) > 0); tn = sum(1 for k in rows if k.startswith('T') and k != 'T000')
jk = sum(1 for k, r in rows.items() if k.startswith('J') and k != 'J000' and r.get('failed', 0) > 0); jn = sum(1 for k in rows if k.startswith('J') and k != 'J000')
f.append(f'  {B}TS {tk}/{tn} killed (round 1: 48/65), Java {jk}/{jn} (round 1: 42/59); controls TS 331/331, Java 36/36, 0 fuzz diffs{R0}')
f.append('')
f.append(sub('Mutant 53: why it still survives (executed on 8deb72ee)'))
for l in open(f'{L}/m53-demo.txt'):
    s = l.rstrip().replace('ACCEPTED', bad('ACCEPTED'))
    f.append('  ' + s)
write('r2-fig3-mutants', f)
print('r2 panels written')
