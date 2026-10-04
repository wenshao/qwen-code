import re,glob,os,collections
rows=[]
for f in sorted(glob.glob('logs2/q*-arm*-*.log')):
    m=re.match(r'logs2/q(\d+)-(arm\w+)-(\d+)\.log$',f)
    if not m: continue
    q,arm,rep=m.groups()
    txt=re.sub(r'\x1b\[[0-9;]*m','',open(f).read())
    meta=open(f+'.meta').read() if os.path.exists(f+'.meta') else ''
    rc=re.search(r'EXIT=(\d+)',meta); rc=rc.group(1) if rc else '?'
    fail=re.search(r'FAIL .*?> (.*)\n(\w*Error[^\n]*)',txt)
    msg=fail.group(2)[:90] if fail else ''
    rows.append((int(q),arm,int(rep),rc,msg))
agg=collections.defaultdict(lambda:[0,0])
for q,arm,rep,rc,msg in rows:
    agg[(q,arm)][0]+=1; agg[(q,arm)][1]+= rc!='0'
    if rc!='0': print(f'q={q}% {arm} rep{rep}: {msg}')
print()
for (q,arm),(n,f) in sorted(agg.items(),key=lambda x:(-x[0][0],x[0][1])): print(f'q={q}% {arm:10} fail {f}/{n}')
for q in (5,3,2,1):
    p=f'logs2/settle-q{q}.txt'
    if os.path.exists(p):
        v=sorted(int(x) for x in open(p).read().split())
        print(f'settle q={q}%: n={len(v)} min={v[0]} median={v[len(v)//2]} max={v[-1]} all={v}')
