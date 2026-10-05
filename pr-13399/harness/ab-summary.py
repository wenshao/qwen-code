#!/usr/bin/env python3
"""Summarize runs/ab: per arm x quota -> test failed (after --retry=2) / passed,
attempts used, and the failing assertion + location."""
import re, glob, collections, json, sys
D = sys.argv[1] if len(sys.argv) > 1 else 'runs/ab'
res = collections.defaultdict(list)
for f in sorted(glob.glob(f'{D}/*.log')):
    m = re.match(r'.*/(orig|main|head)-q([\d.]+)-r(\d+)\.log$', f)
    if not m: continue
    arm, q, r = m.groups()
    txt = re.sub(r'\x1b\[[0-9;]*m', '', open(f, errors='replace').read())
    meta = open(f + '.meta').read()
    t = re.search(r'^\s+([✓×]) reports an answer that loses the race to the expiry as expired\s+(\d+)ms(?: \(retry x(\d)\))?', txt, re.M)
    if not t:
        res[(arm, q)].append(dict(r=r, status='?', meta=meta.strip())); continue
    err = re.findall(r'^(AssertionError: .*|Error: Test timed out.*)$', txt, re.M)
    loc = re.findall(r'❯ (src/serve/hosted-workspace-tool-turn[^\s]*:\d+:\d+)', txt)
    res[(arm, q)].append(dict(r=r, status='fail' if t.group(1) == '×' else 'pass',
        ms=int(t.group(2)), retries=int(t.group(3) or 0), err=err[:1], loc=loc[:1],
        exit=(re.search(r'EXIT=(\d+)', meta) or [None,'running'])[1]))
order = {'orig': 0, 'main': 1, 'head': 2}
for (arm, q) in sorted(res, key=lambda k: (-float(k[1]), order[k[0]])):
    rs = res[(arm, q)]
    fails = sum(x['status'] == 'fail' for x in rs)
    attempts_failed = sum((x['retries'] + 1) if x['status'] == 'fail' else x.get('retries', 0) for x in rs)
    attempts = sum(x.get('retries', 0) + 1 for x in rs)
    errs = collections.Counter((x['err'][0][:70] if x.get('err') else '') + ' @' + (x['loc'][0].split(':',1)[1] if x.get('loc') else '') for x in rs if x['status'] == 'fail')
    print(f"q{q:>4} {arm:5}: test failed {fails}/{len(rs)}  failed attempts {attempts_failed}/{attempts}  {dict(errs)}")
json.dump({f'{a}|{q}': v for (a, q), v in res.items()}, open(f'{D}.json', 'w'), indent=1)
