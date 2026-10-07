import json, sys, collections
cases_f, ts_f = sys.argv[1], sys.argv[2]
ver = {}
for l in open(ts_f):
    k, v = l.rstrip('\n').split('\t', 1); ver[k] = v
acc = collections.Counter(); succ = collections.Counter(); succ_ref = collections.Counter(); route_succ = collections.Counter()
def line(d):
    try: return d['run']['delivery']['state'] + '/' + d['run']['state']
    except Exception: return '?'
for l in open(cases_f):
    c = json.loads(l); v = ver[c['id']]
    a = json.loads(c['a'])
    if c['op'] == 'one':
        if c['domain'] == 'channel_delivery' and v.startswith('P=A'): acc['delivery ' + line(a)] += 1
        if c['domain'] == 'channel_route' and v.startswith('P=A'):
            try: acc['route ' + a['scope']['kind'] + '/' + a['run']['state']] += 1
            except Exception: pass
    else:
        b = json.loads(c['b'])
        if c['domain'] == 'channel_delivery':
            try: k = a['run']['delivery']['state'] + '->' + b['run']['delivery']['state']
            except Exception: k = '?'
            (succ if v == 'X=T' else succ_ref)[k] += 1
        else:
            try: k = ('rev+%s' % (b['routeRevision'] - a['routeRevision'])) + (' gen%+d' % (b['accountGeneration'] - a['accountGeneration']))
            except Exception: k = '?'
            route_succ[(k, v)] += 1
print('accepted delivery (line/run) combos:', len([k for k in acc if k.startswith('delivery')]))
for k, n in sorted(acc.items()): print(f'  {n:7d} {k}')
print('delivery successor line steps ACCEPTED:'); [print(f'  {n:7d} {k}') for k, n in succ.most_common()]
print('route successor (rev/gen delta, verdict):'); [print(f'  {n:7d} {k}') for k, n in sorted(route_succ.items(), key=lambda x: -x[1])[:16]]
