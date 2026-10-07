# VERIFICATION RIG ONLY (PR #13536): for a TS mutant, list the corpus rows whose verdict flips,
# ranked by distance from the fixture template, to pick minimal fixture witnesses.
import subprocess, sys, json, os, re
sys.path.insert(0, '/Users/wenshao/git/pr13536-rig')
from mutants import TS
W = '/Users/wenshao/git/pr13536-mut'; D = '/Users/wenshao/git/pr13536-rig/diff'
JS = W + '/packages/core/dist/src/managed-runtime/managed-automation-record.js'
js0 = open(JS).read(); env = {k: v for k, v in os.environ.items() if 'proxy' not in k.lower()}
fx = json.load(open('/Users/wenshao/git/pr13536-head/packages/core/src/managed-runtime/contracts/managed-automation-record-v1.fixtures.json'))
def rx(s):
    toks = s.replace(' as const', '').split(); p = r'\s*'.join(re.escape(t) for t in toks); return p.replace(r',\s*\)', r',?\s*\)')
def flat(v, p=''):
    if isinstance(v, dict):
        for k in v: yield from flat(v[k], p + '.' + k)
    else: yield p, json.dumps(v)
def dist(a, t):
    A = dict(flat(a)); T = dict(flat(t)); return {k: A.get(k) for k in set(A) | set(T) if A.get(k) != T.get(k)}
head = [json.loads(l) for l in open(D + '/ts-head-corpus.jsonl')]
C = [json.loads(l) for l in open(D + '/corpus.jsonl')]
for mid in sys.argv[1:]:
    old, new = [(o, n) for i, o, n in TS if i == mid][0]
    out, n = re.subn(rx(old), lambda m: new.replace(' as const', ''), js0); assert n == 1
    try:
        open(JS, 'w').write(out)
        subprocess.run(['node', D + '/ts-eval.mjs', W + '/packages/core/dist/src', D + '/corpus.jsonl', D + '/ts-w.jsonl'], env=env, capture_output=True)
    finally: open(JS, 'w').write(js0)
    cands = []
    for r, h, l in zip(C, head, open(D + '/ts-w.jsonl')):
        m = json.loads(l)
        hv = (h.get('ok'), h.get('start'), h.get('succ')); mv = (m.get('ok'), m.get('start'), m.get('succ'))
        if hv == mv: continue
        t = fx['templates'][r['domain']]
        if r['op'] == 'one': d = dist(json.loads(r['a']), t); cands.append((len(d), 'one', d, hv, mv, h.get('err')))
        else:
            da = dist(json.loads(r['a']), t); db = dist(json.loads(r['b']), t); cands.append((len(da) + len(db), 'pair', (da, db), hv, mv, None))
    cands.sort(key=lambda x: (x[0], len(json.dumps(x[2]))))
    print('==', mid, len(cands))
    for c in cands[:3]: print('  ', c[1], json.dumps(c[2])[:300], 'head', c[3], 'mut', c[4], (c[5] or '')[:60])
