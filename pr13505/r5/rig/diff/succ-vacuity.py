#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13505 round 5): every shared successor fixture, merged exactly as both
# replay harnesses do (template <- before, template <- after), emitted as before/after/pair rows,
# so a valid:false pair whose side does not even parse (vacuous) shows up.
import json, sys, copy
FIX = sys.argv[1]; out = open(sys.argv[2], 'w')
def merge(base, patch):
    value = copy.deepcopy(base if base is not None else {})
    for k, r in patch.items():
        value[k] = merge(value.get(k) if isinstance(value.get(k), dict) else {}, r) if (r is not None and isinstance(r, dict)) else r
    return value
for f, dom in (('managed-child-run-record-v1.fixtures.json', 'child_run'), ('managed-child-acceptance-record-v1.fixtures.json', 'child_acceptance')):
    fx = json.load(open(FIX + f))
    for s in fx['successors']:
        t = fx['templates'][s.get('template') or s['domain']]
        b = json.dumps(merge(t, s['before'])); a = json.dumps(merge(t, s['after']))
        for op, x, y, tag in (('one', b, None, 'before'), ('one', a, None, 'after'), ('pair', b, a, 'pair')):
            out.write(json.dumps({'id': f"{s['id']}|{tag}|{s['valid']}", 'op': op, 'domain': dom, 'a': x, 'b': y}) + '\n')
