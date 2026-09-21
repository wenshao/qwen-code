#!/usr/bin/env python3
"""Figure 7 (final): the author's latest plan (10:52 comment + 12:53-12:56 inline replies) vs the same probes.
Outcomes are read from the TSVs written by PlanMatrixProbe2 (module package, clause-level)."""
import csv
L = '/root/verify/pr12391-harness/logs/'
arms = {a: {r[0]: r[1] for r in csv.reader(open(L + f'matrix2-{a}.tsv'), delimiter='\t') if not r[0].startswith('#')}
        for a in ('head', 'L2', 'C2')}
B, CY, G, RD, Y, M, D, R = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[33m', '\x1b[1;35m', '\x1b[2m', '\x1b[0m'
def cell(v):
    col = {'OPEN': RD, 'closed': G, 'STUCK': M, 'BLOCKED': M, 'ok': G, 'BROKEN': RD}.get(v, '')
    return col + f'{v:<9}' + R
groups = [
  ('Who may write  (fenced compareAndSet)', [
    ('P1', 'a caller that never claimed settles during a live lease'),
    ('R1-4', 'evicted owner re-reads, then settles (B locked out)'),
    ('R1-1b', 'owner whose lease expired settles (no takeover)'),
  ]),
  ('Which transitions are allowed', [
    ('R1-2', 'takeover of an EXECUTING record re-dispatches it'),
    ('R1-5b', 'UNKNOWN -> resume EXECUTING -> 2nd owner'),
    ('R1-3a', 'UNKNOWN -> PREPARED -> re-claimed'),
    ('R1-3b1', 'host-requested cancel erased by a later write'),
    ('P11', 'EXECUTING -> PREPARED (backwards)'),
  ]),
  ('What a write may carry', [
    ('R1-5a', 'claim dropped mid-flight -> 2nd owner elected'),
    ('R1-1a', 'replacement rewrites the claim (gen 3 -> 1)'),
    ('R1-9', 'lastSequence 5 -> 0, then settles at 1'),
    ('R1-8', 'AtomicLong aliased into a settled result'),
    ('R1-3b2', 'CANCEL_REQUESTED stored with cancelRequested=false'),
  ]),
  ('The UNKNOWN lifecycle', [
    ('OWN-UNKNOWN', "lease holder records an ambiguous outcome: withUnknown()"),
    ('LIVE', 'an UNKNOWN execution can be resolved: resolveUnknown()'),
  ]),
  ('Controls and smaller notes', [
    ('CTL', 'owner claim/renew/settle + host cancel still work'),
    ('NOTE-sameRequest', 'sameRequest is public'),
    ('NOTE-candidate-seq', 'findOrCreate refuses a candidate with lastSequence>0'),
    ('NOTE-map-key', 'non-String nested key -> IllegalArgumentException'),
    ('NOTE-ctor', '20-argument constructor no longer public'),
  ]),
]
W = 58
print(f"{B}{CY}Your plan as of 12:56 (10:52 comment + inline replies), implemented literally, against the same probes{R}")
print(f"{D}head = 9fcc065 · plan = fenced CAS, requestCancel, takeover->UNKNOWN, 3 transition rules, preserve-or-advance claim,{R}")
print(f"{D}       lastSequence monotonic, Number allowlist, package-private 20-arg ctor, R1 notes  (+92/-13){R}")
print(f"{D}+3    = UNKNOWN move exempt from preserve-or-advance, repository resolveUnknown, CANCEL_REQUESTED=>cancel  (+31/-1 more){R}")
print(f"{D}probe runs in the module package (tests the clauses, not visibility); each caller passes its own claim token;{R}")
print(f"{D}the PR's 12 tests are green and Checkstyle is 0 on both arms{R}")
print()
print(f"  {'':16s}{'':{W}s}{B}{'head':9s}  {'plan':9s}  {'plan +3':9s}{R}")
for title, rows in groups:
    print(f"  {B}{title}{R}")
    for rid, desc in rows:
        short = rid.replace('NOTE-', '')
        print(f"  {short:16s}{desc:{W}s}{cell(arms['head'][rid])}  {cell(arms['L2'][rid])}  {cell(arms['C2'][rid])}")
print()
defects = [rid for g in groups[:3] for rid, _ in g[1]]
closed = lambda a: sum(1 for rid in defects if arms[a][rid] == 'closed')
print(f"  defect rows closed: head {closed('head')}/{len(defects)} · plan {closed('L2')}/{len(defects)} · plan +3 {closed('C2')}/{len(defects)}")
print(f"  {M}BLOCKED{R} withUnknown() clears owner and lease, so preserve-or-advance refuses it: UNKNOWN is reachable only via takeover")
print(f"  {M}STUCK{R}   once UNKNOWN there is no live-lease triple to present and the 2-arg CAS is gone: resolveUnknown() is refused")
print(f"          as the former owner and as anyone, claim is refused, hasActiveByRuntimeSession is still true 1 h later")
