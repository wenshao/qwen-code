#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13536): TS mutation run on the pr13536-mut worktree.
# For each mutant: patch src (vitest: the PR's 3 suites) and the tsc output in dist (differential
# corpus re-evaluated with ts-eval.mjs, compared row by row with the head verdicts).
import subprocess, sys, json, os, re, shutil
sys.path.insert(0, '/Users/wenshao/git/pr13536-rig')
from mutants import TS
W = '/Users/wenshao/git/pr13536-mut'; R = '/Users/wenshao/git/pr13536-rig'; D = R + '/diff'
SRC = W + '/packages/core/src/managed-runtime/managed-automation-record.ts'
JS = W + '/packages/core/dist/src/managed-runtime/managed-automation-record.js'
src0 = open(SRC).read(); js0 = open(JS).read()
env = {k: v for k, v in os.environ.items() if 'proxy' not in k.lower()}
only = sys.argv[1:]
def jsform(s): return s.replace(' as const', '')
def verdicts(path):
    out = []
    with open(path) as f:
        for l in f:
            t = json.loads(l)
            out.append((t.get('read'), t.get('ok'), t.get('start'), t.get('succ'), t.get('task'), t.get('rid')))
    return out
head = verdicts(D + '/ts-head-corpus.jsonl')
res = open(R + '/results/mut-ts.tsv', 'a')
for mid, old, new in TS:
    if only and mid not in only: continue
    try:
        assert src0.count(old) == 1, mid
        open(SRC, 'w').write(src0.replace(old, new))
        p = subprocess.run(['npx', 'vitest', 'run', 'src/managed-runtime/managed-automation-record.test.ts',
            'src/managed-runtime/managed-extension-projection.test.ts', 'src/managed-runtime/managed-session-authority.extension.test.ts',
            '--coverage.enabled=false'], cwd=W + '/packages/core', capture_output=True, text=True, env=env)
        m = re.search(r'Tests\s+(.*)', p.stdout); tests = m.group(1).strip() if m else 'NO-SUMMARY'
        failed = re.findall(r'(?:✗|×|FAIL)\s+(.*?)(?:\s+\d+ms)?$', p.stdout, re.M)
        killed = p.returncode != 0
        jo, jn = jsform(old), jsform(new)
        if js0.count(jo) == 1:
            open(JS, 'w').write(js0.replace(jo, jn))
            q = subprocess.run(['node', '--max-old-space-size=4096', D + '/ts-eval.mjs', W + '/packages/core/dist/src',
                D + '/corpus.jsonl', D + f'/ts-mut-{mid}.jsonl'], capture_output=True, text=True, env=env)
            mv = verdicts(D + f'/ts-mut-{mid}.jsonl')
            changed = sum(1 for a, b in zip(head, mv) if a != b)
            os.remove(D + f'/ts-mut-{mid}.jsonl')
        else:
            changed = 'JS-PATTERN-MISSING'
        line = f'{mid}\t{"KILLED" if killed else "SURVIVED"}\t{tests}\tcorpusRowsChanged={changed}\t{";".join(f[:70] for f in failed[:3])}'
        print(line, flush=True); res.write(line + '\n'); res.flush()
    finally:
        open(SRC, 'w').write(src0); open(JS, 'w').write(js0)
