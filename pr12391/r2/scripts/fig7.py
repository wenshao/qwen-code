#!/usr/bin/env python3
"""Figure 7: one probe matrix, three arms. Outcomes are read from the TSVs the probe wrote."""
import csv
L = '/root/verify/pr12391-harness/logs/'
arms = {}
for a in ('head', 'L1', 'C', 'L1b'):
    arms[a] = {r[0]: r[1] for r in csv.reader(open(L + f'matrix-{a}.tsv'), delimiter='\t') if not r[0].startswith('#')}
B, C_, G, RD, Y, M, D, R = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[33m', '\x1b[1;35m', '\x1b[2m', '\x1b[0m'
def cell(v):
    col = {'OPEN': RD, 'closed': G, 'closed*': Y, 'STUCK': M, 'ok': G, 'BROKEN': RD}.get(v, '')
    return col + f'{v:<9}' + R
groups = [
  ('Who may write  (plan item 1: fenced compareAndSet)', [
    ('P1', 'a caller that never claimed settles during a live lease'),
    ('R1-4', 'evicted owner re-reads, then settles (B locked out)'),
    ('R1-1b', 'owner whose lease expired settles (no takeover)'),
  ]),
  ('Which transitions are allowed  (plan items 3 and 4)', [
    ('R1-2', 'takeover of an EXECUTING record re-dispatches it'),
    ('R1-5b', 'withUnknown() -> resume EXECUTING -> 2nd owner'),
    ('R1-3a', 'UNKNOWN -> PREPARED -> re-claimed'),
    ('R1-3b1', 'host-requested cancel erased by a later write'),
    ('P11', 'EXECUTING -> PREPARED (backwards)'),
  ]),
  ('What a write may carry  (not in the plan)', [
    ('R1-5a', 'claim dropped mid-flight -> 2nd owner elected'),
    ('R1-1a', 'replacement rewrites the claim (gen 3 -> 1)'),
    ('R1-3b2', 'CANCEL_REQUESTED stored with cancelRequested=false'),
    ('R1-9', 'lastSequence 5 -> 0, then settles at 1'),
    ('R1-8', 'AtomicLong aliased into a settled result'),
  ]),
  ('Liveness and controls', [
    ('LIVE', 'an UNKNOWN execution can still be resolved'),
    ('CTL', 'owner claim/renew/settle + host cancel still work'),
  ]),
  ('Round-1 smaller notes  (all in the plan)', [
    ('NOTE-sameRequest', 'sameRequest reachable by callers (public)'),
    ('NOTE-candidate-seq', 'findOrCreate refuses a candidate with lastSequence>0'),
    ('NOTE-map-key', 'non-String nested key -> IllegalArgumentException'),
  ]),
]
W = 56
print(f"{B}{C_}The fix announced at 10:52, implemented literally, against the same probes{R}")
print(f"{D}head = 9fcc065 · L1 = plan as written (+66/-11) · C = L1 + 4 clauses + resolveUnknown (+116/-12){R}")
print(f"{D}every caller passes ITS OWN claim token; PR's 12 tests green and Checkstyle 0 on L1 and C{R}")
print()
print(f"  {'':16s}{'':{W}s}{B}{'head':9s}  {'L1 plan':9s}  {'C':9s}{R}")
for title, rows in groups:
    print(f"  {B}{title}{R}")
    for rid, desc in rows:
        short = rid.replace('NOTE-', '')
        print(f"  {short:16s}{desc:{W}s}{cell(arms['head'][rid])}  {cell(arms['L1'][rid])}  {cell(arms['C'][rid])}")
print()
closed = lambda a: sum(1 for g in groups[:3] for rid, _ in g[1] if arms[a][rid].startswith('closed'))
total = sum(len(g[1]) for g in groups[:3])
print(f"  defect rows closed: head {closed('head')}/{total} · L1 {closed('L1')}/{total} (one of them only into STUCK) · C {closed('C')}/{total}")
print(f"  {Y}closed*{R} R1-5a only via the EXECUTING->UNKNOWN takeover rule, and lands in STUCK; with the rule limited to an")
print(f"          expired owner (arm L1b) it is {arms['L1b']['R1-5a']} again — the plan itself never forbids the claim drop")
print(f"  {M}STUCK{R}   L1: after withUnknown() clears the owner, the strict fence can never pass and the 2-arg CAS is gone:")
print(f"          resolution refused as the former owner and as anyone; claim refused; session active 1 h later = true")
