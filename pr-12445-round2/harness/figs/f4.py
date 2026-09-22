#!/usr/bin/env python3
# Figure 4 (#12445 @ 66d1aedb): gates, real databases, diff fuzz, mutation strength, the suggested patch. Values from logs/.
import re, glob
H = '/root/verify/pr12458-harness/logs'
B, C, G, R, D, Y, X = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[2m', '\x1b[33m', '\x1b[0m'
rd = lambda f: open(f'{H}/{f}').read()
ok = lambda s: G + s + X
bad = lambda s: R + s + X
def total(f):
    m = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', rd(f), re.M); return m[-1]
def gate(f):
    t = total(f); cs = re.search(r'You have (\d+) Checkstyle violations', rd(f)).group(1)
    return f'{int(t[0]) - int(t[1]) - int(t[2])}/{t[0]} tests, {cs} Checkstyle violations'
def it(f):
    m = re.search(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+).*JdbcRuntimeBrokerMySqlIT', rd(f)); return f'{int(m.group(1)) - int(m.group(2)) - int(m.group(3))}/{m.group(1)}'
tc = rd('toolchain.txt'); jv = re.search(r'Java version: ([^,\s]+)', tc).group(1); mv = re.search(r'Apache Maven (\S+)', tc).group(1)
print(f'{B}{C}PR #12445 @ 66d1aedb — gates, real databases, and test strength{X}  {D}(eclipse-temurin:21-jdk, Java {jv}, Maven {mv}, offline){X}')
print()
print(f'{B}A. The PR\'s Reviewer Test Plan, on Linux{X}')
print(f'  mvn clean checkstyle:check verify                   {ok(gate("plan-cmd-pr12445-66d1.log"))}')
engines = (('mysql84', 'MySQL 8.4.11'), ('mysql80', 'MySQL 8.0.46'), ('maria114', 'MariaDB 11.4.13'))
print(f'  -Pmysql-integration verify (fresh DB per run)       ' + ' · '.join(f'{n} {ok(it(f"it-pr12445-66d1-{k}.log"))}' for k, n in engines))
fz = [re.search(r'ops executed=(\d+) divergent sequences=(\d+)', rd(f)).groups() for f in ('difffuzz-66d1aedb-h2.log', 'difffuzz-66d1aedb-mysql84.log')]
print(f'  lock-step diff fuzz vs merged in-memory repository  H2 {ok(f"{int(fz[0][0]):,} ops, {fz[0][1]} divergent")} · MySQL 8.4.11 {ok(f"{int(fz[1][0]):,} ops, {fz[1][1]} divergent")}')
col = rd('collation-probe-66d1aedb.log')
nulls = col.count('-> null'); created = col.count('record id=EXEC-A PREPARED')
print(f'  case/accent/space variants of an execution id      {ok(f"distinct on MySQL 8.4 and MariaDB 11.4 ({nulls} lookups null, {created} distinct inserts)")}  {D}(closed by 66d1aedb){X}')
print()
print(f'{B}B. Which guards does the PR suite pin?{X} {D}(single-guard mutants of JdbcToolExecutionRepository / BrokerValues / ToolExecutionRecord){X}')
m = rd('mutation-66d1aedb.log').splitlines()
k = re.search(r'killed (\d+)/(\d+)', m[0]).groups()
surv = re.search(r"survivors: \[(.*)\]", m[1]).group(1).replace("'", '').split(', ')
fz_k = []
for s in surv:
    t = open(f'/root/verify/pr12458-harness/mut66/{s}/fuzz.log').read()
    n = int(re.search(r'divergent sequences=(\d+)', t).group(1))
    if n and s != 'M57': fz_k.append((s, n))
print(f'  PR suite: {k[0]}/{k[1]} killed · lock-step fuzz kills {len(fz_k)} of the {len(surv)} survivors · multi-JVM race kills M50 (figure 3)')
import json
desc = dict(json.load(open('/root/verify/pr12458-harness/mut66/index.json')))
for s in ('M50', 'M22', 'M18', 'M38', 'M09'):
    d = desc.get(s, '')
    extra = dict(fz_k).get(s)
    print(f'    {Y}{s}{X}  {d:<46} {"race: executions dispatched twice" if s == "M50" else f"diff fuzz ({extra}/1500 sequences)"}')
print(f'  {D}other survivors: equivalent, need a forged snapshot or tampered row, in-package-only arguments, or payload-compare internals{X}')
print(f'  {D}(M57 also shows fuzz "divergences", but only because the fuzz oracle itself calls the mutated sameJsonMap; not counted){X}')
print()
print(f'{B}C. Suggested patch{X} {D}(suggested-fix-pr12445-66d1aedb.patch: +19/-6 production, +74 test){X}')
print(f'  66d1aedb + patch               clean checkstyle:check verify {ok(gate("plan-cmd-pr12445-66d1-fix.log"))}')
t = total('headtests-66d1aedb.log'); e = 'StackOverflowError' if 'StackOverflowError' in rd('headtests-66d1aedb.log') else '?'
print(f'  66d1aedb + only the new tests  mvn test                    {bad(f"{t[1]} failures, {t[2]} error ({e}) -> the tests reproduce the defect")}')
print(f'  66d1aedb + patch               -Pmysql-integration         ' + ' · '.join(f'{n} {ok(it(f"it-pr12445-66d1-fix-{k2}.log"))}' for k2, n in engines))
mf = rd('mutation-66d1aedb-fixarm.log').splitlines(); kk = re.search(r'killed (\d+)/(\d+)', mf[0]).groups()
print(f'  mutants on the patched tree    {kk[0]}/{kk[1]} killed; ' + mf[1].strip().replace('patch-line mutants killed: ', 'patch-line mutants killed ').replace("['F1', 'F1b', 'F2', 'F3', 'F4']", 'F1 F1b F2 F3 F4').replace('True', 'yes'))
for l in rd('kill-rate-66d1aedb.log').splitlines():
    print(f'  {D}{l}{X}')
print()
print(f'{B}D. The twin PR #12458 @ 4a84a9c{X} {D}(same codec lines; suggested-fix-pr12458-4a84a9c.patch applies there){X}')
s = rd('service-poison-4a84a9c-mysql84.log'); s1 = re.search(r'S1 createExecution +: (.*)', s).group(1).replace('java.lang.', ''); s2 = re.search(r'S2 release session +: (.*)', s).group(1)
rr = re.search(r'as settled result  : (\{.*\})', rd('repo-roundtrip-4a84a9c-mysql84.log')).group(1)
print(f'  4a84a9c           service S1: {bad(s1)} · S2 release: {bad(s2)}')
print(f'  4a84a9c           3000 random results on MySQL 8.4: {bad(rr)}')
print(f'  4a84a9c + patch   {ok(gate("gate-final-pr12458-fix.log"))} · IT ' + ' · '.join(f'{n} {ok(it(f"it-4a84a9c-pr12458-fix-{k2}.log"))}' for k2, n in engines))
