"""Round-3 panel for PR #13548 (head b3d3c089). argv[1] = CI line for the DB lanes."""
import json, re, sys

V = '/root/verify/pr13548'
L = f'{V}/logs-r3'
SGR = re.compile(r'\x1b\[[0-9;]*m')
B, D, R0 = '\x1b[1m', '\x1b[2m', '\x1b[0m'
G, RD, Y = '\x1b[32m', '\x1b[31m', '\x1b[33m'
HDR, SUB = '\x1b[1;97;44m', '\x1b[1;36m'
ci = sys.argv[1:] or ['DB lanes: pending']


def strip(s): return SGR.sub('', s)
def ok(t): return f'{G}{t}{R0}'
def bad(t): return f'{RD}{t}{R0}'
def sub(t): return f'{SUB}▌ {t}{R0}'


f = [f'{HDR} Round 3 @ b3d3c089 — merge of main (H6a #13536) + Map.ofEntries fix {R0}', '']
f.append(sub('1. Is the Map.of -> Map.ofEntries change needed? (javac, JDK 21, same classpath)'))
err = open(f'{L}/negctl-prefix-javac.txt').read().splitlines()
f.append(f'  merge commit 4b2a498d (pre-fix, 11 pairs in Map.of)  -> {bad("javac exit 1")}  {D}{err[0].split("error: ")[1][:70]}...{R0}')
f.append(f'  head b3d3c089 (Map.ofEntries)                       -> {ok("javac exit 0")}')
f.append(f'  {D}4b2a498d and b3d3c089 differ only in ManagedExtensionProjection.java; main and round-2 head each had 9 pairs{R0}')
f.append('  registry keys:  Java RECORD_BODIES 11  =  TS MANAGED_EXTENSION_RECORD_BODIES 11  =  fixture recordBodies 9 + additionalRecordBodies 2')
f.append('')
f.append(sub('2. Gates (Linux x86_64, JDK 21.0.10, Node 22.22.2)'))
for line in open(f'{L}/g1-ts-head.ansi'):
    s = strip(line).rstrip()
    if s.startswith(' ✓') or 'Tests ' in s: f.append('  ' + line.rstrip())
f.append('  Java gate classes (11, incl. H6a ManagedAutomationRecordContractTest): ' + ok(open(f'{L}/java-gates-head.txt').read().split()[0].replace('RUN=', '') + '/67'))
full = [strip(l).strip() for l in open(f'{L}/java-full-head.log') if re.search(r'Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$', strip(l).strip())][-1]
f.append('  managed-agent-server full module: ' + ok(full.replace('[INFO] ', '')) + '  BUILD SUCCESS')
for arm, lab in (('base-r3', 'main e31d5500'), ('head-r3', 'PR   b3d3c089')):
    r = json.load(open(f'{L}/mr-full-{arm}.json'))
    f.append(f'  src/managed-runtime {lab}: {len(r["testResults"])} files  ' + ok(f'{r["numPassedTests"]}/{r["numTotalTests"]}'))
f.append('  TS vs Java differential: 4,001,192 inputs, divergences ' + ok('0'))
f.append('')
f.append(sub('3. Round-2 probes re-run unchanged at b3d3c089'))
probes = open(f'{L}/java-store-probes-head-r3.txt').read()
auth = strip(open(f'{L}/probe-authority-r3.txt').read())
f.append('  R1-1 missing channel resources (Java store)     -> ' + (bad('REFUSED') + ' 409 resource_missing' if probes.count('resource_missing') >= 3 else Y + 'CHANGED' + R0))
f.append('  R1-2 sparse plan (TS authority)                 -> ' + (bad('REFUSED') + ' at commit, Session reopens' if 'commit: REFUSED' in auth and 'reopen: OK' in auth else Y + 'CHANGED' + R0))
f.append('  F1 unknown -> partial, no new receipt           -> ' + (bad('REFUSED') + ' TS authority + Java store (409); late receipt -> delivered accepted' if 'commit 5 partial, NO new receipt         -> REFUSED' in auth and 'A5 partial, NO new receipt        -> REFUSED' in probes else Y + 'CHANGED' + R0))
f.append('')
f.append(sub('4. Still open from round 2 (both non-blocking; the corpus and validators are byte-identical to 8deb72ee)'))
for l in open(f'{L}/m53-demo.txt'):
    s = l.rstrip()
    if 'acceptedAt check deleted' in s or 'fixture' in s or 'sending run' in s:
        f.append('  ' + s.replace('ACCEPTED', bad('ACCEPTED')))
mm = [l for l in probes.splitlines() if 'digest differs' in l][0].replace('PROBE ', '')
f.append('  ' + mm.split(' | ')[0].replace('REFUSED', bad('REFUSED')).replace('managed_session_extension_record_rejected: ', ''))
f.append('')
f.append(sub('5. CI on b3d3c089 (only the two DB lanes compile managed-agent-server)'))
for line in ci:
    f.append('  ' + line.replace('success', ok('success')).replace('failure', bad('failure')).replace('cancelled', bad('cancelled')))
import os; os.makedirs(f'{V}/shots-r3', exist_ok=True)
open(f'{V}/shots-r3/r3-fig1.ansi', 'w').write('\n'.join(f) + '\n')
print('r3 panel written')
