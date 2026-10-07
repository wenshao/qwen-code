# VERIFICATION RIG ONLY (PR #13536): refused-by-both rows, clause comparison after wording normalization
# (labels differ by prefix: TS "cron"/"Schedule"/"AutomationRun" vs Java "schedule.cron"/"schedule"/"automationRun").
import json, sys, re, collections
corpus, ts, jv = sys.argv[1:4]
def norm(m):
    m = (m or '').lower().rstrip('.').strip()
    m = re.sub(r'^(schedule|automationrun)(\.run\.|\.run |\.| )', lambda g: 'run.' if 'run' in g.group(2) else '', m)
    m = re.sub(r'^run\.(definition\.|runtime\.|delivery\.|reason\.)', r'\1', m)
    m = re.sub(r'must be one of(:| \[).*', 'ONE-OF', m)
    m = re.sub(r'must (have exactly the keys|be an object with exactly|be a json object).*', 'OBJECT', m)
    m = re.sub(r'must be (a non-negative safe integer|an integer from).*', 'INT', m)
    m = re.sub(r"'(\w+)'", r'\1', m)
    m = m.replace('run.OBJECT','run OBJECT').replace('run.must','run must').replace('run.names','run names')
    m = re.sub(r'must be a plain json object', 'OBJECT', m)
    m = re.sub(r'run\.definition OBJECT', 'definition OBJECT', m)
    m = re.sub(r'must be (valid utf-8|well-formed) text', 'WF', m)
    m = re.sub(r'reached the maximum safe integer and cannot advance', 'INT', m)
    m = re.sub(r'^promptref (has the unknown field.*|OBJECT)$', 'promptref SHAPE', m)
    return m.strip()
pairs = collections.Counter(); ex = {}; same = 0
with open(corpus) as fc, open(ts) as ft, open(jv) as fj:
    for lc, lt, lj in zip(fc, ft, fj):
        t = json.loads(lt); j = json.loads(lj)
        if not (t.get('read') and t.get('ok') is False and j.get('ok') is False): continue
        if norm(t['err']) == norm(j['err']): same += 1; continue
        r = json.loads(lc)
        k = (r['domain'], norm(t['err'])[:85], norm(j['err'])[:85]); pairs[k] += 1; ex.setdefault(k, r['id'])
print('refused-both same clause:', same, '| different clause:', sum(pairs.values()), 'rows,', len(pairs), 'distinct')
for k, n in pairs.most_common(60): print(n, k, ex[k])
