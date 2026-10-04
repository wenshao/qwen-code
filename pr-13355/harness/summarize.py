import json,sys
for arm in ('base','head'):
    d=json.load(open(f'result-{arm}.json'))
    print('=====',arm)
    for r in d['results']:
        w=r['wire'] or {}
        ro=r['reopen']
        print(f"{r['id']:4} {r['group']:11} wire={w.get('status')} {w.get('code') or ''} | reopen={'OK('+str(ro.get('committed'))+')' if ro['ok'] else 'FAIL'} {('' if ro['ok'] else ro['error'][:120])}")
        if w.get('status') and w.get('status')!=200: print('       msg:', (w.get('message') or '')[:140])
