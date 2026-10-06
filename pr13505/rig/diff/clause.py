import json, sys, re, collections
corpus, ts, jv = sys.argv[1:4]
def norm(m):
    m = (m or '').lower().rstrip('.').strip()
    m = re.sub(r'^(childrun\.|child run |child acceptance |childrun |run\.|definition\.)', '', m)
    m = re.sub(r'^(childrun\.|child run |run\.)', '', m)
    m = m.replace('childrun.run', 'run').replace('run.definition.', 'definition.')
    m = re.sub(r'must be one of(:| \[).*', 'ONE-OF', m)
    m = re.sub(r'must (have exactly the keys|be an object with exactly|be a json object).*', 'CLOSED', m)
    m = re.sub(r'must be (a non-negative safe integer|an integer from).*', 'INT', m)
    m = re.sub(r"'(\w+)'", r'\1', m)
    return m.strip()
pairs = collections.Counter(); ex = {}
with open(corpus) as fc, open(ts) as ft, open(jv) as fj:
    for lc, lt, lj in zip(fc, ft, fj):
        t = json.loads(lt); j = json.loads(lj)
        if not (t.get('read') and 'ok' in t and t['ok'] is False and j.get('ok') is False): continue
        r = json.loads(lc)
        a = json.loads(r['a'])
        kind = a.get('kind') if isinstance(a, dict) and r['domain'] == 'child_run' else r['domain']
        if kind not in ('child_agent', 'child_acceptance'): continue
        if norm(t['err']) != norm(j['err']):
            k = (kind, norm(t['err'])[:80], norm(j['err'])[:80]); pairs[k] += 1; ex.setdefault(k, r['id'])
print('clause mismatches (child_agent + child_acceptance only):', sum(pairs.values()), 'rows,', len(pairs), 'distinct')
for k, n in pairs.most_common(200): print(n, k, ex[k])
