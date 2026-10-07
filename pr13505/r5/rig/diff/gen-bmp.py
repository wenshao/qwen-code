#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13505 round 5): full-code-point sweep of every string field.
# Seeds = the valid fixture body with the most string leaves per template (child_run shell,
# child_agent, child_acceptance). For one string leaf (selected by index), every BMP code point
# (lone surrogates included, as JSON escapes) and every 256th astral code point is placed
# (a) after the value, (b) as the whole value; workingDirectory additionally gets the drive
# shapes C:<cp>x, C:x<cp>y, a/<cp>, <cp>:x.
# usage: gen-bmp.py list            -> prints "<index>\t<seed>\t<path>" per field
#        gen-bmp.py <index> <out>   -> JSONL rows {id, op:"one", domain, a, cp, shape}
import json, sys, copy, os
FIX = os.environ['FIXDIR']
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
def leaves(v, p=()):
    if isinstance(v, dict):
        for k in v: yield from leaves(v[k], p + (k,))
    elif isinstance(v, str): yield p
seeds = []
for fx, dom, default in ((run_fx, 'child_run', 'child_run'), (acc_fx, 'child_acceptance', 'child_acceptance')):
    best = {}
    for c in fx['cases']:
        if not c['valid']: continue
        tn = c.get('template', default)
        b = merge(fx['templates'][tn], c['patch'])
        n = len(list(leaves(b)))
        if tn not in best or n > best[tn][0]: best[tn] = (n, c['id'], b)
    for tn, (n, cid, b) in sorted(best.items()):
        seeds.append((dom, f'{tn}:{cid}', b))
fields = [(dom, label, body, p) for dom, label, body in seeds for p in leaves(body)]
if sys.argv[1] == 'list':
    for i, (dom, label, body, p) in enumerate(fields): print(f'{i}\t{label}\t{".".join(p)}')
    sys.exit(0)
dom, label, body, p = fields[int(sys.argv[1])]
SENT = '\u0001SWEEP\u0001'
b = copy.deepcopy(body); cur = b
for k in p[:-1]: cur = cur[k]
orig = cur[p[-1]]; cur[p[-1]] = SENT
text = json.dumps(b, ensure_ascii=True, separators=(',', ':'))
hole = json.dumps(SENT, ensure_ascii=True)
assert text.count(hole) == 1
CPS = list(range(0x10000)) + list(range(0x10000, 0x110000, 0x100))
out = open(sys.argv[2], 'w'); n = 0
for cp in CPS:
    ch = chr(cp)
    shapes = [('suffix', orig + ch), ('whole', ch)]
    if p[-1] == 'workingDirectory':
        shapes += [('C:cp x', 'C:' + ch + 'x'), ('C:x cp y', 'C:x' + ch + 'y'), ('a/cp', 'a/' + ch), ('cp :x', ch + ':x')]
    for shape, v in shapes:
        a = text.replace(hole, json.dumps(v, ensure_ascii=True))
        out.write(json.dumps({'id': f'b{n}', 'op': 'one', 'domain': dom, 'a': a, 'cp': cp, 'shape': shape}) + '\n'); n += 1
print(n, 'rows', label, '.'.join(p), file=sys.stderr)
