import re
X='/root/verify/pr13304'
R=lambda c,s: f'\x1b[{c}m{s}\x1b[0m'
B=lambda s: R('1',s); G=lambda s: R('32',s); RED=lambda s: R('31',s); Y=lambda s: R('33',s); C=lambda s: R('36',s); D=lambda s: R('2',s)
strip=lambda s: re.sub(r'\x1b\[[0-9;]*m','',s)
def grab(path, pat):
    m=re.search(pat, strip(open(path).read()))
    assert m, (path, pat)
    return m
L=[]
L.append(B('PR #13304 · unit witnesses, negative controls, probes')+D('  (Node v22.22.2 · head 52baa3c1 · base 691a374d)'))
u=grab(f'{X}/unit-head.log', r'Test Files\s+(\d+ passed \(\d+\))\s+Tests\s+(\d+ passed \(\d+\))')
L.append(C('$ cd packages/cli && npx vitest run')+' '+D('<the 4 suites named in the PR test plan>'))
L.append(f"  Test Files {G(u.group(1))} · Tests {G(u.group(2))}")
L.append('')
L.append(B('Negative controls')+D(' — one production file restored to base, PR tests kept'))
n1=grab(f'{X}/nc1-broker.log', r'Tests\s+(1 failed \| 33 passed \(34\))')
e1=grab(f'{X}/nc1-broker.log', r'(promise rejected "TypeError: fetch failed" instead of resolving)')
L.append(f"  hosted-workspace-broker.ts  {RED('✗')} replays a Shell receipt acknowledgement whose reply was lost")
L.append(f"                              {D('→ '+e1.group(1)+'  (33 others pass)')}")
e2=grab(f'{X}/nc2-session.log', r'(\d+)ms\n')
L.append(f"  hosted-harness-session.ts   {RED('✗')} clears the active prompt and the session when Shell publisher cleanup never settles")
L.append(f"                              {D('→ AssertionError: expected true to be false (hasActivePrompt) after 10 s')}")
n3=grab(f'{X}/nc3-hunk2.log', r'Tests\s+(\d+ passed \(\d+\))')
L.append(f"  only the {B('/managed-runtime/continue')} hunk reverted → hosted-harness-session.test.ts {Y(n3.group(1))} "+Y('← hunk not pinned'))
L.append('')
L.append(B('Added witnesses')+D(' — scratch tests injected into hosted-harness-session.test.ts, not in the PR'))
def res(log, name):
    t=strip(open(f'{X}/extra/{log}.log').read())
    m=re.search(r'([✓×]) [^\n]*'+name+r'[^\n]*?(\d+)ms', t); return m.group(1), m.group(2)
for name,label in (('VERIFY-T1','T1 continue route, tool-turn cleanup never settles → status idle + DELETE 204'),
                   ('VERIFY-T2','T2 cleanup of a successful turn rejects → recoveryBlocked, next prompt 409')):
    parts=[]
    for log,arm in (('arm-head','head'),('arm-hunk2-reverted','continue hunk reverted'),('arm-base-session','base')):
        mark,ms=res(log,name)
        parts.append(f"{arm} {(G('✓') if mark=='✓' else RED('✗'))}")
    L.append(f"  {label}")
    L.append(f"      {' · '.join(parts)}")
oh=grab(f'{X}/extra/arm-head.log', r'VERIFY-T2 ordering=(\S+)').group(1)
ob=grab(f'{X}/extra/arm-base-session.log', r'VERIFY-T2 ordering=(\S+)').group(1)
L.append(D(f"      T2 ordering: head={oh} · base={ob}"))
L.append('')
L.append(B('Real HostedShellPublisher probes'))
for f in ('probe-P1.txt','probe-P2.txt','probe-P3.txt'):
    for line in open(f'{X}/extra/{f}').read().strip().splitlines():
        L.append('  '+line.replace('P3 control','P3 control  ').replace('P3 draining','P3 draining '))
L.append('')
L.append(B('acknowledge() lost-reply shapes')+D(' — real HostedWorkspaceBroker against a loopback server, 2nd attempt answers 200'))
for line in open(f'{X}/extra/ack-shapes-head.txt').read().strip().splitlines():
    name, att, out = [x.strip() for x in line.split('|')]
    replayed = att=='attempts=2'
    L.append(f"  {name:<48} {att}  {(G('replayed → resolved') if replayed else Y('not replayed → '+out.replace('rejected ','').split(':')[0]))}")
open(f'{X}/shots/unit.ansi','w').write('\r\n'.join(L)+'\r\n')
print('\n'.join(strip(l) for l in L))
