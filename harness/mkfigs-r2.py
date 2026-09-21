import json, os, sys, subprocess
SP=sys.argv[1]; E=os.path.join(SP,'e2e')
j=lambda a,f: json.load(open(f'{E}/{a}/{f}'))
def c(code,s): return f'\033[{code}m{s}\033[0m'
G=lambda s:c('32',s); R=lambda s:c('31',s); Y=lambda s:c('33',s); BD=lambda s:c('1',s); D=lambda s:c('2',s); CY=lambda s:c('36',s)
def P(s,w): return s+' '*max(0,w-len(s))

o=[];a=o.append
a(BD('PR #12374 · round 2 · head b83983c19 merged into main df3f9732a6 → f570314d89'))
a('')
a(CY('  what moved since round 1'))
a('    cleanup.ts           21dc9c32d8 → 21dc9c32d8   ' + G('blob-identical'))
a('    scheduler.ts         d76a6ca1e9 → d76a6ca1e9   ' + G('blob-identical'))
a('    scheduler.test.ts    c21e2a659a → c21e2a659a   ' + G('blob-identical'))
a('    cleanup.test.ts      a94957aa57 → 6316c43e31   ' + Y('+20 lines: 25 stale logs > SWEEP_CONCURRENCY (20)'))
a(D('    plus: main merged (not rebased); description now covers `latest` + sweep root'))
a('')
a(CY('  test-file-only A/B — same production source, same mutants, only cleanup.test.ts swapped'))
a('    ' + P('mutant',54) + P('old test file',16) + 'new test file')
a('    ' + '─'*52 + '  ' + '─'*14 + '  ' + '─'*14)
rows=[('unmutated','','pass','pass'),
      ('M15','loop stride enlarged — first batch only','SURVIVED','KILLED'),
      ('M17','each batch drops its last candidate','SURVIVED','KILLED'),
      ('M19','stride off by one at the batch boundary','SURVIVED','KILLED')]
for mid,desc,o1,o2 in rows:
    col=lambda v: G(P(v,14)) if v in ('pass','KILLED') else Y(P(v,14))
    a('    ' + P(f'{mid:<5}{desc}',54) + col(o1) + '  ' + col(o2))
a(D('    the new case is the only thing that kills all three; nothing else in the suite crosses a batch'))
a('')
M1=json.load(open(f'{SP}/r2-mutation-results.json')); M2=json.load(open(f'{SP}/r2-mutation-results2.json'))
allm=[m for m in M1+M2 if m[1] in ('KILLED','SURVIVED')]
k=sum(m[1]=='KILLED' for m in allm); s=len(allm)-k
a(CY('  full mutation matrix on the new tree'))
a('    ' + G(f'{k} killed') + '   ' + Y(f'{s} survived') + f'   of {len(allm)} effective   ' + D('(round 1: 10 / 6 of 16)'))
a('    survivors: ' + ', '.join(m[0] for m in allm if m[1]=='SURVIVED') + D('   — M15 is gone; M2 and M13 remain'))
open(f'{SP}/fig4.txt','w').write('\n'.join(o)+'\n')

o=[];a=o.append
a(BD('Real CLI re-run on the new tree (same harness as round 1)'))
a(D('private QWEN_HOME + QWEN_RUNTIME_DIR per arm, env -i, private tmux socket, cleanupPeriodDays = 30'))
a('')
names=[('11111111-1111-4111-8111-111111111111.txt','stale session log, 60 d','removed'),
       ('33333333-3333-4333-8333-333333333333-agent-Explore-g2tss0.txt','stale subagent log, 60 d','removed'),
       ('44444444-4444-4444-8444-444444444444.txt','stale log `latest` pointed at','removed'),
       ('22222222-2222-4222-8222-222222222222.txt','recent session log, 1 d','kept'),
       ('notes.txt','not a session id, 60 d','kept'),('latest','the symlink alias itself','kept'),('daemon','daemon log dir','kept')]
B=j('r2-base','after.json'); H=j('r2-head','after.json')
a('  ' + P('entry',46) + P('what it is',32) + P('BASE',10) + 'HEAD')
a('  ' + '─'*44 + '  ' + '─'*30 + '  ' + '─'*8 + '  ' + '─'*14)
for n,w,e in names:
    short=n if len(n)<=44 else n[:29]+'…'+n[-13:]
    bc=G('present') if n in B else R('gone')
    hc=(G('removed ✓') if n not in H else R('present ✗')) if e=='removed' else (G('kept    ✓') if n in H else R('removed ✗'))
    a('  ' + P(short,46) + P(w,32) + P(bc,10+9) + hc)
mk=[x for x in open(f'{E}/r2-head/markers.txt').read().split() if x.startswith('.debug-logs')]
a('  marker: BASE ' + R('none (polled 421 s)') + '   HEAD ' + G(mk[0] if mk else '?'))
a('')
a(BD('  current-session guard — live log frozen (chmod 0444) and aged 60 d, then one-token mutant'))
def st(arm):
    L=open(f'{E}/{arm}/live.txt').read().strip(); p=f'{E}/{arm}/qwen-home/debug/{L}'
    return subprocess.run(['stat','-f','%Sp %z %Sm','-t','%F',p],capture_output=True,text=True).stdout.split()
m1=st('r2-frozen-head'); m2=st('r2-frozen-mut')
a('    ' + P('HEAD as written',30) + G(f'{m1[0]}  {m1[1]:>5} B  mtime {m1[2]}  original file, untouched ✓'))
a('    ' + P('HEAD minus the name guard',30) + R(f'{m2[0]}  {m2[1]:>5} B  mtime {m2[2]}  new file: unlinked, re-created ✗'))
a(D('    the mode bits settle it: 0444 is the file we froze; 0644 can only be a file appendFile() made'))
lt=j('r2-race-head','after.json').get('latest',{})
a('')
a('  `latest` after its 60 d target is swept -> 44444444-…-444444444444.txt  ' + Y('dangling = ' + ('yes' if lt.get('dangling') else 'no')) + D('  (now documented)'))
open(f'{SP}/fig5.txt','w').write('\n'.join(o)+'\n')
print('ok')
