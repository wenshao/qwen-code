import json, subprocess, shutil, hashlib, os, sys, time
exec(open('/root/verify/pr12258-r2/mutants.py').read())
import os as _o
BROAD={'M3':['src/tools','src/config'],'M10':['src/serve'],'M11':['src'],'M12':['src'],'M14':['src/acp-integration']}
if _o.environ.get('BROAD'):
    M=[(a,b,c,d,e,BROAD[a.split()[0]]) for (a,b,c,d,e,f) in M if a.split()[0] in BROAD]
W='/root/verify/pr12258-r2/head'; O='/root/verify/pr12258-r2/mutation' + ('-broad' if os.environ.get('BROAD') else ''); os.makedirs(O, exist_ok=True)
only = sys.argv[1:] 
res=[]
for mid, f, old, new, pkg, tests in M:
    if only and mid.split()[0] not in only: continue
    p=os.path.join(W,f); src=open(p).read(); h=hashlib.sha256(src.encode()).hexdigest()
    n=src.count(old)
    if n!=1: res.append({'id':mid,'error':f'occurrences={n}'}); print(mid,'SKIP occ',n); continue
    shutil.copy(p, p+'.bak')
    open(p,'w').write(src.replace(old,new))
    out=f"{O}/{mid.split()[0]}.json"
    t=time.time()
    r=subprocess.run(['npx','vitest','run',*tests,'--reporter=json',f'--outputFile={out}'],cwd=os.path.join(W,pkg),capture_output=True,text=True,env={**os.environ,'CI':'true'},timeout=1200)
    shutil.move(p+'.bak', p)
    assert hashlib.sha256(open(p).read().encode()).hexdigest()==h, 'restore failed '+p
    try:
        d=json.load(open(out)); failed=[a['fullName'] for tr in d['testResults'] for a in tr['assertionResults'] if a['status']=='failed']
        row={'id':mid,'file':f,'tests':tests,'passed':d['numPassedTests'],'failed':d['numFailedTests'],'killed':d['numFailedTests']>0 or not d['success'],'failedNames':failed[:6],'secs':round(time.time()-t)}
    except Exception as e:
        row={'id':mid,'error':'no json '+str(e),'stderr':r.stderr[-800:]}
    res.append(row); print(json.dumps(row)[:400], flush=True)
    json.dump(res, open(f'{O}/summary{"-"+"-".join(only) if only else ""}.json','w'), indent=1)
st=subprocess.run(['git','status','--porcelain'],cwd=W,capture_output=True,text=True).stdout
print('git status porcelain:', repr(st[:500]))
