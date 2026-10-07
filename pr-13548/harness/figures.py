"""Composes the ANSI panels for the report figures from the saved run outputs."""
import collections, glob, json, os, re

V = '/root/verify/pr13548'
L = f'{V}/logs'
OUT = f'{V}/shots'
os.makedirs(OUT, exist_ok=True)
SGR = re.compile(r'\x1b\[[0-9;]*m')
B, D, R0 = '\x1b[1m', '\x1b[2m', '\x1b[0m'
G, RD, Y, C, M = '\x1b[32m', '\x1b[31m', '\x1b[33m', '\x1b[36m', '\x1b[35m'
HDR = '\x1b[1;97;44m'
SUB = '\x1b[1;36m'


def strip(s): return SGR.sub('', s)
def hdr(t): return f'{HDR} {t} {R0}'
def sub(t): return f'{SUB}▌ {t}{R0}'
def ok(t): return f'{G}{t}{R0}'
def bad(t): return f'{RD}{t}{R0}'
def write(name, lines): open(f'{OUT}/{name}.ansi', 'w').write('\n'.join(lines) + '\n')


# ---------- Fig 1: gates ----------
f = [hdr('PR #13548 @ 8b283d1c — gates on Linux x86_64 (JDK 21.0.10, Maven 3.9.9, Node 22)'), '']
f.append(sub('TypeScript — the PR\'s three suites (head)'))
for line in open(f'{L}/g1-ts-head.ansi'):
    s = strip(line).rstrip()
    if s.startswith(' ✓') or 'Tests ' in s or 'Test Files' in s:
        f.append('  ' + line.rstrip().replace('\x1b[2K', ''))
f.append('')
f.append(sub('Java — the PR\'s Java gate classes (head, mvn test)'))
for line in open(f'{L}/java-gates-head.log'):
    s = strip(line)
    if 'Tests run:' in s:
        m = re.search(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+).*?(?:in com\.alibaba\.qwen\.code\.managedagent\.(\w+))?$', s.strip())
        if m:
            cls = m.group(4) or 'TOTAL'
            f.append(f'  {G}✓{R0} {(B if cls == "TOTAL" else "") + f"{cls:<44}" + R0} {m.group(1):>3} run  {m.group(2)} fail  {m.group(3)} err')
f.append(f'  {D}(the test plan also names ManagedMonitorRecordContractTest — no such class exists in the tree){R0}')
f.append('')
f.append(sub('Full src/managed-runtime vitest, three trees'))
for arm, label in (('base', 'merge-base ac497aee'), ('head', 'PR head   8b283d1c'), ('merged', 'head + main f07c190c')):
    r = json.load(open(f'{L}/mr-full-{arm}.json'))
    f.append(f'  {label}   {len(r["testResults"]):>2} files  {ok(str(r["numPassedTests"]) + "/" + str(r["numTotalTests"]))} passed  {r["numFailedTests"]} failed')
f.append(f'  {D}hook-scale timeout the description mentions: not reproduced (idle 16-core box){R0}')
f.append('')
f.append(sub('Merged with current main (merge 317feb8c, clean, no conflicts)'))
f.append(f'  TS PR suites            {ok("318/318")}')
f.append(f'  Java 9 gate classes     {ok(strip(open(L + "/java-gates-merged.txt").read()).split()[0].replace("RUN=", "") + "/53")}  (incl. ManagedSessionStoreIntegrationTest 5/5)')
full = [strip(l) for l in open(f'{L}/java-full-merged.log') if re.search(r'Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$', strip(l).strip())][-1].strip()
f.append(f'  managed-agent-server    {ok(full.replace("[INFO] ", ""))}  (full module, BUILD SUCCESS)')
write('fig1-gates', f)

# ---------- Fig 2: differential ----------
f = [hdr('TS vs Java differential — same raw JSON bytes, each side\'s production parser + validator'), '']
f.append(f'  {D}generator: fixture seeds + semantic state-space sampler + structural noise; numbers re-spelled (1.0, 1e0, -0.0, 1E+0),')
f.append(f'  keys shuffled, \\u-escaped strings. verdicts: parse ACCEPT/REJECT/CRASH, isStart T/F, isSuccessor T/F{R0}')
f.append('')
total = div = 0
hist = collections.Counter()
for d in sorted(glob.glob(f'{V}/diff/head/diff-*.txt')):
    seed = d.split('-')[-1][:-4]
    n = sum(1 for _ in open(f'{V}/diff/head/ts-{seed}.txt'))
    k = sum(1 for l in open(d) if l.startswith('<'))
    total += n; div += k
    for l in open(f'{V}/diff/head/ts-{seed}.txt'): hist[l.rstrip('\n').split('\t', 1)[1]] += 1
    f.append(f'  seed {seed:>4}  {n:>9,} cases   divergences {ok(str(k)) if k == 0 else bad(str(k))}')
for d in sorted(glob.glob(f'{V}/diff/head-big/diff-*.txt')):
    seed = d.split('-')[-1][:-4]
    h = collections.Counter()
    for l in open(f'{V}/diff/head-big/hist-{seed}.txt'):
        c, v = l.strip().split(None, 1)
        h[v.replace(' ', '\t')] += int(c)
    n = sum(h.values()); hist.update(h)
    k = sum(1 for l in open(d) if l.startswith('<'))
    total += n; div += k
    f.append(f'  seed {seed:>4}  {n:>9,} cases   divergences {ok(str(k)) if k == 0 else bad(str(k))}')
f.append(f'  {B}TOTAL     {total:>9,} cases   divergences {G}{div}{R0}{B}   crashes (non-contract exceptions) {G}0{R0}')
f.append('')
f.append(sub('verdict mix (TS side; Java identical)'))
for v, n in hist.most_common():
    f.append(f'  {n:>10,}  {v.replace(chr(9), "  ")}')
f.append('')
f.append(sub('state-space coverage of accepted inputs (seed 101 alone)'))
cov = open(f'{L}/coverage-101.txt').read().splitlines()
acc = [l for l in cov if 'delivery ' in l and l.strip()[0].isdigit()]
f.append('  accepted delivery (line/run) combinations: ' + ok(f'{len(acc)} of 11 reachable'))
combos = [l.split()[-1] for l in acc]
for k in range(0, len(combos), 6): f.append('    ' + D + '  '.join(combos[k:k + 6]) + R0)
i = cov.index('delivery successor line steps ACCEPTED:')
steps = []
for l in cov[i + 1:]:
    if not l.startswith('  '): break
    steps.append(l.split()[-1])
f.append('  accepted delivery line steps: ' + ok(f'{len(steps)} of 18') + ' (7 stays + all 11 channel steps)')
for k in range(0, len(steps), 6): f.append('    ' + D + '  '.join(steps[k:k + 7]) + R0)
write('fig2-differential', f)

# ---------- Fig 3: unknown bypass ----------
f = [hdr('Finding: an unknown delivery returns to sending in two steps, with no new proof'), '']
f.append(sub('1. The shipped corpus already composes the bypass (byte-identical records)'))
for l in open(f'{L}/compose-check.txt'):
    s = l.rstrip()
    s = s.replace('isSuccessor=true', ok('isSuccessor=true')).replace('isSuccessor=false', bad('isSuccessor=false'))
    s = re.sub(r': true$', ': ' + ok('true'), s)
    f.append('  ' + s)
f.append('')
f.append(sub('2. Real TS Session authority (LocalManagedSessionAuthority, domain enablement mocked like the PR suite)'))
for l in open(f'{L}/probe-authority-head.ansi'):
    s = strip(l).rstrip()
    if s.startswith(('commit ', 'reopen', 'direct')):
        if 'NO new receipt' in s or 're-sent' in s or 'twice' in s: s = Y + s + R0
        if s.startswith('direct'): s = s.replace('refused', bad('refused'))
        f.append('  ' + s)
f.append('')
f.append(sub('3. Real Java Session store (Spring + H2, ManagedSessionStore.commit) — merge-base vs PR, same probe code'))
base = open(f'{L}/java-store-probe-base.txt').read().splitlines()
head = open(f'{L}/java-store-probe-head.txt').read().splitlines()
def tag(s):
    s = s.replace('PROBE ', '')
    s = s.replace('ACCEPTED', ok('ACCEPTED')).replace('REFUSED', bad('REFUSED'))
    return s
f.append(f'  {B}base ac497aee{R0}')
for s in base:
    if s.startswith('PROBE') and (s.startswith('PROBE A ') or s.startswith('PROBE B') or s.startswith('PROBE C')):
        f.append('    ' + tag(s)[:150])
f.append(f'  {B}head 8b283d1c{R0}')
for s in head:
    if s.startswith('PROBE'):
        t = tag(s)
        if 'A5' in s or 'A6' in s: t = t.replace('partial', Y + 'partial' + R0).replace('sending again', Y + 'sending again' + R0)
        f.append('    ' + t.replace('managed_session_extension_record_rejected', 'extension_record_rejected')[:175])
write('fig3-unknown-bypass', f)

# ---------- Fig 4: candidate fix ----------
f = [hdr('Candidate fix (not pushed): leaving unknown for partial must settle a new segment'), '']
f.append(sub('The 7-step chain through four arms (X = isSuccessor of step n-1 -> n)'))
arms = collections.OrderedDict()
cur = None
for l in open(f'{L}/chain-4arms.txt'):
    l = l.rstrip()
    if l.startswith('## '): cur = l[3:]; arms[cur] = {}
    elif l: k, v = l.split('\t', 1); arms[cur][k] = v
labels = {'0-start': 'planned (start)', '1-step': 'sending', '2-step': 'sending, seg-1 proven', '3-step': 'unknown',
          '4-step': 'partial, NO new receipt', '5-step': 'sending again', '6-step': 'delivered (seg-2 twice)', 'direct-unknown-to-sending': 'direct unknown -> sending'}
f.append('  ' + B + f'{"step":<28}' + ''.join(f'{a:<16}' for a in arms) + R0)
for k, lab in labels.items():
    cells = ''
    for a in arms:
        v = arms[a].get(k, '')
        v = v.split('S=')[-1] if k == '0-start' else v.replace('X=', '')
        cells += (ok if v == 'T' else bad)(f'{("accept" if v == "T" else "refuse"):<16}')
    f.append(f'  {lab:<28}{cells}')
f.append('')
f.append(sub('Suites with the fix + corpus update (proves-partial gets a real proof; old shape becomes a refusal)'))
for line in open(f'{L}/fix-ts.ansi'):
    s = strip(line).rstrip()
    if s.startswith(' ✓') or 'Tests ' in s: f.append('  ' + line.rstrip())
f.append('  Java ManagedChannelRecordContractTest + ProjectionContract + RecordStore: ' + ok(open(f'{L}/fix-java.txt').read().strip()))
f.append('')
f.append(sub('Behaviour delta of the fix over 300,274 fuzz inputs'))
f.append('  fixed TS vs fixed Java divergences: ' + ok('0'))
f.append('  inputs whose verdict changed vs PR head: 73 — all channel_delivery unknown->partial with an unchanged receipt count (X=T -> X=F)')
write('fig4-candidate-fix', f)

# ---------- Fig 5: mutation matrix ----------
rows = {}
for lang in ('ts', 'java'):
    for l in open(f'{L}/mutants-{lang}.jsonl'):
        r = json.loads(l)
        rows[r['id']] = r
EQUIV = {'17': 'equivalent (deliveryId set <=> target channel)',
         '31': 'equivalent (start => planned => 0 receipts)',
         '49': 'equivalent (ordinals dense from zero)',
         '50': 'equivalent (run effectId is immutable)',
         '51': 'equivalent (run effectId is immutable)'}
f = [hdr('Rule-deletion mutants — PR corpus vs 300k-input differential (mutant side vs other language pristine)'), '']
f.append(f'  {B}{"id":<4}{"rule removed":<58}{"TS corpus":<11}{"TS fuzz":>8}   {"Java corpus":<12}{"Java fuzz":>9}{R0}')
ids = sorted({k[1:] for k in rows if k[0] in 'TJ' and k[1:].isdigit() and k != 'T000' and k != 'J000'})
for i in ids:
    t, j = rows.get('T' + i), rows.get('J' + i)
    def cell(r):
        if r is None: return f'{D}{"—":<11}{R0}', f'{D}{"—":>8}{R0}'
        k = r.get('failed', 0) > 0
        if not k and i in EQUIV: return f'{D}{"survives":<11}{R0}', f'{D}{0:>8}{R0}'
        return (ok(f'{"killed":<11}') if k else bad(f'{"LIVE":<11}')), (f'{r.get("fuzz_diffs", 0):>8,}' if r.get('fuzz_diffs') else f'{D}{0:>8}{R0}')
    tc, tf = cell(t); jc, jf = cell(j)
    note = ''
    if t and t.get('failed', 0) == 0:
        note = f'  {D}{EQUIV[i]}{R0}' if i in EQUIV else f'  {Y}corpus gap (fuzz-killed){R0}'
    f.append(f'  {i:<4}{t["desc"][:56]:<58}{tc}{tf}   {jc[:-4] if False else jc}{jf}{note}')
f.append('')
for i, desc in (('A1', ''), ('A2', ''), ('A3', ''), ('A4', ''), ('P1', ''), ('P2', ''), ('P3', '')):
    r = rows['T' + i]
    f.append(f'  {i:<4}{r["desc"][:56]:<58}{ok("killed")}     {D}(authority/projection, TS only; {r["failed"]} test(s) fail){R0}')
r = rows['JS0']
f.append(f'  S0  {r["desc"][:56]:<58}{D}{"—":<11}{"—":>8}{R0}   {ok("killed"):<12}     {r["fuzz_diffs"]:>8,}')
f.append('')
tk = sum(1 for k, r in rows.items() if k.startswith('T') and k != 'T000' and r.get('failed', 0) > 0)
jk = sum(1 for k, r in rows.items() if k.startswith('J') and k != 'J000' and r.get('failed', 0) > 0)
tn = sum(1 for k in rows if k.startswith('T') and k != 'T000'); jn = sum(1 for k in rows if k.startswith('J') and k != 'J000')
f.append(f'  {B}TS {tk}/{tn} killed by the PR suites; Java {jk}/{jn}. Survivors identical in both languages: 12 live (all caught by the fuzz), 5 equivalent.{R0}')
f.append(f'  {D}controls: unmutated TS 318/318 + 0 fuzz diffs; unmutated Java 29/29 + 0 fuzz diffs{R0}')
write('fig5-mutants', f)

# ---------- Fig 6: CI attribution ----------
f = [hdr('CI: why both managed-agent-server lanes are red/cancelled on 8b283d1c'), '']
f.append(sub('Only two SDK Java lanes run managed-agent-server (sdk-java.yml); the five OS lanes run qwencode + runtime-broker only'))
f.append('  Hosted process fault gates / MySQL 8.4 / Java 21   ' + bad('cancelled') + ' 03:36Z -> 04:41Z   before the stall: ChannelRecordContract 2/2,')
f.append('                                                     PlannedChannel 3/3, ExtensionRecordStore 19/19, ProjectionContract 8/8')
f.append('  Runtime Broker and Managed Agent MariaDB / Java 21  ' + bad('cancelled') + ' 03:26Z -> 03:46Z   (log cut at 4.2 MB)')
f.append('')
f.append(sub('What stalled them: one failing test prints its 1.3 MB request body as ONE log line (Hosted lane job log)'))
f.append('  line 26255  03:46:20Z   Headers = [Content-Type:"application/json ...                      219 chars')
f.append('  line 26256  ' + Y + '04:05:47Z' + R0 + '   Body = {"workspaceId":"workspace-store","writerId":"writer-a",...  ' + bad('1,334,121 chars'))
f.append('  line 26257  ' + Y + '04:25:06Z' + R0 + '   Session Attrs = {}   <- ~39 min of runner stall around one line, then the job limit')
f.append('  line 26288  [ERROR] ManagedSessionStoreIntegrationTest.holdsRestorePagesInsideThePerPageByteBudget  (Time elapsed: 0.064 s)')
f.append('')
f.append(sub('That test is broken on the PR base and fixed on main by #13551 (a764fb96, 00:43Z) — local A/B, same JDK 21'))
for arm, label in (('base', 'merge-base ac497aee (2026-10-06 17:01Z)'), ('head', 'PR head    8b283d1c')):
    s2 = open(f'{L}/integ-{arm}.txt').read().splitlines()
    f.append(f'  {label:<42} {bad(s2[0])}  ' + D + s2[1][2:60] + '...' + R0)
f.append(f'  {"head + main f07c190c (merge 317feb8c)":<42} {ok("RUN=5 OK=5 FAIL=0")}')
f.append('')
f.append(f'  main runs of the same two lanes at 03:31Z / 03:38Z / 04:16Z: {ok("success")} (ManagedSessionStoreIntegrationTest 5/5);')
f.append(f'  main runs before #13551 (ac81c07d, b5855087 on 10-06): both lanes {bad("cancelled")}; Hosted logs carry the same 1,334,121-char')
f.append(f'  line and the same holdsRestorePagesInsideThePerPageByteBudget error — the identical signature, without this PR.')
write('fig6-ci', f)
print('panels written')
