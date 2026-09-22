"""Collect every measured number used by the report and the figures."""
import glob
import json
import os
import re

H = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(H, 'out')


def load(name):
    with open(os.path.join(OUT, name + '.json')) as f:
        return json.load(f)


def posts(d):
    return [e for e in d['events'] if e['what'] == 'api' and e['route'] == '/workspaces' and e['method'] == 'POST']


def step_view(s):
    c = s.get('control') or {}
    sel = c.get('selection')
    return {
        'label': s['label'],
        'status': s.get('status'),
        'enabled': c.get('enabled'),
        'selection': (sel or {}).get('names') if sel else None,
        'workers': [[w['ws'], w['channels'], w['pid']] for w in c.get('workers', [])],
        'peers': {k: [v['connects'], v['open']] for k, v in (s.get('peers') or {}).items()},
    }


facts = {}
for arm in ['base', 'head', 'fix']:
    d = load(f'{arm}-late')
    last = d['steps'][-1]
    facts[f'late_{arm}'] = {
        'post_ms': posts(d)[0]['ms'],
        'post_status': posts(d)[0]['status'],
        'final': step_view(last),
    }

for arm in ['base', 'head', 'fix']:
    d = load(f'{arm}-shared-rereg')
    facts[f'shared_rereg_{arm}'] = [step_view(s) for s in d['steps']]
for arm in ['base', 'head', 'fix']:
    d = load(f'{arm}-shared-fresh')
    facts[f'shared_fresh_{arm}'] = [step_view(s) for s in d['steps']]
for arm in ['head', 'm1', 'fix']:
    d = load(f'{arm}-once-hosted')
    facts[f'once_hosted_{arm}'] = [step_view(s) for s in d['steps']]
for arm in ['head', 'm1', 'base']:
    d = load(f'{arm}-once-multi')
    facts[f'once_multi_{arm}'] = [step_view(s) for s in d['steps']]

race = []
for f in sorted(glob.glob(os.path.join(OUT, 'head-race-g*-r*.json'))):
    d = json.load(open(f))
    rep = int(re.search(r'-r(\d)\.json', f).group(1))
    p = posts(d)
    fin = d['steps'][-1]['control']
    names = sorted((fin.get('selection') or {}).get('names', []))
    running = [w for w in fin['workers'] if w['state'] == 'running']
    race.append({
        'gap': int(d['extra']),
        'rep': rep,
        'post_ms': [x['ms'] for x in p],
        'both_running': names == ['a', 'b'] and len(running) == 2,
        'peers': {k: [v['connects'], v['open']] for k, v in d['steps'][-1]['peers'].items()},
    })
facts['race_head'] = race
facts['race_base'] = []
for g in [0, 250]:
    d = load(f'base-race-g{g}-r1')
    facts['race_base'].append({'gap': g, 'post_ms': [x['ms'] for x in posts(d)],
                               'selection': d['steps'][-1]['control'].get('selection')})

burst = []
for name in ['head-burst-6', 'head-burst-6-b', 'head-burst-6-c']:
    d = load(name)
    fin = d['steps'][-1]
    burst.append({
        'statuses': d['steps'][0]['statuses'],
        'running': sum(1 for w in fin['control']['workers'] if w['state'] == 'running'),
        'peers_open': sum(v['open'] for v in fin['peers'].values()),
    })
# the third burst run overwrote -b; count what is on disk
facts['burst'] = burst

for sc in ['race-stop-150', 'race-delete-30']:
    d = load('head-' + sc)
    facts[sc.replace('-', '_')] = [step_view(s) for s in d['steps'] if 'control' in s]

for arm in ['base', 'head', 'fix']:
    d = load(f'{arm}-bystander')
    facts[f'bystander_{arm}'] = d['steps'][0]

d = load('head-poison')
facts['poison_head'] = {
    'steps': [step_view(s) for s in d['steps']],
    'log': [l for l in open(os.path.join(OUT, 'head-poison.daemon.log')).read().splitlines()
            if re.search(r'registered after boot|hosting is stopped', l)],
}
for arm in ['base', 'head', 'fix']:
    for sc in ['globalstop', 'flag']:
        dd = load(f'{arm}-{sc}')
        facts[f'{sc}_{arm}'] = step_view(dd['steps'][-1])

json.dump(facts, open(os.path.join(H, 'facts.json'), 'w'), indent=1)
print(json.dumps({k: v for k, v in facts.items() if k.startswith(('late_', 'bystander_', 'burst', 'race_base'))}, indent=1)[:3000])
