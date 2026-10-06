import json, sys, collections
corpus, ts, jv = sys.argv[1:4]
want = set()
rows = {}
T = {}; J = {}
with open(corpus) as fc, open(ts) as ft, open(jv) as fj:
    for lc, lt, lj in zip(fc, ft, fj):
        t = json.loads(lt); j = json.loads(lj)
        if t.get('read') and j.get('read') and 'ok' in t and t.get('ok') != j.get('ok'):
            r = json.loads(lc); rows[r['id']] = r; T[r['id']] = t; J[r['id']] = j
by = collections.Counter(); ex = {}
for i, r in rows.items():
    a = json.loads(r['a'])
    side = 'JAVA-accepts' if J[i]['ok'] else 'TS-accepts'
    k = (side, a.get('kind', 'acc') if isinstance(a, dict) else '?', T[i].get('err') or J[i].get('err'))
    by[k] += 1; ex.setdefault(k, i)
for k, n in by.most_common(): print(n, k, ex[k])
