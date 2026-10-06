#!/usr/bin/env python3
"""Classifies the remote mutant sweep: killed = any failing test beyond the control's environmental failure."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, '/root/verify/pr13330/mut')
from mutants import M  # noqa: E402

LOGS = Path('/root/verify/pr13330/remote-logs')
FAIL = re.compile(r'^\[ERROR\] (com\.alibaba\.qwen\.code\.\S+?)\.(\w+)(?:\(.*?\))? -- Time elapsed: .*<<< (FAILURE|ERROR)!')


def failures(log):
    found = set()
    text = (LOGS / log).read_text(errors='replace')
    for line in text.splitlines():
        m = FAIL.match(line)
        if m:
            found.add(m.group(1).rsplit('.', 1)[-1] + '#' + m.group(2))
    total = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: \d+$', text, re.M)
    compiled = 'COMPILATION ERROR' not in text
    return found, total[-1] if total else None, compiled


control, control_total, _ = failures('m00.log')
rows = []
for mid, rel, old, new, desc in M:
    found, total, compiled = failures(f'{mid}.log')
    extra = sorted(found - control)
    rows.append({'id': mid, 'file': rel.split('/')[-1], 'desc': desc, 'killed_by': extra,
                 'killed': bool(extra) or not compiled, 'total': total, 'compiled': compiled})
summary = {'control_failures': sorted(control), 'control_total': control_total, 'mutants': rows}
for name in ('fix-full.log', 'negctl.log', 'base-defaulton.log'):
    if (LOGS / name).exists():
        found, total, compiled = failures(name)
        summary[name] = {'failures': sorted(found), 'total': total, 'compiled': compiled}
json.dump(summary, open('/root/verify/pr13330/results/mutation.json', 'w'), indent=1)
for row in rows:
    print(row['id'], 'KILLED' if row['killed'] else 'SURVIVED', row['desc'], '|', ', '.join(row['killed_by'])[:200])
print('control', control, control_total)
for name in ('fix-full.log', 'negctl.log', 'base-defaulton.log'):
    print(name, summary.get(name))
