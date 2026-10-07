#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13505): differential corpus for the child_run (child_agent + shell)
# and child_acceptance bodies. Seeds = every fixture case / successor pair materialized exactly as
# the shared fixture tests do; then single-point mutations at every path, value-pool swaps, random
# multi-point mutations, and cross-pairs of valid bodies. Output: JSONL of
#   {"id", "op": "one"|"pair", "domain", "a": <json text>, "b": <json text>|null}
import json, random, sys, copy, itertools

random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 13505)
import os
FIX = os.environ.get('FIXDIR', '/Users/wenshao/git/pr13505-head/packages/core/src/managed-runtime/contracts/')
run_fx = json.load(open(FIX + 'managed-child-run-record-v1.fixtures.json'))
acc_fx = json.load(open(FIX + 'managed-child-acceptance-record-v1.fixtures.json'))

def merge(base, patch):
    value = copy.deepcopy(base if base is not None else {})
    for k, r in patch.items():
        if r is not None and isinstance(r, dict):
            value[k] = merge(value.get(k) if isinstance(value.get(k), dict) else {}, r)
        else:
            value[k] = r
    return value

def template(fx, case, default):
    return fx['templates'][case.get('template', default)] if isinstance(fx['templates'], dict) else None

seeds_one = []   # (domain, body)
seeds_pair = []  # (domain, before, after)
for c in run_fx['cases']:
    t = run_fx['templates'][c.get('template', 'child_run')]
    seeds_one.append(('child_run', merge(t, c['patch']), c['valid']))
for s in run_fx['successors']:
    t = run_fx['templates'][s.get('template', 'child_run')]
    b = merge(t, s['before']); a = merge(b, s['after'])
    seeds_pair.append(('child_run', b, a))
for c in acc_fx['cases']:
    t = acc_fx['templates'][c.get('template', 'child_acceptance')]
    seeds_one.append(('child_acceptance', merge(t, c['patch']), c['valid']))
for s in acc_fx['successors']:
    t = acc_fx['templates'][s.get('template', 'child_acceptance')]
    b = merge(t, s['before']); a = merge(b, s['after'])
    seeds_pair.append(('child_acceptance', b, a))

D64 = 'a' * 64
POOL = [None, True, False, 0, 1, -1, 2, 8, 9, 1.5, 2 ** 53, 2 ** 53 + 2, '', 'a', '1', 'x' * 513,
        'planned', 'accepting', 'accepted', 'consumed', 'unknown', 'rejected', 'cancelled', 'sending',
        'delivered', 'partial', 'settled', 'running', 'failed', 'reserved', 'admitted', 'waiting',
        'recovery_blocked', 'intent', 'dispatch_started', 'running_attached', 'not_started_proven',
        'outcome_unknown', 'corrupt', 'session', 'channel', 'tool', 'sent', 'shared', 'snapshot',
        'worktree', 'child_agent', 'shell', 'workflow', 'completed', 'creation_failed', 'child_failed',
        'quota_exceeded', 'stop_requested', 'exited', 'count_limit', 'depth_limit', 'runtime_lost',
        '.', '..', 'a/b', '/a', 'a/', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'café', 'café',
        '\ud800', 'a\u0000b', ' a', 'a b', D64, D64.upper(), 'g' * 64, 'a' * 63, {}, [], [1],
        {'resourceId': 'r-x', 'kind': 'managed-input', 'schemaVersion': 1, 'byteLength': 2, 'digest': D64},
        {'definitionId': 'agent-2', 'definitionRevision': 2, 'definitionDigest': D64},
        {'runtimeBindingId': 'binding-9', 'generation': '9'},
        {'target': 'session', 'state': 'accepted'}, {'target': 'session', 'state': 'consumed'},
        {'target': 'session', 'state': 'planned'}, {'target': 'channel', 'state': 'planned'},
        {'kind': 'quota', 'code': 'depth_limit'}, {'kind': 'recovery', 'code': 'runtime_lost'}]
# raw numeric spellings, injected as text (JSON.parse and Jackson must agree on value)
RAW_NUMS = ['1.0', '1e0', '10E-1', '1.0000000000000001', '8.0', '0.9999999999999999', '-0', '1E2', '8e0', '9e-0']

def paths(v, prefix=()):
    yield prefix
    if isinstance(v, dict):
        for k in v:
            yield from paths(v[k], prefix + (k,))

def get(v, p):
    for k in p:
        v = v[k]
    return v

def setp(v, p, x):
    v = copy.deepcopy(v)
    if not p:
        return x
    cur = v
    for k in p[:-1]:
        cur = cur[k]
    cur[p[-1]] = x
    return v

def delp(v, p):
    v = copy.deepcopy(v)
    cur = v
    for k in p[:-1]:
        cur = cur[k]
    del cur[p[-1]]
    return v

RAWMARK = '\u0001RAW:'
def dumps(v):
    s = json.dumps(v, ensure_ascii=True, separators=(',', ':'))
    # replace marked raw numbers: "\u0001RAW:1.0" -> 1.0
    import re
    return re.sub(r'"\\u0001RAW:([^"]*)"', lambda m: m.group(1), s)

def single_mutations(body):
    out = []
    for p in paths(body):
        if not p:
            continue
        out.append(delp(body, p))
        parent = get(body, p[:-1])
        if isinstance(parent, dict):
            out.append(setp(body, p[:-1] + ('zz',), None) if False else None)
        for x in POOL:
            out.append(setp(body, p, x))
        cur = get(body, p)
        if isinstance(cur, (int, float)) and not isinstance(cur, bool):
            for r in RAW_NUMS:
                out.append(setp(body, p, RAWMARK + r))
    for p in paths(body):
        if isinstance(get(body, p), dict):
            out.append(setp(body, p + ('zz',), 1))
    return [o for o in out if o is not None]

def rand_mutation(body, k):
    v = body
    for _ in range(k):
        ps = [p for p in paths(v) if p]
        p = random.choice(ps)
        r = random.random()
        try:
            if r < 0.15:
                v = delp(v, p)
            elif r < 0.25 and isinstance(get(v, p), (int, float)) and not isinstance(get(v, p), bool):
                v = setp(v, p, RAWMARK + random.choice(RAW_NUMS))
            else:
                v = setp(v, p, copy.deepcopy(random.choice(POOL)))
        except Exception:
            pass
    return v

rows = []
def emit(op, domain, a, b=None):
    rows.append({'id': f'c{len(rows)}', 'op': op, 'domain': domain, 'a': dumps(a),
                 'b': None if b is None else dumps(b)})

for d, body, _ in seeds_one:
    emit('one', d, body)
    for m in single_mutations(body):
        emit('one', d, m)
    for _ in range(60):
        emit('one', d, rand_mutation(body, random.choice([2, 2, 3, 4])))

valid_by_dom = {}
for d, body, ok in seeds_one:
    if ok:
        valid_by_dom.setdefault((d, body.get('kind', 'acc')), []).append(body)
for d, b, a in seeds_pair:
    emit('pair', d, b, a)
    for m in single_mutations(a):
        emit('pair', d, b, m)
    for m in random.sample(single_mutations(b), 80):
        emit('pair', d, m, a)
    for _ in range(40):
        emit('pair', d, b, rand_mutation(a, random.choice([1, 2, 3])))
# every ordered pair of valid bodies of the same kind (exercises the successor relation broadly)
for (d, kind), bodies in valid_by_dom.items():
    for x, y in itertools.product(bodies, bodies):
        emit('pair', d, x, y)
    # and pairs whose after is a random state-line mutation of another valid body
    for _ in range(3000):
        x, y = random.choice(bodies), random.choice(bodies)
        emit('pair', d, x, rand_mutation(y, 1))

out = open(sys.argv[1], 'w')
for r in rows:
    out.write(json.dumps(r, ensure_ascii=True) + '\n')
print(len(rows), 'rows;', sum(1 for r in rows if r['op'] == 'one'), 'one;',
      sum(1 for r in rows if r['op'] == 'pair'), 'pair', file=sys.stderr)
