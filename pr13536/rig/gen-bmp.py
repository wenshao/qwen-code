#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13536): full-code-point sweep of every string field of the schedule and
# automation_run bodies. Seeds = the valid templates (+ manual-occurrence for the commandId path).
# For one string leaf, every BMP code point (lone surrogates included, as JSON escapes) and every
# 256th astral code point is placed (a) after the value, (b) as the whole value; plus field-specific
# shapes: cron "<cp> 9 * * *", "0<cp> 9 * * *"; timezone "Asia/<cp>"; occurrenceKey "manual:<cp>",
# "schedule:2026-10-06T01:00:00Z<cp>", "<cp>schedule:..."
# usage: gen-bmp.py list | gen-bmp.py <index> <out>
import json, sys, copy, os
fx = json.load(open(os.environ['FIXDIR'] + 'managed-automation-record-v1.fixtures.json'))
def merge(base, patch):
    value = copy.deepcopy(base if base is not None else {})
    for k, r in patch.items():
        if r is not None and isinstance(r, dict): value[k] = merge(value.get(k) if isinstance(value.get(k), dict) else {}, r)
        else: value[k] = r
    return value
def leaves(v, p=()):
    if isinstance(v, dict):
        for k in v: yield from leaves(v[k], p + (k,))
    elif isinstance(v, str): yield p
seeds = [('schedule', 'schedule-start', fx['templates']['schedule']),
         ('automation_run', 'delivery-planned', merge(fx['templates']['automation_run'],
           {'run': {'deliveryId': 'delivery-1', 'delivery': {'target': 'channel', 'state': 'planned'}}}))]
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
    if p[-1] == 'cron': shapes += [('cp 9', ch + ' 9 * * *'), ('0cp 9', '0' + ch + ' 9 * * *'), ('*/cp', '*/' + ch + ' * * * *')]
    if p[-1] == 'timezone': shapes += [('Asia/cp', 'Asia/' + ch), ('cpUTC', ch + 'UTC')]
    if p[-1] == 'occurrenceKey':
        shapes += [('manual:cp', 'manual:' + ch), ('manual:a cp', 'manual:a' + ch), ('cp schedule', ch + orig),
                   ('slot cp mid', 'schedule:2026-10-06T01' + ch + '00:00Z')]
    for shape, v in shapes:
        a = text.replace(hole, json.dumps(v, ensure_ascii=True))
        out.write(json.dumps({'id': f'b{n}', 'op': 'one', 'domain': dom, 'a': a, 'cp': cp, 'shape': shape}) + '\n'); n += 1
print(n, 'rows', label, '.'.join(p), file=sys.stderr)
