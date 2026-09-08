#!/usr/bin/env python3
"""Compact per-scenario summary of the rig JSON output."""
import json, sys, glob, os, re

def opts(params):
    try:
        f = json.loads(params.get('form', '{}'))
        return [o['value'] + '=' + o['text'] for o in f['fields'][0]['options']]
    except Exception:
        return []

for path in sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else 'out/*.json')):
    name = os.path.basename(path)[:-5]
    d = json.load(open(path))
    print('=' * 78)
    print(f"{name}  lang={d['language']} permCard={d['permissionCardEnabled']} "
          f"conv={d['convType']} scope={d['sessionScope']} tool={d['tool']} "
          f"timeout={d['permissionTimeoutMs']}")
    if d['scenarioError']:
        print('  !! scenarioError:', d['scenarioError'].splitlines()[0])
    print(f"  permission cards: {d['permissionCardCount']}")
    for c in d['permissionCards']:
        print(f"    - title={c['params'].get('question_title')!r} "
              f"btn={c['params'].get('form_btn_text')!r}")
        print(f"      desc={c['params'].get('question_desc')!r}")
        print(f"      label={json.loads(c['params'].get('form','{}')).get('fields',[{}])[0].get('label')!r}")
        print(f"      options={opts(c['params'])}")
        print(f"      terminal={c['finalStatus']!r} "
              f"desc={c['finalParams'].get('question_desc')!r} "
              f"btn={c['finalParams'].get('form_btn_text')!r}")
    other = [e for e in d['cardEvents']
             if e['type'] == 'create' and 'question_title' not in e.get('params', {})]
    for e in other:
        print(f"  other card create: statusLine={e['params'].get('statusLine')!r}")
    print(f"  sentinel={d['sentinel']!r}")
    if d['writtenProbes']:
        print(f"  writtenProbes={[p['file'] for p in d['writtenProbes']]}")
    for f in d['fallbacks']:
        print(f"  webhook[{f['t']}ms] {f['text']!r}")
    print(f"  modelCalls={[(m['t'], m['toolResults'], m['isProbe']) for m in d['modelCalls']]}")
