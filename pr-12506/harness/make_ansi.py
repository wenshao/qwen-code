import json, re
H='/root/verify/pr12506-harness/'
G='\033[32m'; R='\033[31m'; Y='\033[33m'; C='\033[1;36m'; B='\033[1m'; D='\033[2m'; Z='\033[0m'
def rows(f): return [json.loads(l) for l in open(H+f) if l.startswith('{')]

# Fig 1: Java provisioner lifecycle + happy path
L=[f"{C}PR #12506 @ a92a8fe — real `qwen managed-runtime-worker` driven by a Java ProcessBuilder provisioner{Z}",
   f"{D}ProcessBuilder(node dist/cli.js managed-runtime-worker) → write boot on stdin → close → readLine() → JDK HttpClient attest → Process.destroy(){Z}",""]
for l in open(H+'java-provisioner-a92a.txt').read().strip().split('\n'):
    l=l.replace('attest=200',f'attest={G}200{Z}').replace('staleEpoch=409',f'staleEpoch={Y}409{Z}').replace('exitValue=0',f'exitValue={G}0{Z}')
    l=re.sub(r'^(java=\S+)',lambda m:B+m.group(1)+Z,l)
    L.append(l)
L+=["",f"{C}Node harness, same bundle (dist/cli.js) — happy path{Z}"]
for r in rows('e2e-bundle-a92a.jsonl')[:2]:
    L.append(f"{B}{r['case']:<14}{Z} ready in {r['readyMs']} ms  stdout lines={r['stdoutLines']}  token in stdout/stderr={G}{r['tokenInStdout']}/{r['tokenInStderr']}{Z}")
    L.append(f"   ready keys: {r['readyKeys']}   url={r['url']}")
    L.append(f"   attest {G}{r['attest']}{Z}   wrong token {r['wrongToken']}   GET /health {r['get404']}   ?x=1 → {r['query']}")
    L.append(f"   signal with keep-alive + idle raw socket open → exit {G}{r['exit']['code']}{Z} after {r['exitMs']} ms")
jp=open(H+'java-probe.txt').read().strip().split('\n')
L+=["",f"{C}JDK default client (HTTP_2 → sends Upgrade: h2c on cleartext) vs HTTP_1_1{Z}"]+[re.sub(r' body=.*','',x).replace('status=200',f'status={G}200{Z}') for x in jp]
open(H+'figs/fig1.ansi','w').write('\n'.join(L)+'\n')

# Fig 2: rejection matrix + deadline
L=[f"{C}Startup rejection matrix — every case under strace -e listen (bundle dist/cli.js @ a92a8fe){Z}",
   f"{B}{'case':<40}{'bytes':>8}  {'exit':<6}{'stdout':<8}{'listen()':<10}{'token leaked':<13}stderr{Z}"]
for r in rows('e2e-bundle-a92a.jsonl')[2:14]:
    ex=r['exit']['code']; st='empty' if not r['stdout'] else 'NONEMPTY'
    L.append(f"{r['case']:<40}{r['bytes']:>8}  {G if ex==1 else R}{ex:<6}{Z}{st:<8}{G if r['listen']==0 else R}{r['listen']:<10}{Z}{str(r['tokenInStderr']):<13}{D}{r['stderr1'].split(' | ')[1][7:]}{Z}")
r=rows('e2e-bundle-a92a.jsonl')[14]
L.append(f"{'exactly 32 KiB (boundary, whitespace pad)':<40}{r['bytes']:>8}  → ready={G}{r['ready']}{Z}, SIGTERM exit {r['exit']['code']}")
L+=["",f"{C}Extra argv{Z}"]
for r in rows('e2e-bundle-a92a.jsonl')[15:20]:
    ex=r['exit']['code']
    note=f"{Y}prints version (global -v intercept runs first){Z}" if ex==0 else f"{D}{r['stderr1']}{Z}"
    L.append(f"{r['case']:<40}exit {G if ex==1 else Y}{ex}{Z}  listen()={r['listen']}  {note}")
L+=["",f"{C}Boot deadline added in a92a8fe (30 s){Z}"]
for r in rows('deadline-a92a.jsonl'):
    if r['exit']=='KILLED@60s': L.append(f"{r['case']:<40}→ {G}ready at ~25 s{Z}, stays up (harness killed it at 60 s)")
    else: L.append(f"{r['case']:<40}→ exit {G}{r['exit']['code']}{Z} after {r['exitAfterS']} s, listen()={r['listen']}, stdout empty")
L.append(f"{D}previous head f8dd941: 'stdin left open' was still alive after 10 s with no deadline{Z}")
open(H+'figs/fig2.ansi','w').write('\n'.join(L)+'\n')

# Fig 3: mutation
h=json.load(open(H+'mut/summary-head-a92a.json')); f=json.load(open(H+'mut/summary-fix-a92a.json'))
fd={x[0]:x for x in f}
L=[f"{C}Hand mutants on managed-runtime-attestation-worker.ts / cli.ts — PR tests vs PR tests + suggested follow-up{Z}",
   f"{D}dist/ was NOT rebuilt between mutants: the child-process test still kills M01/M10, so it exercises source (src/cli.ts via tsx){Z}",
   f"{B}{'id':<5}{'mutation':<46}{'PR tests @a92a8fe':<20}{'+ follow-up':<14}{Z}"]
for x in sorted(h,key=lambda x:x[0]):
    a=x[2]; b=fd[x[0]][2]
    col=lambda v:(G if v=='KILLED' else R)+v+Z
    L.append(f"{x[0]:<5}{x[1]:<46}{col(a):<29}{col(b)}")
ka=sum(x[2]=='KILLED' for x in h); kb=sum(x[2]=='KILLED' for x in f)
L+=["",f"{B}killed: {ka}/{len(h)} → {kb}/{len(f)}{Z}   {D}M11–M13 = transport hardening (no cheap assertion); M19/M20 equivalent on the CLI path (process.exit(1) follows){Z}"]
open(H+'figs/fig3.ansi','w').write('\n'.join(L)+'\n')

# Fig 4: version skew + orphan
sb=open(H+'skew-base.out').read().strip(); sh=open(H+'skew-head.out').read().strip()
nb=sum(1 for _ in open(H+'skew-base.jsonl')); tb=sum('tok-SECRET-SKEW' in l for l in open(H+'skew-base.jsonl'))
L=[f"{C}Version skew: same command line `qwen managed-runtime-worker < boot.json` against a binary without this PR{Z}",
   f"{D}fake OpenAI endpoint records requests; settings select openai auth; token = tok-SECRET-SKEW-12506{Z}",
   f"{B}base 591c9f4 (pre-PR){Z}: exit 0, stdout {sb!r} — {R}{nb} model requests, token present in {tb}{Z}; also written to $QWEN_HOME/projects/…/chats/<id>.jsonl",
   f"{B}head a92a8fe       {Z}: stdout = ready record, {G}0 model requests{Z}, 0 files written under $QWEN_HOME",
   "",f"{C}Provisioner dies after ready (spawned with pipes, then SIGKILL){Z}"]
for l in open(H+'orphan-pipe-a92a.txt').read().strip().split('\n'):
    L.append(l.replace('alive=true',f'alive={Y}true{Z}').replace('ppid=1',f'ppid={Y}1{Z}'))
L.append(f"{D}stdin was already closed at boot, so the worker has no parent-liveness signal after ready; it keeps its loopback port until someone signals it{Z}")
open(H+'figs/fig4.ansi','w').write('\n'.join(L)+'\n')
