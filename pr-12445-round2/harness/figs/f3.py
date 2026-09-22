#!/usr/bin/env python3
# Figure 3 (#12445 @ 66d1aedb): 6 broker JVMs x 8 threads on real databases. Values from logs/race-66d1aedb-*.log.
import re, ast
H = '/root/verify/pr12458-harness/logs'
B, C, G, R, D, Y, X = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[2m', '\x1b[33m', '\x1b[0m'
def parse(name):
    t = open(f'{H}/{name}').read()
    ev = ast.literal_eval(re.search(r'events: (\{.*\})', t).group(1)); g = lambda p: int(re.search(p, t).group(1))
    return dict(server=re.search(r'server (\S+)', t).group(1), claims=ev.get('CLAIM', 0), fenced=ev.get('FENCED', 0),
                execd=g(r'(\d+) executions reached EXECUTING'), dbl=g(r'executions with >1 EXEC = (\d+)'),
                gen=g(r'violations = (\d+) executions'), gens=g(r'\((\d+) generations'), own=g(r'dispatcher that executed that generation: violations = (\d+)'),
                multi=g(r'settled more than once: (\d+)'), conv=re.search(r'I1 create : (\d+/\d+)', t).group(1), resolve=ev.get('RESOLVE', 0),
                errs=re.search(r'errors: (.*)$', t, re.M).group(1).strip(), verdict=re.search(r'VERDICT: (.*)', t).group(1))
arms = [('66d1aedb', 'race-66d1aedb-mysql84.log'), ('66d1aedb', 'race-66d1aedb-mysql80.log'), ('66d1aedb', 'race-66d1aedb-maria114.log'),
        ('control: no FOR UPDATE (M50)', 'race-66d1aedb-mut-M50-mysql84.log'), ('control: no live-lease check (M22)', 'race-66d1aedb-mut-M22-mysql84.log')]
print(f'{B}{C}PR #12445 @ 66d1aedb — 6 broker JVMs x 8 threads racing on one qwen_tool_execution table{X}')
print(f'{D}Phase A: all 48 threads findOrCreate the same 100 idempotency keys at one wall-clock instant.{X}')
print(f'{D}Phase B (25 s): a sliding hot window of ~12 executions; each thread claims (30-280 ms lease), sometimes stalls past its lease,{X}')
print(f'{D}CASes DISPATCHING->EXECUTING ("EXEC" = the moment a dispatcher would send the Tool call), settles; others cancel / resolve UNKNOWN.{X}')
print()
print(B + f'{"tree":<34} {"server":<16} {"create":>8} {"claims":>7} {"fenced":>7} {"EXEC":>5} {"2x EXEC":>8} {"gen >1 owner":>13} {"result/owner":>12} {"settled 2x":>10} {"UNKNOWN resolved":>17} {"errors":>7}  verdict' + X)
for tree, f in arms:
    p = parse(f)
    def bad(v, w, text=None):
        text = text or str(v); return ' ' * (w - len(text)) + (R if v else G) + text + X
    srv = p['server'].replace('-MariaDB-ubu2404', ' MariaDB')
    errs = '0' if p['errs'] == '0' else str(sum(ast.literal_eval(p['errs']).values()))
    gtext = f'{p["gen"]} ({p["gens"]})' if p['gen'] else '0'
    print(f'{tree:<34} {srv:<16} {p["conv"]:>8} {p["claims"]:>7} {p["fenced"]:>7} {p["execd"]:>5} {bad(p["dbl"], 8)} {bad(p["gen"], 13, gtext)} '
          f'{bad(p["own"], 12)} {bad(p["multi"], 10)} {p["resolve"]:>17} {errs:>7}  {(G if p["verdict"] == "PASS" else R) + p["verdict"] + X}')
print()
print(f'{D}2x EXEC = executions sent to the Runtime twice · gen >1 owner = executions where one dispatch generation was granted to two or{X}')
print(f'{D}more owners (distinct generations) · result/owner = a success result not written by the dispatcher that executed that generation{X}')
cnt = open(f'{H}/mysql-error-counters.log').read()
dl = re.findall(r'ER_LOCK_DEADLOCK\t(\d+)', cnt); du = re.findall(r'ER_DUP_ENTRY\t(\d+)', cnt); ce = re.findall(r'Connection_errors_max_connections\t(\d+)', cnt)
print(f'{D}MySQL 8.4 / 8.0 performance_schema over every run since container start: ER_LOCK_DEADLOCK {dl[0]}/{dl[1]} (innodb_deadlock_detect=1),{X}')
print(f'{D}ER_DUP_ENTRY {du[0]}/{du[1]} (the unique-key race really happened). A first 8.4 attempt (not shown) hit max_connections: the harness opens{X}')
print(f'{D}one unpooled connection per operation; Connection_errors_max_connections {ce[0]} on 8.4, invariants I1-I5 all 0; re-run clean (logs/NOTES.md).{X}')
print()
print(f'{Y}The row lock is the at-most-once guarantee:{X} without FOR UPDATE, executions are dispatched twice — while the PR suite stays green.')
print(f'{Y}The live-lease refusal keeps healthy calls out of UNKNOWN:{X} without it nothing is sent twice (the robbed owner\'s next CAS is fenced),')
print(f'but a peer\'s claim now turns a live EXECUTING row into UNKNOWN (the race resolved {parse("race-66d1aedb-mut-M22-mysql84.log")["resolve"]} UNKNOWN rows vs {parse("race-66d1aedb-mysql84.log")["resolve"]} with the real code),')
print(f'and each such row waits for the not-yet-built authoritative reconciliation.')
