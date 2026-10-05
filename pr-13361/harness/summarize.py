#!/usr/bin/env python3
"""Summarise run dirs: arm, knobs, armed javaLoad outcome, fetch rejections, store hits, tags, IT exit."""
import json, os, re, sys, glob
R = '/root/verify/pr13361/runs'
pat = sys.argv[1] if len(sys.argv) > 1 else '*'
rows = []
for d in sorted(glob.glob(f'{R}/{pat}')):
    if not os.path.isfile(f'{d}/result'): continue
    res = open(f'{d}/result').read().split('\n')[0]
    m = dict(re.findall(r'(\w+)=(\S+)', res))
    end = {}
    store = []
    if os.path.exists(f'{d}/store.jsonl'):
        for l in open(f'{d}/store.jsonl'):
            j = json.loads(l)
            if 'javaLoadEnd' in j: end = j
            if j.get('store') and 'kind' in j: store.append(j)
    rej = []
    loaded = ''
    if os.path.exists(f'{d}/fetch.jsonl'):
        for l in open(f'{d}/fetch.jsonl'):
            j = json.loads(l)
            if j.get('fetchRejected'): rej.append(j['chain'][-1])
            if j.get('loaded') and not loaded: loaded = j['argv'][0].split('/pr13361/')[-1]
    tags = []
    if os.path.exists(f'{d}/daemon.log'):
        for l in open(f'{d}/daemon.log', errors='replace'):
            mm = re.search(r'load refused \((\w+)\): (.{0,150})', l)
            if mm: tags.append(f'{mm.group(1)}: {mm.group(2)}')
            if 'Hosted Session open failed' in l: tags.append('open failed: ' + l.split('open failed: ')[1].strip()[:120])
    acts = {}
    for s in store:
        if s['action'] != 'pass': acts[f"{s['kind']}:{s['action']}"] = acts.get(f"{s['kind']}:{s['action']}", 0) + 1
    kinds = {}
    for s in store: kinds[s['kind']] = kinds.get(s['kind'], 0) + 1
    rows.append(dict(run=os.path.basename(d), arm=m.get('arm'), exit=m.get('EXIT'), fault=m.get('VERIFY_FAULT'), at=m.get('VERIFY_FAULT_AT'), stall=m.get('stall'), nth=m.get('nth'),
                     status=end.get('status'), ms=end.get('ms'), body=(end.get('body') or '')[-60:], rejections=len(rej), cause=rej[0] if rej else '',
                     injected=acts, kinds=kinds, tags=tags, cli=loaded))
json.dump(rows, open(f'{R}/summary-{pat.replace("*","all")}.json', 'w'), indent=1)
for r in rows:
    print(f"{r['run']:<28} arm={r['arm']} exit={r['exit']} fault={r['fault']}@{r['at']} stall={r['stall']}/{r['nth']} -> {r['status']} {r['ms']}ms rej={r['rejections']} {r['cause']} inj={r['injected']} kinds={r['kinds']}")
    for t in r['tags']: print('      tag:', t[:200])
