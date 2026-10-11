import sys,glob,xml.etree.ElementTree as ET
tot={'tests':0,'failures':0,'errors':0,'skipped':0}; classes=0; bad=[]; it=[0,0]; pr=[0,0]
PR=('ToolPublication','Issue13181QueryBudget','WorkspaceMigrationMySqlIT')
for f in sorted(glob.glob(sys.argv[1]+'/TEST-*.xml')):
    r=ET.parse(f).getroot(); classes+=1; name=r.get('name').split('.')[-1]
    for k in tot: tot[k]+=int(r.get(k) or 0)
    n=int(r.get('tests') or 0); nf=int(r.get('failures') or 0)+int(r.get('errors') or 0)
    if name.endswith('IT'): it[0]+=n; it[1]+=nf
    if name.startswith(PR): pr[0]+=n; pr[1]+=nf
    for tc in r.iter('testcase'):
        for k in ('failure','error'):
            e=tc.find(k)
            if e is not None: bad.append(f"   {k.upper()} {name}#{tc.get('name')}: {(e.get('message') or '')[:220]}")
print(f"classes={classes} " + ' '.join(f"{k}={v}" for k,v in tot.items()) + f" | ITs: {it[0]} run, {it[1]} failed | PR-touched classes: {pr[0]} run, {pr[1]} failed")
print('\n'.join(bad) if bad else '   no failures')
