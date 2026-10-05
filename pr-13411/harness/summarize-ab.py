import re,glob,os,collections,json
OUT='/root/verify/pr13411/runs/ab'
res=collections.defaultdict(list)
for f in sorted(glob.glob(f'{OUT}/*-r*.log')):
    m=re.match(r'(base|head)-q(\d+)-r(\d+)\.log',os.path.basename(f)); arm,q,r=m.group(1),int(m.group(2)),int(m.group(3))
    t=re.sub(r'\x1b\[[0-9;]*m','',open(f,errors='replace').read())
    meta=open(f+'.meta').read() if os.path.exists(f+'.meta') else ''
    ex=re.search(r'EXIT=(\d+)',meta)
    tl=re.search(r'([✓×]) Hosted Harness no-tool session > refuses a cold load when a settled file tool outcome is missing from its checkpoint\s+(\d+)ms(?: \(retry x(\d)\))?',t)
    if not tl: res[(arm,q)].append(dict(r=r,state='?',exit=ex and ex.group(1))); continue
    passed=tl.group(1)=='✓'; retries=int(tl.group(3) or 0)
    failed_attempts=retries + (0 if passed else 1)
    attempts=retries+1
    locs=sorted(set(re.findall(r'hosted-harness-session\.(?:armbase\.)?test\.ts:(\d+):\d+',t)))
    kinds=sorted(set(k for k in ['AssertionError','ENOTEMPTY','Test timed out'] if k in t))
    res[(arm,q)].append(dict(r=r,passed=passed,attempts=attempts,failed=failed_attempts,ms=int(tl.group(2)),locs=locs,kinds=kinds,exit=ex and ex.group(1)))
summary=[]
for (arm,q),v in sorted(res.items(),key=lambda x:(-x[0][1],x[0][0])):
    fa=sum(x.get('failed',0) for x in v); at=sum(x.get('attempts',0) for x in v); runs_failed=sum(1 for x in v if not x.get('passed',True))
    print(f"q{q:>2}% {arm}: runs {len(v)}  runs red {runs_failed}  failed attempts {fa}/{at}  locs {sorted(set(l for x in v for l in x.get('locs',[])))}  kinds {sorted(set(k for x in v for k in x.get('kinds',[])))}")
    summary.append(dict(arm=arm,quota=q,runs=v))
json.dump(summary,open(f'{OUT}/summary.json','w'),indent=1)
