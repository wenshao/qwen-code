import json, re, collections
E='/root/verify/pr13304/e2e'
def load(p): return json.load(open(p))
R=lambda c,s: f'\x1b[{c}m{s}\x1b[0m'
B=lambda s: R('1',s); G=lambda s: R('32',s); RED=lambda s: R('31',s); Y=lambda s: R('33',s); C=lambda s: R('36',s); D=lambda s: R('2',s); M=lambda s: R('35',s)
def by(arm, fault, sub=None):
    d = sub or arm
    for r in load(f'{E}/{d}/driver-results.json'):
        if r['fault']==fault: return r
def mysql(d):
    return {r['fault']:r for r in load(f'{E}/{d}/mysql-evidence.json')}
def ops(r): return {o['operation']:o['n'] for o in r['journalOperations']}
db = re.search(r'VERIFY13304_DATABASE \{version=([^,]+), engine=([^}]+)\}', open('/root/verify/pr13304/e2e-head.log').read())
L=[]
L.append(B('PR #13304 · real-topology A/B') + D('  (HostedVerify13304IT — scratch IT, not in the PR)'))
L.append(D(f'Spring Session Store + embedded Runtime Broker + bundled worker + MySQL {db.group(1)} ({db.group(2)}),'))
L.append(D('packaged `qwen serve --profile hosted-harness`; one recording proxy in front of Store and Broker.'))
L.append(D('Arms: same tree, bundle rebuilt with only the 2 production files at base 691a374d vs head 52baa3c1.'))
L.append('')
# ack-loss
L.append(C('── ack-loss ') + D('Broker applies the 1st Shell acknowledgement, the proxy then destroys the reply'))
for arm, sub in (('base','base-ackstate'),('head','head-ackstate')):
    r=by(arm,'ack-loss',sub); full=by(arm,'ack-loss')
    acks=[b for b in r['broker'] if b['op']=='acknowledge']
    tag = RED('BASE 691a374d') if arm=='base' else G('HEAD 52baa3c1')
    first=True
    turn1=[b for b in acks if b['at'] < (r['settledAt'][0] if r['settledAt'] else 1e12)] if arm=='head' else acks
    for i,b in enumerate(turn1):
        lost = '' if b['replyDelivered'] else Y(' · reply destroyed by proxy')
        L.append(f"  {tag if first else ' '*13}  ack #{i+1} → Broker {b['status']} acknowledged={str(b['acknowledged']).lower()} runtime={b['runtimeState']}{lost}")
        first=False
    digs=[a['receiptDigest'] for a in r['acks']][:len(turn1)]
    if len(digs)>1: L.append(' '*15+D(f"  both acks carried the identical receipt (sha256 {digs[0]}…)"))
    m=mysql(sub)['ack-loss']; o=ops(m)
    if arm=='base':
        line=[l for l in r['cliTail'].splitlines() if 'recovery blocked' in l][0]
        line=re.sub(r'turn ([0-9a-f]{8})[0-9a-f-]+', r'turn \1…', line.replace('qwen serve: ',''))
        L.append(' '*15+'  '+RED(line))
    res=r['result']
    rb=res['afterTurn1']['recoveryBlocked']
    L.append(' '*15+f"  status recoveryBlocked={(RED if rb else G)(str(rb).lower())} · journal settleTurn={o.get('settleTurn',0)} · tool rows SETTLED/success={len(m['toolExecutions'])}")
    p2=res['prompt2']
    if p2['status']==409: L.append(' '*15+'  next prompt → '+RED(f"409 {p2['body']['error']}"))
    else: L.append(' '*15+'  next prompt → '+G(f"{p2['status']}")+f" · Shell ran again (proof.txt={res['proofFinal']!r}) · DELETE → {res['finalDelete']}")
L.append(D(f"  (repeatability: head ack-loss passed in 3 separate runs; base blocked in 2 of 2)"))
L.append('')
def tl(r):
    g=collections.OrderedDict()
    for e in r['timeline']:
        k=(e['probe'],e['status'],e.get('error'))
        v=g.setdefault(k,[0,e['sinceSettledMs'],e['sinceSettledMs']]); v[0]+=1; v[2]=e['sinceSettledMs']
    return g
L.append(C('── drain-delete ') + D('at ack time the proxy opens a request on that turn\'s Shell publisher and never'))
L.append(D('   finishes its body, so the publisher drain cannot end; after turn.settled the client sends DELETE /session/:id'))
for arm in ('base','head'):
    r=by(arm,'drain-delete'); tag = RED('BASE 691a374d') if arm=='base' else G('HEAD 52baa3c1')
    first=True
    for (probe,st,err),(n,a,b) in tl(r).items():
        col = G if st==204 else RED
        span = f"{a} ms–{b/1000:.1f} s" if n>1 else f"{a} ms"
        txt=f"{probe} → {col(str(st)+(' '+err if err else ''))}" + (f" ×{n} over {span} after turn.settled" if n>1 else f" at {span} after turn.settled")
        if probe.endswith('released'): txt=f"client drops the held request → DELETE {col(str(st))} {r['timeline'][-1]['at']-r['result']['holdReleasedByClientAt']} ms later"
        elif arm=='head': txt+= ' · held drain still open'
        L.append(f"  {tag if first else ' '*13}  {txt}"); first=False
L.append('')
L.append(C('── drain-overlap ') + D('same held drain; after turn.settled the client submits the next prompt'))
for arm in ('base','head'):
    r=by(arm,'drain-overlap'); tag = RED('BASE 691a374d') if arm=='base' else G('HEAD 52baa3c1')
    first=True; res=r['result']
    for (probe,st,err),(n,a,b) in tl(r).items():
        col = G if st==202 else RED
        span = f"{a} ms–{b/1000:.1f} s" if n>1 else f"{a} ms"
        txt=f"POST /prompt → {col(str(st)+(' '+err if err else ''))}" + (f" ×{n} over {span} after turn.settled" if n>1 else f" at {span} after turn.settled")
        if probe.endswith('released'): txt=f"client drops the held request → POST /prompt {col(str(st))} {[e for e in r['timeline'] if e['probe'].endswith('released')][-1]['at']-res['holdReleasedByClientAt']} ms later"
        L.append(f"  {tag if first else ' '*13}  {txt}"); first=False
    if arm=='head':
        assert res['heldDrainOpenWhenTurn2Settled'] is True
        L.append(' '*15+"  turn 2 ran on its own publisher and settled while turn 1's drain was still held open")
        L.append(' '*15+f"  recoveryBlocked={str(res['afterTurn2']['recoveryBlocked']).lower()} · proof.txt={res['proofFinal']!r} (one effect per turn) · DELETE → {res['finalDelete']}")
L.append('')
rows=[]
for d in ('head','base'):
    for f,m in mysql(d).items():
        rows += [(e['execution_state'],e['execution_status'],e['dispatch_generation']) for e in m['toolExecutions']]
gens=sorted(set(r[2] for r in rows)); states=sorted(set((r[0],r[1]) for r in rows))
assert states==[('SETTLED','success')] and gens==[1]
L.append(D(f"MySQL: all {len(rows)} qwen_tool_execution rows (both full runs) SETTLED/success, dispatch_generation=1"))
L.append(D("→ the replayed acknowledgement and the overlapping drain never re-ran a Shell effect"))
open('/root/verify/pr13304/shots/e2e.ansi','w').write('\r\n'.join(L)+'\r\n')
print('\n'.join(re.sub(r'\x1b\[[0-9;]*m','',l) for l in L))
