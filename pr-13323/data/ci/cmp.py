import re,sys
def parse(p):
    d={}; on=False
    for l in open(p,encoding='utf-8',errors='replace'):
        l=l[29:].rstrip('\n') if re.match(r'\d{4}-\d\d-\d\dT',l) else l
        if 'hosted-harness-session.test.ts (' in l: on=True; continue
        if on:
            m=re.match(r'\s+[✓×] (.*?) +(\d+)ms',l)
            if m: d[m.group(1)]=int(m.group(2))
            else: on=False
    return d
a=parse(sys.argv[1]); b=parse(sys.argv[2])
common=[k for k in a if k in b]
rs=sorted((a[k]/b[k],k,a[k],b[k]) for k in common)
print(len(a),len(b),len(common),'common')
import statistics
print('median ratio', statistics.median(r for r,*_ in rs))
for r,k,x,y in rs: print(f'{r:6.1f}x {x:7d} {y:6d}  {k[:120]}')
