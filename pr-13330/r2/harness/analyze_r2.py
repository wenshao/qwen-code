#!/usr/bin/env python3
"""Round-2 sweep: killed = a failing test beyond the unmutated control's, or a compile failure."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, '/root/verify/pr13330/mut2')
from mutants_r2 import M  # noqa: E402

LOGS = Path('/root/verify/pr13330/remote-logs-r2')
FAIL = re.compile(r'^\[ERROR\] (com\.alibaba\.qwen\.code\.\S+?)\.(\w+)(?:\(.*?\))?(?:\[\d+\])? -- Time elapsed: .*<<< '
                  r'(FAILURE|ERROR)!')
TOTAL = re.compile(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)$', re.M)


def failures(log):
    text = (LOGS / log).read_text(errors='replace')
    found = set()
    for line in text.splitlines():
        m = FAIL.match(line)
        if m:
            found.add(m.group(1).rsplit('.', 1)[-1] + '#' + m.group(2))
    total = TOTAL.findall(text)
    return found, (total[-1] if total else None), 'COMPILATION ERROR' not in text


FLAKY = {'RuntimeBrokerDefaultOnTest#defaultCombinationBootsWithTheYmlDefaultsBound',
         'HarnessCoordinatorTest#runningOwnerObservesCancellationAfterStreamingStarts'}
control, control_total, _ = failures('m00.log')
rows = []
for mid, rel, old, new, desc in M:
    found, total, compiled = failures(f'{mid}.log')
    extra = sorted(found - control - FLAKY)
    rows.append({'id': mid, 'file': rel.split('/')[-1], 'desc': desc, 'killed_by': extra,
                 'flaky_seen': sorted(found & FLAKY),
                 'killed': bool(extra) or not compiled, 'total': total, 'compiled': compiled})
summary = {'control_failures': sorted(control), 'control_total': control_total, 'mutants': rows}
for name in ('base2', 'nc-r3', 'nc-base2'):
    found, total, compiled = failures(f'{name}.log')
    summary[name] = {'failures': sorted(found - FLAKY), 'flaky_seen': sorted(found & FLAKY), 'total': total,
                     'compiled': compiled}
json.dump(summary, open('/root/verify/pr13330/results/mutation-r2.json', 'w'), indent=1)
for row in rows:
    print(row['id'], 'KILLED' if row['killed'] else 'SURVIVED', row['desc'], '|', row['total'], '|',
          ', '.join(row['killed_by'])[:220])
print('control', control, control_total)
for name in ('base2', 'nc-r3', 'nc-base2'):
    print(name, summary[name])
