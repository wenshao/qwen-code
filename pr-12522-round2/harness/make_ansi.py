import re
R='/root/verify/pr12522-harness/runs'; R2='/root/verify/pr12522-harness/runs2'; M='/root/verify/pr12522-harness/mut'; O='/root/verify/pr12522-harness/figs-r2'
G='\x1b[1;32m'; Rd='\x1b[1;31m'; Y='\x1b[1;33m'; C='\x1b[1;36m'; D='\x1b[2m'; B='\x1b[1m'; Z='\x1b[0m'
def pad(s,n):
    vis=len(re.sub(r'\x1b\[[0-9;]*m','',s)); return s+' '*max(0,n-vis)
def res(path):
    t=open(path).read(); m=re.search(r'RESULT (.*)',t); r=m.group(1)
    if 'STILL-PENDING' in r: return Rd+'PENDING at 45s'+Z
    if r.startswith('ok'): return G+'ok '+re.search(r'after ([0-9.]+s)',r).group(1)+Z
    s=re.search(r'after ([0-9.]+)s status=(\d+) code=(\S+) retryable=(\S+)',r)
    return G+f'{s.group(2)} retry={s.group(4)} @{float(s.group(1)):.1f}s'+Z
L=[B+'PR #12522 round 2 — stall/resource re-check at 075de399 (bounded subscriber + orTimeout + cancel)'+Z,'']
for j in ['21','25']:
    L.append(C+f'JDK {j}'+Z+'   '+pad(B+'scenario'+Z,22)+pad(B+'525f223b (R1 head)'+Z,34)+B+'075de399 (new head)'+Z)
    for sc in ['ok','no-headers','headers-then-stall','partial-body-stall','chunked-stall','drip','503-stall']:
        old=res(f'{R}/{j}-head-{sc}.txt'); p=re.search(r'readAtMost=(\d+)',open(f'{R}/{j}-head-{sc}.txt').read()).group(1)
        if p!='0': old+=f' {Rd}parked={p}{Z}'
        L.append('         '+pad(sc,22)+pad(old,34)+res(f'{R2}/{j}-r2-{sc}.txt'))
    L.append('')
L.append(B+pad('many stalls, then a healthy attest + unrelated supplyAsync',64)+pad('parked',8)+pad('pool',6)+pad('healthy',20)+'supplyAsync'+Z)
def row(label,f):
    t=open(f).read()
    h=re.search(r'FOLLOWUP healthy call on same transport:? (\S+)',t).group(1); u=re.search(r'FOLLOWUP unrelated CompletableFuture.supplyAsync:? (\S+)',t).group(1)
    c=lambda s:(G+'ok'+Z) if s=='ok' else (Rd+s+Z)
    pk=re.search(r'readAtMost=(\d+)',t).group(1) if label.startswith('525f') else 'n/a'
    L.append(pad(label,64)+pad(pk,8)+pad(re.search(r'poolSize=(\d+)',t).group(1),6)+pad(c(h),20)+c(u))
row('525f223b, 400 stalls, JDK 21 (R1)',f'{R}/thr-head-400.txt')
row('075de399, 400 stalls, JDK 21',f'{R2}/thr-r2-400.txt')
row('075de399, 400 stalls, JDK 25',f'{R2}/thr-r2-400-jdk25.txt')
row('525f223b, 300 stalls, -XX:ActiveProcessorCount=2 (R1)',f'{R}/thr-head-300-cpu2.txt')
row('075de399, 300 stalls, -XX:ActiveProcessorCount=2',f'{R2}/thr-r2-300-cpu2.txt')
L.append('')
L.append(B+'socket state for 20 stalled calls (ss, runs2/sock-ss.txt)'+Z)
for l in open(f'{R2}/sock-ss.txt'):
    m=re.match(r'(\S+) (\S+) port=(\d*) server: (.*?) client: (.*)',l.strip())
    if not m or not m.group(3): continue
    name={'deadline@30s':'075de399  after the 30 s deadline','caller-cancel@2s':'075de399  after caller cancel at 2 s','N02-cancel':'mutant N02 (drop exchange.cancel)  after caller cancel','N02-deadline':'mutant N02 (drop exchange.cancel)  after deadline','N07-cancel':'mutant N07 (no cancel propagation) after caller cancel'}[m.group(2)]
    cl=re.sub(r'\s+',' ',m.group(5)).strip(); sv=re.sub(r'\s+',' ',m.group(4)).replace('1 LISTEN','').strip()
    col=G if 'FIN-WAIT' in cl else Rd
    L.append('   '+pad(name,56)+col+'client '+cl+'   server '+sv+Z)
open(f'{O}/fig5-r2-stall.ansi','w').write('\r\n'.join(L)+'\r\n')

def parse(f):
    d={}
    for l in open(f):
        m=re.match(r'(\w\d\d) (\S+)\s+(.*?)\s{2,}',l)
        if m: d[m.group(1)]=(m.group(2),m.group(3))
    return d
a=parse(f'{M}/mut-r2-pr.txt'); b=parse(f'{M}/mut-r2-followup.txt'); c=parse(f'{M}/mut-r2-followup2.txt')
L=[B+'Mutation sweep at 075de399 (JDK 21; mvn test -Dtest=HttpRuntimeTransportTest,ManagedRuntimeAttestationConformanceTest)'+Z,'']
L.append(pad(B+'id'+Z,6)+pad(B+'mutant'+Z,44)+pad(B+'PR tests'+Z,11)+pad(B+'+ R1 follow-up'+Z,16)+B+'+ connection-close test'+Z)
col=lambda s:{'KILLED':G+'killed'+Z,'SURVIVED':Rd+'SURVIVED'+Z}.get(s,s)
for k in sorted(a,key=lambda k:(k[0]=='N',k)):
    if k=='M00' or a[k][0]=='N/A': continue
    L.append(pad(k,6)+pad(a[k][1],44)+pad(col(a[k][0]),11)+pad(col(b[k][0]),16)+col(c[k][0]))
n=lambda d:sum(1 for k in d if k!='M00' and d[k][0]=='KILLED')
L.append('')
L.append(B+f'killed: PR tests {n(a)}/36   + R1 follow-up {n(b)}/36   + connection-close test {n(c)}/36'+Z+D+'   (M17/M29/M30 target code that no longer exists)'+Z)
L.append(D+'survivors: M23, N06, N08 equivalent by construction; N09 = package-private ctor validation only'+Z)
open(f'{O}/fig6-r2-mutants.ansi','w').write('\r\n'.join(L)+'\r\n')
