#!/usr/bin/env python3
# Figure 1 (#12445 @ 66d1aedb): RuntimeBrokerService over the real JDBC repositories, MySQL 8.4.11. Values from logs/.
import re
L = '/root/verify/pr12458-harness/logs/service-probe-66d1aedb-mysql84.log'
B, C, G, R, D, Y, X = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[2m', '\x1b[33m', '\x1b[0m'
arms, cur = {}, None
for line in open(L):
    line = line.rstrip('\n')
    m = re.match(r'arm=(.*)', line)
    if m: cur = m.group(1); arms[cur] = {}; continue
    m = re.match(r'(S\d+ [^:]*?)\s*: (.*)', line)
    if m and cur: arms[cur][m.group(1).strip()] = m.group(2)
def tidy(v):
    v = v.replace('com.alibaba.fastjson2.', '').replace('java.lang.', '').replace('result=', '')
    v = re.sub(r' \(cause ([A-Za-z]+)(: [^)]*)?\)', lambda m: f' ({m.group(1).replace("IllegalArgumentException", "IAE").replace("StackOverflowError", "SOE")})', v)
    v = v.replace('executionStatus=success, ', '').replace(', executionStatus=success', '').replace('ok SETTLED {executionStatus=success}', 'ok SETTLED')
    return v
W = 45
def cell(arm, key, force=None):
    v = tidy(arms[arm].get(key, '?'))
    col = force or (G if v.startswith('ok') or v == 'SETTLED' else D if v == '-' else R)
    return col + v[:W].ljust(W) + X
print(f'{B}{C}PR #12445 @ 66d1aedb — RuntimeBrokerService over JdbcToolExecutionRepository, MySQL 8.4.11{X}')
print(f'{D}Real JDBC binding/session/execution repositories; the Harness resolver, provisioner and transport are stubs.{X}')
print(f'{D}control = merged InMemoryToolExecutionRepository · fix = 66d1aedb + suggested-fix-pr12445-66d1aedb.patch{X}')
print()
print(f'{B}{"step":<38} {"in-memory (control)":<{W}} {"JDBC 66d1aedb":<{W}} {"JDBC + fix":<{W}}{X}')
def row(label, key, head_force=None):
    print(f'{label:<38} {cell("in-memory", key)} {cell("jdbc-66d1aedb", key, head_force)} {cell("jdbc-66d1aedb-fix", key)}')
print(f'{Y}S1  Runtime result: {{"output":{{"$ref":"@"}}}}{X}')
row('    createExecution', 'S1 createExecution'); row('    createExecution (idempotent retry)', 'S1 createExecution (retry)')
print(f'{Y}S2  Harness reference: {{..., "schema":{{"$ref":"$"}}}}{X}')
for label, key in (('    createExecution', 'S2 createExecution'), ('    row state in qwen_tool_execution', 'S2   row state in DB'),
                   ('    createExecution (idempotent retry)', 'S2 createExecution (retry)'), ('    cancelExecution', 'S2 cancelExecution'),
                   ('    release(Runtime Session)', 'S2 release session'), ('    release again', 'S2 release session (again)')):
    row(label, key)
print(f'{Y}S3  Runtime result: {{"output":{{"$ref":"./common.yaml#/components/schemas/Error"}}}}{X}')
row('    createExecution', 'S3 createExecution'); row('    createExecution (idempotent retry)', 'S3 createExecution (retry)')
print(f'{Y}S4  Runtime result: {{"output":{{"$ref":"$.executionStatus"}}}}{X}')
row('    stored result, read back', 'S4 createExecution', R)
print(f'{Y}S9  Runtime result: {{"output":{{"@type":["Product","Thing"], "name":"Widget"}}}}  (JSON-LD){X}')
row('    stored result, read back', 'S9 createExecution', R)
print(f'{Y}S10 Runtime result: {{"output":{{"@type":null, "name":"Widget"}}}}{X}')
row('    createExecution', 'S10 createExecution'); row('    createExecution (idempotent retry)', 'S10 createExecution (retry)')
for tag, desc in (('S5', 'BigDecimal 1E+400'), ('S6', 'BigDecimal 1.2345678901234567890123E+30'), ('S7', 'Float 162544.13f'), ('S8', 'Double -1363683.0538119469')):
    print(f'{Y}{tag}  Harness reference carries {desc}{X}')
    row('    createExecution', f'{tag} createExecution'); row('    createExecution (idempotent retry)', f'{tag} createExecution (retry)')
    row('    release(Runtime Session)', f'{tag} release session')
print()
print(f'{D}ESCAPES = a raw Error/exception leaves the service instead of a RuntimeBrokerException (SOE = StackOverflowError,{X}')
print(f'{D}IAE = IllegalArgumentException "JSON number must be finite"). Every exit path (retry, cancel,{X}')
print(f'{D}claim, resolve) reads the row first, and hasActiveByRuntimeSession() reads no JSON, so S2/S5 keep release() at 409.{X}')
print(f'{D}S4: fastjson2 resolved the $ref as a JSONPath back-reference; the output reads back as the string "success".{X}')
print(f'{D}S9: the typed reader turns the @type array into the string \'["Product","Thing"]\'.{X}')
print(f'{D}S5 retry: the read-time IAE is caught around findOrCreate and reported as "execution identity is already in use".{X}')
