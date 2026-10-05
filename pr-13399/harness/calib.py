#!/usr/bin/env python3
"""Calibrate local CPU quotas against the failing main-CI run (job 111443483838):
per-test duration ratio CI/local over the approval tests that PASSED in both."""
import re, statistics, sys, json
def parse(p, filename):
    d = {}; on = False
    for raw in open(p, encoding='utf-8', errors='replace'):
        l = re.sub(r'\x1b\[[0-9;]*m', '', raw.rstrip('\n'))
        if re.match(r'\d{4}-\d\d-\d\dT', l): l = l[29:]
        if re.search(re.escape(filename) + r' \(\d+ tests', l): on = True; continue
        if on:
            m = re.match(r'\s+([✓×]) (.*?) +(\d+)ms(?: \(retry x\d\))?\s*$', l)
            if m:
                if m.group(1) == '✓': d[m.group(2)] = int(m.group(3))
            elif re.match(r'\s+(→|↓)', l): continue
            else: on = False
    return d
ci = parse('ci/job.log', 'hosted-workspace-tool-turn.test.ts')
out = {}
for q in ['0', '5', '3', '2', '1.5', '1']:
    loc = parse(f'runs/probe/q{q}-r1.log', 'hosted-workspace-tool-turn.armprobe.test.ts')
    common = [k for k in loc if k in ci]
    ratios = [ci[k] / loc[k] for k in common if loc[k] > 0]
    out[q] = dict(n=len(common), median_ratio=statistics.median(ratios),
                  local_median=statistics.median(loc[k] for k in common),
                  ci_median=statistics.median(ci[k] for k in common))
    print(f"q{q:>4}: n={len(common)} CI/local median ratio={out[q]['median_ratio']:.2f} local median test={out[q]['local_median']:.0f}ms CI median={out[q]['ci_median']:.0f}ms")
json.dump(out, open('runs/calib.json', 'w'), indent=1)
