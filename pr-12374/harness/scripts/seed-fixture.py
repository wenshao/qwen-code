#!/usr/bin/env python3
"""seed-fixture.py <scenario-dir> : the S1 matrix (17 entries) with exact ages."""
import os, sys, time
SC=sys.argv[1]; D=f'{SC}/runtime/debug'; O=f'{SC}/outside'
os.makedirs(D+'/daemon/archive', exist_ok=True)
now=time.time(); day=86400
def f(p, age_days, body='log line\n'):
    open(p,'w').write(body); t=now-age_days*day; os.utime(p,(t,t))
rows=[
 ('11111111-1111-4111-8111-111111111111.txt',60),
 ('22222222-2222-4222-8222-222222222222.txt',31),
 ('33333333-3333-4333-8333-333333333333-agent-Explore-g2tss0.txt',60),
 ('44444444-4444-4444-8444-444444444444.txt',29),
 ('transcript-replay.txt',60),
 ('workspace-mcp-discovery.txt',60),
 ('Transcript-Replay.txt',60),
 ('workspace-mcp-discovery-old.txt',60),
 ('transcript-replay.log',60),
 ('notes.txt',60),
 ('startup--root-git.txt',60),
 ('77777777-7777-4777-8777-777777777777.txt',60),   # = --session-id of the live TUI
 ('88888888-8888-4888-8888-888888888888.txt',0.003),
]
for n,a in rows: f(f'{D}/{n}',a)
os.makedirs(f'{D}/55555555-5555-4555-8555-555555555555.txt', exist_ok=True)
t=now-60*day; os.utime(f'{D}/55555555-5555-4555-8555-555555555555.txt',(t,t))
f(f'{O}/victim.txt',60,'must survive: target of a *.txt symlink\n')
os.symlink(f'{O}/victim.txt', f'{D}/66666666-6666-4666-8666-666666666666.txt')
os.symlink('11111111-1111-4111-8111-111111111111.txt', f'{D}/latest')
f(f'{D}/daemon/serve-1.log',60); f(f'{D}/daemon/archive/serve-0.log',60)
print('seeded', D)
