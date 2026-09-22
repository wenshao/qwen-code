#!/usr/bin/env python3
"""Figure 11: PlanMatrixProbe4 on 25a38c3 (round 3), the round-3 "+rule" patch, and 4ddb2c3."""
import csv
L = '/root/verify/pr12391-harness/r4/logs/'
A = ('25a38c3', 'F2', '4ddb2c3')
arms = {a: {r[0]: (r[1], r[2] if len(r) > 2 else '') for r in csv.reader(open(L + f'matrix4-{a}.tsv'), delimiter='\t')
            if r and not r[0].startswith('#')} for a in A}
B, CY, G, RD, Y, M, D, X = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[33m', '\x1b[1;35m', '\x1b[2m', '\x1b[0m'
def cell(v):
    col = {'OPEN': RD, 'closed': G, 'ok': G, 'n/a': D, 'stored': Y, 'accepted': Y, 'STUCK': M}.get(v, '')
    return col + f'{v:<9}' + X
groups = [
  ('Who may write', [
    ('P1', 'a caller that never claimed reads the record and settles it'),
    ('R1-4', 'evicted owner re-reads (normal CAS retry), then settles'),
    ('FORCE-UNKNOWN', 'any reader forces a live execution into UNKNOWN'),
    ('REWIND', 'any reader rewinds EXECUTING -> PREPARED; re-dispatched later'),
    ('R1-1b', 'owner whose lease expired settles'),
  ]),
  ('Which transitions are allowed', [
    ('P11', 'lease holder moves its own EXECUTING back to PREPARED'),
    ('R1-2', 'takeover of EXECUTING re-dispatches it'),
    ('R1-5b', 'UNKNOWN -> resume EXECUTING'),
    ('R1-3a', 'UNKNOWN -> PREPARED'),
    ('R1-3b1', 'cancel intent erased by a later write'),
    ('R2-1', 'cancel erased via a forged expected (public withState)'),
    ('UNLISTED', 'moves the doc does not list as legal (see below)'),
  ]),
  ('What a write may carry', [
    ('R1-5a', 'claim dropped mid-flight'),
    ('R1-1a', 'claim rewritten (generation 3 -> 1)'),
    ('R1-9', 'lastSequence 5 -> 0'),
    ('R1-9-forged', 'same, through an expected rebuilt in-package'),
    ('R1-8', 'AtomicLong aliased into a settled result'),
    ('R1-3b2', 'CANCEL_REQUESTED stored with cancelRequested=false'),
  ]),
  ('UNKNOWN lifecycle and controls', [
    ('OWN-UNKNOWN', 'lease holder records UNKNOWN, then it is resolved'),
    ('KEEP-UNKNOWN', 'withState(UNKNOWN) keeps the claim; resolved after the lease'),
    ('LIVE', 'takeover UNKNOWN resolved an hour later, session drains'),
    ('CTL', 'claim/renew/settle, host cancel (EXECUTING and PREPARED)'),
  ]),
  ('Round-1 notes', [
    ('NOTE-sameRequest', 'sameRequest is public'),
    ('NOTE-candidate-seq', 'findOrCreate refuses a candidate with lastSequence > 0'),
    ('NOTE-map-key', 'non-String nested key -> IllegalArgumentException'),
    ('NOTE-ctor', '20-argument constructor no longer public'),
  ]),
]
W = 66
print(f"{B}{CY}The same probes on round 3's head, round 3's \"+rule\" patch, and 4ddb2c3{X}  {D}(PlanMatrixProbe4, module package){X}")
print()
print(f"  {'':15s}{'':{W}s}{B}{'25a38c3':9s}  {'+rule':9s}  {'4ddb2c3':9s}{X}")
for title, rows in groups:
    print(f"  {B}{title}{X}")
    for rid, desc in rows:
        print(f"  {rid.replace('NOTE-',''):15s}{desc:{W}s}" + '  '.join(cell(arms[a][rid][0]) for a in A))
print()
u = arms['4ddb2c3']['UNLISTED'][1]
acc = u.split('accepted: [')[1].split(']')[0]; ref = u.split('refused: [')[1].split(']')[0]
print(f"  {Y}UNLISTED{X} on 4ddb2c3 — accepted: {acc}")
print(f"           refused: {ref}")
print(f"           {D}the doc lists the legal moves and says \"The repository rejects every other move\"; none of the accepted ones re-dispatches{X}")
print(f"  {RD}R1-9-forged{X} needs the package-private constructor: requireReplacement compares lastSequence with expected, not the stored record")
