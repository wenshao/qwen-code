"""Round-2 aggregation over out/r2/*.json (base / pr / fixoff)."""
import json, os
O = '/root/git/h11644/out/r2'
def J(n):
    p = f'{O}/{n}.json'
    return json.load(open(p)) if os.path.exists(p) else None
out = {}
for arm in ('base', 'pr', 'fixoff'):
    s = {}
    d = J(f's1-{arm}')
    if d:
        R = d['reqs']
        c = lambda pred, lo=20000, hi=95000: sum(1 for r in R if lo <= r['t'] < hi and pred(r))
        s['s1'] = {'facets_75s': c(lambda r: r['kind'].startswith('facet:') or r['kind'] == 'skills'),
                   'sidebar_git_75s_beta_gamma': c(lambda r: r['ws'] in ('beta', 'gamma') and r['kind'].startswith('git')),
                   'capabilities_95s': c(lambda r: r['kind'] == 'capabilities', 0, 10**9),
                   'providers_95s': c(lambda r: r['kind'] == 'providers', 0, 10**9),
                   'all_95s': len(R)}
    for key, n in (('s2beta', f's2-{arm}-beta'), ('s2alpha', f's2-{arm}-alpha'), ('s3beta', f's3-{arm}-beta')):
        d = J(n)
        if d: s[key] = {k: {kk: vv for kk, vv in v.items() if kk not in ('items',)} for k, v in d['phase'].items()}
    d = J(f's4-{arm}')
    if d: s['s4'] = {k: v.get('providers') for k, v in d['phases'].items()}
    d = J(f's5-{arm}')
    if d:
        cat = lambda r: r['path'].split('?')[0].endswith(('/config/skills', '/runtime/skills'))
        s['s5_catalog'] = [f"{r['t']}ms {'/'.join(r['path'].split('?')[0].split('/')[-2:])}" for r in d['reqs'] if cat(r)]
        s['s5_options_same'] = d['phases']['firstSlash']['options'] == d['phases']['secondSlash']['options']
    d = J(f's8-{arm}')
    if d: s['s8'] = {'image_kept': bool(d['mockLine'] and '[image' in d['mockLine']), 'cmdReads': len(d['commandReadsAfterSend'])}
    d = J(f's10-{arm}')
    if d: s['s10'] = {'closed_65s': d['phaseA']['git'], 'open_65s': d['phaseB']['git']}
    for key in ('s12', 's13', 's14', 's15'):
        d = J(f'{key}-{arm}')
        if not d: continue
        if key == 's13': d = {k: v for k, v in d.items() if k != 'samples'} | {'firstSample': d['samples'][0], 'lastSample': d['samples'][-1]}
        s[key] = d
    out[arm] = s
json.dump(out, open(f'{O}/summary.json', 'w'), indent=1, ensure_ascii=False)
print(json.dumps(out, indent=1, ensure_ascii=False))
