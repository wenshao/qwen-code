#!/usr/bin/env python3
"""Addendum figures for PR #12445 @ 15d395bc (after round-2 comment 5775293028), built from logs only.

usage: LOGS=<logs dir> python3 make_delta_figs.py   (writes delta1/2/3.ansi into the current directory)
"""
import os
import re

L = os.environ.get('LOGS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'logs'))
B, C, G, R, Y, D, X = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[33m', '\x1b[2m', '\x1b[0m'


def read(name):
    return open(os.path.join(L, name), encoding='utf-8').read()


# ---------------------------------------------------------------- fig A
lines = [f'{B}{C}databaseNow() with two dispatcher pools whose MySQL sessions disagree on time_zone — PR #12445 @ 15d395bc, MySQL 8.4.11{X}',
         f'{D}The deferred item (#12390 finding 1 / chiga0 M1). Pool B adds connectionTimeZone=Asia/Shanghai&forceConnectionTimeZoneToSession=true.{X}',
         f'{D}Repository calls only (TzProbe); across brokers this needs multi-instance dispatch. logs/tz-mixed-15d395bc.log{X}', '']
for l in read('tz-mixed-15d395bc.log').splitlines():
    col = R if ('GRANTED' in l or 'fenced out' in l or 'forced' in l or 'still looks live' in l) else ''
    lines.append(col + l + X)
open('delta1.ansi', 'w').write('\n'.join(lines) + '\n')


# ---------------------------------------------------------------- fig B
def load(n):
    d = {}
    for l in read(f'mut-{n}.log').splitlines():
        m = re.match(r'(\w+)\s+(KILLED|SURVIVED|INFRA\S*)\s+(.*)', l)
        if m:
            d[m.group(1)] = (m.group(2), m.group(3).strip())
    return d


arms = [('15d395bc', '15d395bc (PR suite)'), ('15d395bc-plus-fence-block', '+ fence-tests-15d395bc.patch')]
data = {a: load(a) for a, _ in arms}
lines = [f'{B}{C}The round-2 comment\'s mutant set (its own generator, mutants66.py) at 15d395bc; 4 patterns no longer apply, 60 mutants{X}',
         f'{D}Suites: JdbcRepositoryTest (H2), InMemoryRepositoryTest, RuntimeBrokerServiceTest. KILLED = surefire failure/error. run_round2_mutants.sh{X}', '']
lines.append(f'{B}{"id":<5} {"mutant":<48}' + ''.join(f' {t:<30}' for _, t in arms) + X)
a0, a1 = arms[0][0], arms[1][0]
new = [k for k in data[a0] if data[a0][k][0] != 'KILLED' and data[a1][k][0] == 'KILLED']
for k in new:
    row = f'{k:<5} {data[a0][k][1][:48]:<48}'
    for a, _ in arms:
        s = data[a][k][0]
        row += f' {(G if s == "KILLED" else R)}{s:<30}{X}'
    lines.append(row)
lines.append('')
tot = f'{"":<5} {"killed":<48}'
for a, _ in arms:
    k = sum(1 for v in data[a].values() if v[0] == 'KILLED')
    tot += f' {B}{k}/{len(data[a])}{X}' + ' ' * (30 - len(f'{k}/{len(data[a])}'))
lines.append(tot)
lost = [k for k in data[a0] if data[a0][k][0] == 'KILLED' and data[a1][k][0] != 'KILLED']
surv = [k for k in data[a1] if data[a1][k][0] != 'KILLED']
lines.append(f'{D}Killed by the PR suite but not with the patch: {lost or "none"}. INFRA rows: 0. Still surviving: {" ".join(surv)}{X}')
open('delta2.ansi', 'w').write('\n'.join(lines) + '\n')

# ---------------------------------------------------------------- fig C
lines = [f'{B}{C}RuntimeBrokerService (merged #12438) over this repository @ 15d395bc — effects the repository tests cannot see{X}', '']
lines.append(f'{B}1. Broker A pauses past its 1 s lease between claimDispatch and its CAS into EXECUTING; broker B takes the claim over{X}')
lines.append(f'{D}   TakeoverRaceProbe (B acts on the shared repository directly; latent until another broker can drive the call){X}')
for name, log in (('15d395bc', 'takeover-race-15d395bc.log'),
                  ('+ service-owner-check-15d395bc.patch', 'takeover-race-svcfix-15d395bc.log')):
    lines.append(f'   {B}{name}{X}')
    for l in read(log).splitlines():
        l = l.replace('[with owner check] ', '')
        lines.append(f'     {(R if l.rstrip().endswith("calls=1") else G)}{l}{X}')
lines += ['', f'{B}2. One broker, one consistent session time zone (Connector/J defaults unless noted); ConsistentZoneProbe{X}']
for l in read('consistent-zone-15d395bc.log').splitlines():
    if l.startswith('====='):
        lines.append(f'   {B}{l[6:].replace("arm: ", "")}{X}')
    elif l.startswith('url:'):
        continue
    else:
        bad = ('calls=0' in l) or ('shouldDriveDispatch=false' in l)
        good = ('calls=1' in l) or ('shouldDriveDispatch=true' in l)
        lines.append(f'     {(R if bad else G if good else "")}{l}{X}')
open('delta3.ansi', 'w').write('\n'.join(lines) + '\n')
print('ok', new)
