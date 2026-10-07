#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13536): compare TS vs Java verdicts row by row.
import json, sys, collections
corpus, ts, jv = sys.argv[1], sys.argv[2], sys.argv[3]
C = {}
cnt = collections.Counter(); diffs = collections.defaultdict(list); msgdiff = collections.Counter(); msgex = {}
def norm(s): return (s or '').rstrip('.').strip()
with open(corpus) as fc, open(ts) as ft, open(jv) as fj:
    for lc, lt, lj in zip(fc, ft, fj):
        r = json.loads(lc); t = json.loads(lt); j = json.loads(lj)
        assert r['id'] == t['id'] == j['id']
        key = (r['op'], r['domain'])
        cnt[key + ('rows',)] += 1
        if t.get('read') != j.get('read'):
            diffs['read'].append((r, t, j)); continue
        if not t.get('read'):
            cnt[key + ('unreadable-both',)] += 1; continue
        if r['op'] == 'one':
            if t.get('ok') != j.get('ok'):
                diffs['accept'].append((r, t, j)); continue
            if t['ok']:
                cnt[key + ('accepted-both',)] += 1
                for f in ('rid', 'task', 'start'):
                    if t.get(f) != j.get(f):
                        diffs[f].append((r, t, j))
                if t.get('startParsed') != t.get('start'):
                    diffs['ts-start-raw-vs-parsed'].append((r, t, j))
                if t['start']: cnt[key + ('start-both',)] += 1
            else:
                cnt[key + ('refused-both',)] += 1
                if j.get('cls') not in ('InvalidRecordException',):
                    diffs['java-nonvalidation-exception'].append((r, t, j))
                if t.get('cls') != 'ManagedSessionRecordError':
                    diffs['ts-nonvalidation-exception'].append((r, t, j))
                if norm(t['err']) != norm(j['err']):
                    k = (norm(t['err'])[:90], norm(j['err'])[:90]); msgdiff[k] += 1; msgex.setdefault(k, r['id'])
        else:
            ts_s, j_s = t.get('succ'), j.get('succ')
            if isinstance(ts_s, str) or isinstance(j_s, str):
                diffs['succ-throw'].append((r, t, j))
            if ts_s != j_s:
                diffs['succ'].append((r, t, j)); continue
            if t.get('succParsed') not in ('n/a', ts_s):
                diffs['ts-succ-raw-vs-parsed'].append((r, t, j))
            cnt[key + ('succ-' + str(ts_s),)] += 1
for k in sorted(cnt): print('\t'.join(map(str, k)), cnt[k])
print('VERDICT-DIFFS', {k: len(v) for k, v in diffs.items()})
for k, v in diffs.items():
    for r, t, j in v[:3]:
        print('---', k, r['id'], r['op'], r['domain']); print(' A', r['a'][:600]);
        if r['b']: print(' B', r['b'][:600])
        print(' TS', json.dumps(t)[:300]); print(' JV', json.dumps(j)[:300])
print('MESSAGE-DIFFS (refused both, different clause):', sum(msgdiff.values()), 'rows in', len(msgdiff), 'distinct pairs')
for k, n in msgdiff.most_common(40): print(n, '|TS:', k[0], '|JV:', k[1], '| e.g.', msgex[k])
