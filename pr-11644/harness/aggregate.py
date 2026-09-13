"""Aggregate PR vs base scenario JSON into one comparison (out/summary.json + stdout table)."""
import json, os
O = '/root/git/h11644/out'
def J(name):
    p = f'{O}/{name}.json'
    return json.load(open(p)) if os.path.exists(p) else None
rows, summary = [], {}
for arm in ('base', 'pr'):
    s = {}
    s1 = J(f's1-{arm}')
    if s1:
        reqs = s1['reqs']
        def cnt(pred, lo=20000, hi=95000):
            return sum(1 for r in reqs if lo <= r['t'] < hi and pred(r))
        s['s1_facets_75s'] = cnt(lambda r: r['kind'].startswith('facet:') or r['kind'] == 'skills')
        s['s1_facets_by_ws'] = {w: cnt(lambda r, w=w: r['ws'] == w and (r['kind'].startswith('facet:') or r['kind'] == 'skills')) for w in ('alpha', 'beta', 'gamma')}
        s['s1_sidebar_git_75s_beta_gamma'] = cnt(lambda r: r['ws'] in ('beta', 'gamma') and r['kind'].startswith('git'))
        s['s1_git_alpha_75s'] = cnt(lambda r: r['ws'] == 'alpha' and r['kind'].startswith('git'))
        s['s1_first20_facets'] = cnt(lambda r: r['kind'].startswith('facet:') or r['kind'] == 'skills', 0, 20000)
        s['s1_first20_git'] = cnt(lambda r: r['kind'].startswith('git'), 0, 20000)
        s['s1_capabilities_95s'] = cnt(lambda r: r['kind'] == 'capabilities', 0, 10**9)
        s['s1_providers_95s'] = cnt(lambda r: r['kind'] == 'providers', 0, 10**9)
        s['s1_all_95s'] = len(reqs)
    for key, name in (('s2beta', f's2-{arm}-beta'), ('s3beta', f's3-{arm}-beta'), ('s2alpha', f's2-{arm}-alpha')):
        d = J(name)
        if d:
            s[key] = {k: {kk: vv for kk, vv in v.items() if kk not in ('items',)} for k, v in d['phase'].items()}
            if 'detailsText' in d: s[key + '_text'] = d['detailsText']
    for key in ('s4', 's5', 's8', 's9', 's10'):
        d = J(f'{key}-{arm}')
        if not d: continue
        if key == 's4': s['s4'] = {k: {kk: vv for kk, vv in v.items() if kk != 'paths'} for k, v in d['phases'].items()}
        if key == 's5':
            reqs = d['reqs']; cat = lambda r: r['path'].split('?')[0].endswith(('/config/skills', '/runtime/skills'))
            marks = {k: v for k, v in d['phases'].items()}
            # phase windows are not stored; recover them from the recorded order of events
            s['s5'] = {'catalogPaths': [f"{r['t']}ms {r['path'].split('?')[0].split('/')[-2]}/{r['path'].split('?')[0].split('/')[-1]} @{r['ws']}" for r in reqs if cat(r)],
                       'options_first': marks['firstSlash']['options'], 'options_second': marks['secondSlash']['options']}
        if key == 's8': s['s8'] = {'chips': d['attachedChipsBeforeSend'], 'imageMarkerReachedModel': bool(d['mockLine'] and '[image' in d['mockLine']), 'mockLine': (d['mockLine'] or '')[:140], 'commandReads': d['commandReadsAfterSend']}
        if key == 's9': s['s9'] = {k: d[k] for k in ('before', 'firstSample', 'hoverToVisibleMs')}
        if key == 's10': s['s10'] = {'closed_65s': d['phaseA']['git'], 'toggled': d['phaseB']['toggled'], 'open_65s': d['phaseB']['git']}
    summary[arm] = s
json.dump(summary, open(f'{O}/summary.json', 'w'), indent=2, ensure_ascii=False)
print(json.dumps(summary, indent=1, ensure_ascii=False))
