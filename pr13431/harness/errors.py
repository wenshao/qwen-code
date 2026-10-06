import json, glob, os, sys, re
STORE = re.compile(r'/internal/managed-(?:session-store|tool-publications)/')
d = sys.argv[1]
for f in sorted(glob.glob(os.path.join(d, '*.jsonl'))):
    drv = os.path.basename(f).split('.')[0]
    if drv == 'other':
        continue
    lags = []
    for l in open(f):
        e = json.loads(l)
        if e['ev'] == 'lag':
            lags.append(e['t'])
        if e['ev'] == 'send' and STORE.search(e.get('path') or '') and (e.get('idle') or 0) > 5000:
            print(f"{drv:18s} {os.path.basename(f):28s} t={e['t']:>6} REUSE sock={e['sock']} idle={e['idle']} {e['method']} ...{e['path'][-34:]}")
        if e['ev'] == 'error' and STORE.search(e.get('path') or ''):
            print(f"{drv:18s} {os.path.basename(f):28s} t={e['t']:>6} ERROR sock={e['sock']} idle={e['idle']} {e['code']} {e['message'][:24]} {e['method']} ...{e['path'][-34:]}")
    if lags:
        print(f"{drv:18s} {os.path.basename(f):28s} lag at t={lags}")
