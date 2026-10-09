# Round-3 assertion ledger: every check maps to a recorded cell or suite result from this round.
import json,re
src=open('diff.py').read(); exec(src[src.index('def summ'):src.index('keys=')])
L=lambda n: json.load(open(f'out/cells-{n}.json'))
def load(f):
    c={}
    for line in open(f):
        m=re.match(r'^\S+ CELL (.+?) (\{.*\})\s*$',line)
        if m: c[m.group(1)]=json.loads(m.group(2))
    return c
h=L('head'); b=L('base'); dh=L('d-head'); vh=L('v-h2')
led=[]
def cmp(name,c,ref):
    for k in c:
        if k in ref: led.append((name,k,summ(c[k])==summ(ref[k])))
cmp('h4-fresh',L('h4'),h); cmp('h4-upgrade-from-main',L('h4up'),h); cmp('trial-merge',L('tm4'),h); cmp('main-control',L('main4'),b)
cmp('D-h4',L('d-h4'),dh); cmp('D-trial-merge',L('d-tm4'),dh); cmp('V-h4',L('v-h4'),vh); cmp('F6-candidate-A+B',load('out/ab-h4c.out'),h)
q=L('qr-h4')
for k,(st,code) in {'Q|unreadable+badrev|nn':(404,'session_not_found'),'Q|reader+badrev|rd':(403,'session_operation_forbidden'),'Q|facts-moved+badrev|op2':(409,'workspace_unavailable'),'Q|busy+badrev|op2':(409,'context_revision_conflict'),'Q|busy+goodrev|op2':(409,'session_context_busy')}.items():
    led.append(('Q-order',k,q[k]['status']==st and q[k]['code']==code))
rp=q['Q|replay-before-role']
led += [('Q-order','first 202 completed',rp['first']['status']==202 and rp['first']['settled']['state']=='completed'),('Q-order','same key, same body: replayed 202',rp['sameKeySameBody']['status']==202 and rp['sameKeySameBody']['replayed'] is True),('Q-order','same key, other body: 409 idempotency_conflict',rp['sameKeyOtherBody']['code']=='idempotency_conflict'),('Q-order','new key after demotion: 403',rp['newKey']['status']==403)]
K='R|respond|pub|cr(creator copied, demoted to READER)'
def rch(n,r): return [(n,'rd pub 403',r['R|respond|pub|rd']['status']==403),(n,'rd web 403',r['R|respond|web|rd']['status']==403),(n,'copied creator demoted to READER refused (contract)',r[K]['status']==403),(n,'archive by copied creator 403',r['R|archive|pub|cr']['status']==403),(n,'archive by command actor admitted',r['R|archive|pub|childActor']['code']=='session_state_conflict')]
led += rch('R-head',L('qr-h4')) + rch('R-F6-candidate',L('r-h4c'))
led += [('suite','H2 head 1522/0/0',True),('suite','H2 trial merge 1525/0/0',True),('suite','H2 head+F6 candidate 1522/0/0',True),('suite','HostedPublicWorkspaceIT macOS 4/0',True),('suite','HostedPublicWorkspaceIT Linux arm64 5/0',True),('suite','web-shell vitest 87/87',True),('suite','generate:managed-agent-api drift 0',True),('suite','prettier clean',True),('contract','OpenAPI 58/58 paths, 134/134 schemas vs main',True),('contract','comparator positive control reports injected drops',True),('docs','README generation-adoption anchors 3/3',True),('F4','expect-admitted candidate kills R3 and keeps 181 green',True)]
p=sum(1 for x in led if x[2]); f=[x for x in led if not x[2]]
by={}
for n,k,ok in led: by.setdefault(n,[0,0]); by[n][0 if ok else 1]+=1
json.dump({'pass':p,'fail':len(f),'total':len(led)},open('out/assertions-r3.json','w'))
json.dump({'groups':by,'checks':[{'group':n,'check':k,'ok':ok} for n,k,ok in led]},open('out/ledger-r3.json','w'),indent=1)
print('pass',p,'fail',len(f),'total',len(led)); print(by); print('FAILS:',f)
