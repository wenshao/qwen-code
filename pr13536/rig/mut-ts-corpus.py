#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13536): corpus-equivalence check for TS mutants whose literal pattern
# missed the tsc-formatted dist JS: whitespace-insensitive match (optional trailing commas).
import subprocess, sys, json, os, re
sys.path.insert(0, '/Users/wenshao/git/pr13536-rig')
from mutants import TS
W = '/Users/wenshao/git/pr13536-mut'; D = '/Users/wenshao/git/pr13536-rig/diff'
JS = W + '/packages/core/dist/src/managed-runtime/managed-automation-record.js'
js0 = open(JS).read()
env = {k: v for k, v in os.environ.items() if 'proxy' not in k.lower()}
def rx(s):
    s = s.replace(' as const', '')
    toks = s.split()
    p = r'\s*'.join(re.escape(t) for t in toks)
    return p.replace(r',\s*\)', r',?\s*\)')
def verdicts(path):
    with open(path) as f:
        return [(lambda t: (t.get('read'), t.get('ok'), t.get('start'), t.get('succ'), t.get('task'), t.get('rid')))(json.loads(l)) for l in f]
head = verdicts(D + '/ts-head-corpus.jsonl')
for mid, old, new in TS:
    if sys.argv[1:] and mid not in sys.argv[1:]: continue
    try:
        out, n = re.subn(rx(old), lambda m: new.replace(' as const', ''), js0)
        if n != 1: print(f'{mid}\tJS-MATCH={n}', flush=True); continue
        open(JS, 'w').write(out)
        q = subprocess.run(['node', '--max-old-space-size=4096', D + '/ts-eval.mjs', W + '/packages/core/dist/src', D + '/corpus.jsonl', D + f'/ts-mut-{mid}.jsonl'], capture_output=True, text=True, env=env)
        if q.returncode != 0: print(f'{mid}\tEVAL-FAIL {q.stderr[-300:]}', flush=True); continue
        mv = verdicts(D + f'/ts-mut-{mid}.jsonl')
        print(f'{mid}\tcorpusRowsChanged={sum(1 for a, b in zip(head, mv) if a != b)}', flush=True)
        os.remove(D + f'/ts-mut-{mid}.jsonl')
    finally:
        open(JS, 'w').write(js0)
