import re, glob, os
R='/root/verify/pr12522-harness/runs'; M='/root/verify/pr12522-harness/mut'; O='/root/verify/pr12522-harness/figs'
G='\x1b[1;32m'; Rd='\x1b[1;31m'; Y='\x1b[1;33m'; C='\x1b[1;36m'; D='\x1b[2m'; B='\x1b[1m'; Z='\x1b[0m'
def res(path):
    t=open(path).read()
    m=re.search(r'RESULT (.*)', t)
    if not m: return '?'
    r=m.group(1)
    if 'STILL-PENDING' in r: return Rd+'PENDING at 45s'+Z
    if r.startswith('ok'): return G+'ok '+re.search(r'after ([0-9.]+s)',r).group(1)+Z
    s=re.search(r'after ([0-9.]+)s status=(\d+) code=(\S+) retryable=(\S+)',r)
    return (G if s.group(4)=='true' else Y)+f'{s.group(2)} retry={s.group(4)} @{float(s.group(1)):.1f}s'+Z
def parked(path):
    m=re.search(r'readAtMost=(\d+)',open(path).read()); return m.group(1) if m else '?'
def pad(s,n):
    vis=len(re.sub(r'\x1b\[[0-9;]*m','',s)); return s+' '*max(0,n-vis)
L=[]
L.append(B+'PR #12522 @525f223b — attest() against a raw-socket peer that stalls (caller waits 45 s; REQUEST_TIMEOUT = 30 s)'+Z)
L.append(D+'StallProbe.java drives the real HttpRuntimeTransport classes; "parked" = threads blocked in readAtMost after the wait'+Z)
for j in ['21','25']:
    L.append('')
    L.append(C+f'JDK {j}'+Z+'   '+pad(B+'scenario'+Z,22)+pad(B+'cf6a4454 (R1, ofByteArray)'+Z,30)+pad(B+'525f223b (head)'+Z,34)+B+'fix arm (bounded subscriber + deadline)'+Z)
    for sc in ['ok','no-headers','headers-then-stall','partial-body-stall','chunked-stall','drip','503-stall']:
        r1=res(f'{R}/{j}-r1-{sc}.txt'); hd=res(f'{R}/{j}-head-{sc}.txt'); fx=res(f'{R}/{j}-fix-{sc}.txt')
        p=parked(f'{R}/{j}-head-{sc}.txt')
        hd2=hd+(f' {Rd}parked={p}{Z}' if p!='0' else '')
        L.append('         '+pad(sc,22)+pad(r1,30)+pad(hd2,34)+fx)
L.append('')
t=open(f'{R}/21-head-headers-then-stall.txt').read()
L.append(B+'head, where the thread is parked (JDK 21):'+Z)
for l in t.splitlines():
    if 'PARKED' in l or ' at ' in l: L.append(Y+l+Z)
open(f'{O}/fig1-stall-matrix.ansi','w').write('\r\n'.join(L)+'\r\n')

# fig2 pool
L=[B+'Repeated stalls on one JVM (JDK 21 unless noted; this host: 16 CPUs → commonPool parallelism 15): then one healthy attest + one unrelated supplyAsync'+Z,
   D+'each stalled call is abandoned by its caller after a few seconds; peers never finish the body'+Z,'']
L.append(pad(B+'arm'+Z,53)+pad(B+'stalled calls'+Z,15)+pad(B+'parked'+Z,9)+pad(B+'pool size'+Z,11)+pad(B+'healthy attest'+Z,33)+B+'unrelated supplyAsync'+Z)
def row(label,f,n):
    t=open(f).read()
    h=re.search(r'FOLLOWUP healthy call on same transport:? (.*)',t).group(1)
    u=re.search(r'FOLLOWUP unrelated CompletableFuture.supplyAsync:? (.*)',t).group(1)
    ps=re.search(r'poolSize=(\d+)',t).group(1); pk=re.search(r'readAtMost=(\d+)',t).group(1)
    col=lambda s:(G+s+Z) if s.startswith('ok') else (Rd+s+Z)
    L.append(pad(label,53)+pad(str(n),15)+pad(pk,9)+pad(ps,11)+pad(col(h),33)+col(u))
for n in [1,100,250,265,270,271,275,290,400]: row('525f223b head',f'{R}/thr-head-{n}.txt',n)
row('525f223b head, JDK 25',f'{R}/thr-head-300-jdk25.txt',300)
row('525f223b head, -XX:ActiveProcessorCount=4',f'{R}/thr-head-300-cpu4.txt',300)
row('525f223b head, -XX:ActiveProcessorCount=2 *',f'{R}/thr-head-300-cpu2.txt',300)
L.append('')
for n in [270,275,400]: row('cf6a4454 (R1, ofByteArray)',f'{R}/thr-r1-{n}.txt',n)
L.append('')
row("review option 1: result.orTimeout (2 s, not 40 s)",f'{R}/armA-300.txt',300)
row('fix arm (bounded subscriber + deadline)',f'{R}/thr-fix-400.txt',400)
L.append('')
t=open(f'{R}/armA-1.txt').read()
L.append(B+'review option 1, single stalled call: '+Z+Rd+re.search(r'RESULT (.*)',t).group(1).strip()+Z+'  '+Rd+'parked='+re.search(r'readAtMost=(\d+)',t).group(1)+Z)
t=open(f'{R}/F01-1.txt').read()
L.append(B+'review option 2 (bounded subscriber, no deadline): '+Z+Rd+re.search(r'RESULT (.*)',t).group(1).strip()+Z)
L.append(D+'* ≤2 CPUs: no commonPool, CompletableFuture falls back to thread-per-task → every stall leaks one platform thread, no ceiling'+Z)
L.append(B+'socket state 3 s after the 30 s deadline (20 stalled calls):'+Z)
L.append('   head      client 20 ESTAB        server 20 ESTAB')
L.append('   R1        client 20 ESTAB        server 20 ESTAB')
L.append('   '+G+'fix arm   client 20 FIN-WAIT-2   server 20 CLOSE-WAIT  (client closed the connection)'+Z)
open(f'{O}/fig2-pool.ansi','w').write('\r\n'.join(L)+'\r\n')

# fig3 e2e
L=[B+'Real `node dist/cli.js managed-runtime-worker` (bundle built from 525f223b) ← Java HttpRuntimeTransport (head classes)'+Z,'']
for f,title in [(f'{R}/e2e-head-21.txt','JDK 21'),(f'{R}/e2e-head-25.txt','JDK 25 (summary)'),(f'{R}/e2e-fix-21.txt','fix arm, JDK 21 (summary)')]:
    t=[l for l in open(f).read().splitlines() if not l.startswith('WARNING')]
    L.append(C+'── '+title+Z)
    if 'summary' in title:
        L.append('   '+[l for l in t if l.startswith('SUMMARY')][0]+'   keep-alive '+str(sum(int(re.match(r'\s+(\d+)x',l).group(1)) for l in t if re.match(r'\s+\d+x gap',l)))+'/70 ok')
        continue
    for l in t:
        if l.startswith('PASS'): l=G+'PASS'+Z+l[4:]
        elif l.startswith('FAIL'): l=Rd+'FAIL'+Z+l[4:]
        if re.match(r'\s+\d+x gap',l): continue
        L.append(l)
    L.append('   keep-alive boundary (worker keepAliveTimeout 1000 ms, gaps 0–1500 ms × 5): '+G+str(sum(int(re.match(r'\s+(\d+)x',l).group(1)) for l in t if re.match(r'\s+\d+x gap',l) and l.rstrip().endswith('ok')))+'/70 ok'+Z)
L.append('')
L.append(C+'── surviving unit-test mutants replayed against the real worker'+Z)
for m in ['M03','M04','M11','M12']:
    t=open(f'{R}/e2e-{m}.txt').read()
    bad=[l for l in t.splitlines() if l.startswith('FAIL')]
    for l in bad: L.append(f'   {m}  '+Rd+'FAIL'+Z+l[4:])
open(f'{O}/fig3-e2e.ansi','w').write('\r\n'.join(L)+'\r\n')

# fig4 mutants
def parse(f):
    d={}
    for l in open(f):
        m=re.match(r'(\w\d\d) (\S+)\s+(.*?)\s{2,}',l)
        if m: d[m.group(1)]=(m.group(2),m.group(3))
    return d
a=parse(f'{M}/mut-head.txt'); b=parse(f'{M}/mut-tests.txt'); c=parse(f'{M}/mut-fix.txt')
L=[B+'Mutation sweep on HttpRuntimeTransport.java (mvn test -Dtest=HttpRuntimeTransportTest,ManagedRuntimeAttestationConformanceTest, JDK 21)'+Z,'']
L.append(pad(B+'id'+Z,6)+pad(B+'mutant'+Z,42)+pad(B+'PR tests'+Z,12)+pad(B+'+ follow-up tests'+Z,20)+B+'fix arm'+Z)
col=lambda s:{'KILLED':G+'killed'+Z,'SURVIVED':Rd+'SURVIVED'+Z,'N/A':D+'n/a'+Z}.get(s,s)
for k in sorted(c, key=lambda k:(k[0]=='F',k)):
    if k=='M00': continue
    desc=(c.get(k) or a.get(k))[1]
    L.append(pad(k,6)+pad(desc,42)+pad(col(a[k][0]) if k in a else D+'-'+Z,12)+pad(col(b[k][0]) if k in b else D+'-'+Z,20)+col(c[k][0]))
ka=sum(1 for k in a if k!='M00' and a[k][0]=='KILLED'); kb=sum(1 for k in b if k!='M00' and b[k][0]=='KILLED'); kc=sum(1 for k in c if k!='M00' and c[k][0]=='KILLED')
L.append('')
L.append(B+f'killed: PR tests {ka}/30   + follow-up tests {kb}/30   fix arm {kc}/33 (M17 n/a)'+Z+D+'   M23 equivalent (RuntimeAttestation rejects epoch 0), M30 needs a 30 s wait, F02 only visible to the socket probe'+Z)
open(f'{O}/fig4-mutants.ansi','w').write('\r\n'.join(L)+'\r\n')
print('ok')
