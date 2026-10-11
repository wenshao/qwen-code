import json,sys,collections
S=sys.argv[1]; pkg=sys.argv[2]
def load(a):
    d=json.load(open(f'{S}/full-{pkg}-{a}.json'))
    fails=collections.defaultdict(set); ferr=set(); names={}
    for r in d['testResults']:
        n=r['name'].split('/packages/')[-1]
        names[n]=r['status']
        f=[a['fullName'] for a in r['assertionResults'] if a['status']=='failed']
        for x in f: fails[n].add(x)
        if r['status']=='failed' and not f: ferr.add(n)
    return d,fails,ferr,names
dm,fm,em,nm=load('merge'); dn,fn,en,nn=load('main')
print(f'merge: {dm["numTotalTests"]} tests, {dm["numFailedTests"]} failed; main: {dn["numTotalTests"]} tests, {dn["numFailedTests"]} failed')
onlym=[f for f in sorted(set(fm)|em) if f not in fn and f not in en]
both=[f for f in sorted(set(fm)|em) if f in fn or f in en]
onlyn=[f for f in sorted(set(fn)|en) if f not in fm and f not in em]
print('FILES failing on merge only:'); [print('  ',len(fm.get(f,[])) or 'file-err',f) for f in onlym]
print('FILES failing on both:'); [print('  ',len(fm.get(f,[])),'/',len(fn.get(f,[])),f) for f in both]
print('FILES failing on main only:'); [print('  ',len(fn.get(f,[])) or 'file-err',f) for f in onlyn]
