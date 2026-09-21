#!/usr/bin/env python3
"""Figure 9: the same probes on 9fcc065, 25a38c3, +actor (F), +actor+rule (F2); then the mutant sweep."""
import csv, re
L = '/root/verify/pr12391-harness/r3/logs/'
arms = {a: {r[0]: (r[1], r[2] if len(r) > 2 else '') for r in csv.reader(open(L + f'matrix3-{a}.tsv'), delimiter='\t')
            if r and not r[0].startswith('#')} for a in ('9fcc065', '25a38c3', 'F', 'F2')}
B, CY, G, RD, Y, M, D, X = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[33m', '\x1b[1;35m', '\x1b[2m', '\x1b[0m'
def cell(v):
    col = {'OPEN': RD, 'closed': G, 'ok': G, 'n/a': D, 'stored': Y, 'STUCK': M, 'BLOCKED': M}.get(v, '')
    return col + f'{v:<8}' + X
groups = [
  ('Who may write', [
    ('P1', 'a caller that never claimed reads the record and settles it'),
    ('R1-4', 'evicted owner re-reads (normal CAS retry), then settles'),
    ('FORCE-UNKNOWN', "any reader forces a live execution into UNKNOWN"),
    ('REWIND', 'any reader rewinds EXECUTING -> PREPARED; re-dispatched later'),
    ('SYNTH', "your new test: owner-a's claim spliced into the current version"),
    ('R1-1b', 'owner whose lease expired settles'),
  ]),
  ('Which transitions are allowed', [
    ('R1-2', 'takeover of EXECUTING re-dispatches it'),
    ('R1-5b', 'UNKNOWN -> resume EXECUTING'),
    ('R1-3a', 'UNKNOWN -> PREPARED'),
    ('R1-3b1', 'cancel intent erased by a later write'),
    ('P11', "lease holder moves its own EXECUTING back to PREPARED"),
  ]),
  ('What a write may carry', [
    ('R1-5a', 'claim dropped mid-flight'),
    ('R1-1a', 'claim rewritten (generation 3 -> 1)'),
    ('R1-9', 'lastSequence 5 -> 0'),
    ('R1-8', 'AtomicLong aliased into a settled result'),
  ]),
  ('UNKNOWN lifecycle and controls', [
    ('OWN-UNKNOWN', 'lease holder records UNKNOWN, then it is resolved'),
    ('KEEP-UNKNOWN', 'withState(UNKNOWN) keeps the claim; resolved after the lease'),
    ('LIVE', 'takeover UNKNOWN resolved an hour later, session drains'),
    ('CTL', 'claim/renew/settle, host cancel (EXECUTING and PREPARED)'),
  ]),
]
W = 66
LABEL = {
  'N01': 'compareAndSet refuses a current UNKNOWN record',
  'N02': 'compareAndSet: current.sameDispatch(expected)',
  'N03': 'compareAndSet: hasLiveDispatchAt(now)',
  'N04': 'requireReplacement: replacement keeps the claim',
  'N05': 'requireReplacement: cancel request cannot be dropped',
  'N06': 'claimDispatch: EXECUTING takeover -> UNKNOWN',
  'N07': 'claimDispatch: CANCEL_REQUESTED takeover -> UNKNOWN',
  'N08': 'withUnknown keeps the claim',
  'N09': 'requestCancel: expectedVersion check',
  'N10': 'requestCancel: settled check',
  'N11': 'requestCancel: idempotent early return',
  'N12': 'requestCancel: EXECUTING -> CANCEL_REQUESTED',
  'N13': 'requestCancel: PREPARED settles immediately',
  'N14': 'resolveUnknown: sameIdentity check',
  'N15': 'resolveUnknown: version check',
  'N16': 'resolveUnknown: state == UNKNOWN check',
  'N17': 'resolveUnknown: expected != null guard',
}
print(f"{B}{CY}The same probes, four arms{X}  {D}(PlanMatrixProbe3, module package; each caller writes with the snapshot it has{X}")
print(f"{D}and, where the CAS takes one, passes its own owner/generation){X}")
print(f"{D}+actor = compareAndSet(expected, replacement, owner, dispatchGeneration)  (+8/-4)   +rule = +actor, plus no move back to PREPARED/DISPATCHING  (+16/-4){X}")
print()
print(f"  {'':15s}{'':{W}s}{B}{'9fcc065':8s}  {'25a38c3':8s}  {'+actor':8s}  {'+rule':8s}{X}")
for title, rows in groups:
    print(f"  {B}{title}{X}")
    for rid, desc in rows:
        print(f"  {rid:15s}{desc:{W}s}" + '  '.join(cell(arms[a][rid][0]) for a in ('9fcc065', '25a38c3', 'F', 'F2')))
print()
print(f"  {B}Notes accepted earlier, not in 25a38c3{X}: " + ', '.join(
    f"{k.replace('NOTE-','')} {arms['25a38c3'][k][0]}" for k in ('NOTE-sameRequest', 'NOTE-candidate-seq', 'NOTE-map-key', 'NOTE-ctor')))
print()
print(f"{B}{CY}Deleting each guard 25a38c3 adds, one at a time{X}  {D}(your 18 tests; last column = matrix rows whose outcome flips){X}")
for line in open('/root/verify/pr12391-harness/r3/mutants/run.log'):
    m = re.match(r'(N\d\d)\s+(\w+)\s+(.*?)(?:\s+<- (\S+))?\s+\| matrix rows changed: (.*)', line.rstrip())
    if not m:
        continue
    mid, v, desc, killer, changed = m.groups()
    desc = LABEL[mid]
    col = G if v == 'KILLED' else RD
    names = [c.split(':')[0] for c in changed.split(', ')] if changed != 'none' else []
    shown = ', '.join(n for n in names if n not in ('LIVE',)) or '-'
    print(f"  {mid} {col}{v:9s}{X}{desc:58s} {D}{shown}{X}")
tot = open('/root/verify/pr12391-harness/r3/mutants/run.log').read()
k = re.search(r'killed (\d+)/(\d+)', tot)
print(f"  killed {k.group(1)}/{k.group(2)} · renewDispatch: expiry clause now pinned; owner and generation clauses still survive")
own = [l.split() for l in open('/root/verify/pr12391-harness/r3/logs/f2-own-mutants.log') if l.strip()]
print(f"  {D}for comparison, the +rule arm's own four clauses (owner, generation, two backwards moves): {sum(1 for l in own if l[1]=='KILLED')}/{len(own)} killed by its added tests{X}")
