# VERIFICATION RIG ONLY (PR #13505 round 4): verdict/clause changes between two versions of the same language.
import json, sys, collections
corpus, a_f, b_f, label = sys.argv[1:5]
vc = collections.Counter(); ex = {}; cc = collections.Counter(); cex = {}
with open(corpus) as fc, open(a_f) as fa, open(b_f) as fb:
    for lc, la, lb in zip(fc, fa, fb):
        a = json.loads(la); b = json.loads(lb)
        if a.get('read') != b.get('read'): k=('read', '?'); vc[k]+=1; continue
        if not a.get('read'): continue
        r = json.loads(lc)
        body = json.loads(r['a'])
        kind = body.get('kind', '?') if isinstance(body, dict) and r['domain']=='child_run' else r['domain']
        if r['op'] == 'one':
            if a.get('ok') != b.get('ok'):
                k = (r['op'], kind, 'accept->refuse' if a.get('ok') else 'refuse->accept', (b.get('err') or a.get('err') or '')[:70])
                vc[k] += 1; ex.setdefault(k, r['id'])
            elif a.get('ok') and (a.get('start') != b.get('start') or a.get('task') != b.get('task') or a.get('rid') != b.get('rid')):
                k = (r['op'], kind, 'start/task/rid', ''); vc[k]+=1; ex.setdefault(k, r['id'])
            elif not a.get('ok') and a.get('err') != b.get('err'):
                k = (kind, (a.get('err') or '')[:60], (b.get('err') or '')[:60]); cc[k]+=1; cex.setdefault(k, r['id'])
        else:
            if a.get('succ') != b.get('succ'):
                k = (r['op'], kind, f"succ {a.get('succ')}->{b.get('succ')}", ''); vc[k]+=1; ex.setdefault(k, r['id'])
print(f'[{label}] VERDICT CHANGES:', sum(vc.values()))
for k, n in vc.most_common(40): print(' ', n, k, ex.get(k))
print(f'[{label}] CLAUSE-ONLY CHANGES (both refuse, different message):', sum(cc.values()))
for k, n in cc.most_common(30): print(' ', n, k, cex.get(k))
