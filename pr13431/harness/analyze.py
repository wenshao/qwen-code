#!/usr/bin/env python3
"""Summarise rig-probe logs: python3 analyze.py <probe out dir> [label]"""
import collections
import glob
import json
import os
import re
import sys

STORE = re.compile(r'/internal/managed-(?:session-store|tool-publications)/')

out = sys.argv[1]
label = sys.argv[2] if len(sys.argv) > 2 else out
drivers = collections.OrderedDict()
for path in sorted(glob.glob(os.path.join(out, '*.jsonl'))):
    driver = os.path.basename(path).split('.')[0]
    d = drivers.setdefault(driver, {
        'daemons': 0, 'store_resp': 0, 'keepalive': collections.Counter(),
        'reuse': [], 'store_sends': 0, 'new_conn_sends': 0,
        'close': collections.Counter(), 'close_idle': collections.defaultdict(list),
        'errors': [], 'lags': 0,
    })
    store_socks = set()
    last_path = {}
    def is_store(e):
        if e.get('path') is not None:
            return bool(STORE.search(e['path']))
        if e['ev'] == 'resp':
            return bool(STORE.search(last_path.get(e.get('sock'), '')))
        return e.get('sock') in store_socks
    for line in open(path):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        ev = e['ev']
        if ev == 'send':
            last_path[e['sock']] = e.get('path') or ''
        if ev == 'start':
            d['daemons'] += 1
        elif ev == 'resp' and is_store(e):
            d['store_resp'] += 1
            d['keepalive'][e.get('keepAlive')] += 1
        elif ev == 'send' and is_store(e):
            d['store_sends'] += 1
            store_socks.add(e['sock'])
            if e.get('idle') is None:
                d['new_conn_sends'] += 1
            else:
                d['reuse'].append(e['idle'])
        elif ev == 'close' and is_store(e):
            d['close'][e['closedBy']] += 1
            if e.get('idleAtClose') is not None:
                d['close_idle'][e['closedBy']].append(e['idleAtClose'])
        elif ev == 'error':
            e['store'] = is_store(e)
            d['errors'].append(e)
        elif ev == 'lag':
            d['lags'] += 1

def q(values, p):
    if not values:
        return None
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p * (len(values) - 1))))]

print(f'== {label}')
summary = {}
for driver, d in drivers.items():
    reuse = d['reuse']
    row = {
        'daemons': d['daemons'],
        'storeResponses': d['store_resp'],
        'keepAliveSeen': dict(d['keepalive']),
        'storeSends': d['store_sends'],
        'reuses': len(reuse),
        'reuseIdleMaxMs': max(reuse) if reuse else None,
        'reuseIdleOver3s': sum(1 for v in reuse if v > 3000),
        'reuseIdleOver5s': sum(1 for v in reuse if v > 5000),
        'closedBy': dict(d['close']),
        'clientCloseIdleMedianMs': q(d['close_idle']['client'], 0.5),
        'serverCloseIdleMedianMs': q(d['close_idle']['server'], 0.5),
        'storeErrors': [
            f"{x.get('code')} {x.get('message')[:60]} idle={x.get('idle')} {x.get('method')} {x.get('path','')[-40:]}"
            for x in d['errors'] if x.get('store')
        ],
        'otherErrors': len([x for x in d['errors'] if not x.get('store')]),
        'lagInjections': d['lags'],
    }
    summary[driver] = row
    print(driver, json.dumps(row))
json.dump(summary, open(os.path.join(out, 'summary.json'), 'w'), indent=2)
