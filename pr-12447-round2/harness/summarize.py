#!/usr/bin/env python3
"""summarize.py <manifest.json> <vitest-json> [label] -> killed/survived table."""
import json, sys, re
manifest = json.load(open(sys.argv[1]))
res = json.load(open(sys.argv[2]))
label = sys.argv[3] if len(sys.argv) > 3 else ''
per = {}
for f in res['testResults']:
    m = re.search(r'__mut__/([mx]\d+)/', f['name'])
    if not m: continue
    failed = sum(1 for a in f['assertionResults'] if a['status'] == 'failed')
    total = len(f['assertionResults'])
    per[m.group(1).upper()] = (failed, total, f.get('status'), f.get('message', '')[:120])
killed = survived = 0
out = []
for m in manifest:
    failed, total, status, msg = per.get(m['id'], (None, None, 'missing', ''))
    if m['id'] == 'M00':
        verdict = 'CONTROL-OK' if failed == 0 and total else f'CONTROL-BROKEN {failed}/{total} {msg}'
    elif failed is None:
        verdict = 'NO-RESULT'
    elif failed > 0 or (total == 0 and status == 'failed'):
        verdict = 'killed'; killed += 1
    else:
        verdict = 'SURVIVED'; survived += 1
    out.append((m['id'], m['group'], m['desc'], verdict, f'{failed}/{total}' if failed is not None else '-'))
json.dump(out, open(sys.argv[2].replace('.json', '-summary.json'), 'w'), indent=1)
for row in out:
    print(f'{row[0]}  {row[3]:<10} {row[4]:>6}  [{row[1]}] {row[2]}')
print(f'\n{label} killed {killed}/{killed + survived}, survived {survived}')
