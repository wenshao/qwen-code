#!/usr/bin/env python3
"""PR #13330 R4 — suite/mutation assertions. Reads the local logs/ + data/mut-logs,
prints PASS/FAIL lines and rewrites logs/assertions.json with the combined total."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGS = ROOT / 'logs'
results = []


def check(ok, group, name, detail):
    results.append(('PASS' if ok else 'FAIL', group, name, detail))


def totals(name):
    text = (LOGS / name).read_text(errors='replace')
    m = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)', text)
    exit_ = re.findall(r'^EXIT=(\S+)', text, re.M)
    # surefire prints per-class lines then a reactor summary; take the max total line
    best = max(((int(a), int(b), int(c), int(d)) for a, b, c, d in m), key=lambda t: t[0], default=None)
    fails = re.findall(r'^\[ERROR\] (?:com\.alibaba\.qwen\.code\.[\w.]+\.)?(\w+\.\w+)', text, re.M)
    return best, (exit_[-1] if exit_ else None), sorted(set(fails))


# focused PR-body command at head
t, ex, fails = totals('focused-head.log')
check(t is not None and t[0] == 202 and t[1] == 0 and t[2] == 0 and ex == '0' and not fails,
      'suites', 'focused 8-class command at head (PR body test plan)',
      f'{t} exit={ex} fails={fails} (body says 131 at b5bf5b42)')

# F1 witness alone
t, ex, fails = totals('witness-f1-head.log')
check(t is not None and t[0] == 6 and t[1] == 0 and t[2] == 0 and ex == '0',
      'suites', 'F1 witness acquireOfANewRuntimeSessionIsFencedLikeWarm at head', f'{t} exit={ex}')

# full suites
t, ex, fails = totals('full-head-runtime-broker.log')
check(t is not None and t[0] == 755 and t[1] == 0 and t[2] == 0 and ex == '0',
      'suites', 'runtime-broker full suite at head', f'{t} exit={ex} fails={fails}')
t, ex, fails = totals('full-head-managed-agent-server.log')
non_defaulton = [f for f in fails if 'RuntimeBrokerDefaultOnTest' not in f]
check(t is not None and t[1] == 0 and t[2] == 0 and ex == '0' and not non_defaulton,
      'suites', 'managed-agent-server full suite at head', f'{t} exit={ex} fails={fails}')
check(not any('RuntimeBrokerDefaultOnTest' in f for f in fails),
      'suites', 'head full run free of the known DefaultOn race', f'fails={fails}')
t, ex, fails = totals('full-base-managed-agent-server.log')
non_defaulton = [f for f in fails if 'RuntimeBrokerDefaultOnTest' not in f]
check(t is not None and t[1] == 0 and t[2] == 0 and ex == '0' and not non_defaulton,
      'suites', 'managed-agent-server full suite at base (flake attribution control)', f'{t} exit={ex} fails={fails}')

# mutation sweep
muts = json.loads((LOGS / 'mutation-r4.json').read_text())
by_id = {m['id']: m for m in muts}
m00 = by_id.get('m00')
check(m00 and m00['done'] and not m00['killed'] and m00['totals'] and m00['totals'][1] == '0',
      'mutation', 'm00 unmutated baseline green', f"{m00 and m00['totals']}")
EXPECT_SURVIVE = {'a04': 'equivalent (R3: Broker only calls the two-arg form)',
                  'h03': 'tenant predicate unpinned (R3: deferred by review)'}
for mid in ['a09', 'a05', 'a01', 'a02', 'a03', 'a06', 'a07', 'a08', 'k01', 'f01', 'f02', 'h01', 'h02']:
    m = by_id.get(mid)
    ok = m and m['done'] and m['killed'] and m['killers']
    check(bool(ok), 'mutation', f'{mid} killed', f"{m and m['desc']} killers={m and m['killers'][:3]}")
for mid, why in EXPECT_SURVIVE.items():
    m = by_id.get(mid)
    ok = m and m['done'] and not m['killed']
    check(bool(ok), 'mutation', f'{mid} survives as classified in R3 ({why})',
          f"killed={m and m['killed']} totals={m and m['totals']}")
# a09 must be killed specifically by the F1 witness, 6 cases
a09 = by_id.get('a09')
check(a09 and any('acquireOfANewRuntimeSessionIsFencedLikeWarm' in k for k in a09['killers'])
      and a09['totals'] and a09['totals'][1] == '6',
      'mutation', 'a09 (F1 revert) killed by the F1 witness, all 6 cases',
      f"killers={a09 and a09['killers']} totals={a09 and a09['totals']}")
# a05 (positive control, same file as a09): killed
check(by_id.get('a05', {}).get('killed'), 'mutation',
      'a05 positive control (warm unfenced, same file) killed', f"{by_id.get('a05', {}).get('killers', [])[:2]}")

# merge with the probe assertions
probe = json.loads((LOGS / 'assertions.json').read_text())
npass = probe['pass'] + sum(1 for r in results if r[0] == 'PASS')
nfail = probe['fail'] + sum(1 for r in results if r[0] == 'FAIL')
for status, group, name, detail in results:
    print(f'{status} {group} :: {name} :: {detail}')
print(f'---\ncombined assertions: {npass} pass, {nfail} fail, {npass + nfail} total')
(LOGS / 'assertions.json').write_text(json.dumps({'pass': npass, 'fail': nfail, 'total': npass + nfail}))
sys.exit(1 if nfail else 0)
