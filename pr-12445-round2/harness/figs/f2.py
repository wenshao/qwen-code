#!/usr/bin/env python3
# Figure 2 (#12445 @ 66d1aedb): payload fidelity through the real JdbcToolExecutionRepository on MySQL 8.4.11. Values from logs/.
import re
H = '/root/verify/pr12458-harness/logs'
B, C, G, R, D, Y, X = '\x1b[1m', '\x1b[36m', '\x1b[32m', '\x1b[31m', '\x1b[2m', '\x1b[33m', '\x1b[0m'
def rows(path):
    res, summ = [], []
    for l in open(path):
        l = l.rstrip('\n')
        m = re.match(r'^(.+?)\s+(same|CHANGED\S*|THROWS \S+)\s+(same|CHANGED\S*|THROWS \S+)\s*$', l)
        if m and not l.startswith('payload'): res.append((m.group(1).strip(), m.group(2), m.group(3)))
        if re.match(r'\s+as (reference member|settled result)', l): summ.append(l.strip())
    return res, summ
def cell(v, w=26):
    v = v.replace('THROWS ', '').replace('IllegalArgumentException', 'IAE (read back Infinity)')
    return (G if v == 'same' else R) + v.ljust(w) + X
color = lambda l: re.sub(r'(same=\d+)', lambda m: G + m.group(1) + X, re.sub(r'(CHANGED[^=]*=\d+|THROWS \w+=\d+)', lambda m: R + m.group(1) + X, l))
h, hs = rows(f'{H}/repo-roundtrip-66d1aedb-mysql84.log'); f, fs = rows(f'{H}/repo-roundtrip-66d1aedb-fix-mysql84.log')
_, h1 = rows(f'{H}/repo-roundtrip-66d1aedb-hunk1only-mysql84.log')
print(f'{B}{C}PR #12445 @ 66d1aedb — does a payload survive JdbcToolExecutionRepository? (MySQL 8.4.11, Connector/J 8.4.0){X}')
print(f'{D}Each payload is stored twice: as an extra reference member (re-read with findByIdempotencyKey, compared with sameRequest{X}')
print(f'{D}as createExecution does on a retry) and as a settled result (CAS, then findByExecutionCallId on a new repository instance).{X}')
print()
print(f'{B}{"payload":<54} {"66d1aedb reference":<26} {"66d1aedb result":<26} {"fix reference":<26} {"fix result":<26}{X}')
for (n, a, b), (_, c, d) in zip(h, f):
    print(f'{n[:54]:<54} {cell(a)} {cell(b)} {cell(c)} {cell(d)}')
print()
print(f'{B}3000 random JSON payloads{X} {D}(seed 12458; deliberately rich in $ref members and big numbers — not a real-world rate){X}')
for label, ls in (('66d1aedb', hs), ('fix', fs), ('codec only', h1)):
    for l in ls: print(f'  {label:<12} {color(l)}')
print(f'  {D}codec only = the reader/writer change without the sameJsonNumber change; the full patch also fixes that last one{X}')
print()
print(f'{B}Why the fix does not use JSONReader.Feature.UseBigDecimalForDoubles{X} {D}(fastjson2 2.0.60, logs/num-probe.log){X}')
for l in open(f'{H}/num-probe.log'):
    if l.startswith('{"n":1.2345678901234567890123E+30}') and re.search(r'\s(default|UseBigDecimalForDoubles)\s', l):
        print('  ' + re.sub(r'\s{2,}', '   ', l.strip()).replace('E+60', R + 'E+60' + X))
print(f'  {D}-> exponent-form numbers parse as double by default (digits lost; 1E+400 -> Infinity, then rejected on read), and the{X}')
print(f'  {D}   BigDecimal flag mis-scales long mantissas. Writing BigDecimal as plain text keeps the exponent out of the column.{X}')
print()
print(f'{B}Float/Double identity after the round trip{X} {D}(codec only, 100k random bit patterns per kind; logs/codec-arms-66d1aedb*.log){X}')
def kinds(path):
    out, k = {}, None
    for l in open(path):
        m = re.match(r'leaf kind (\S+)', l)
        if m: k = m.group(1); continue
        if k and l.startswith('   C  A +WriteBigDecimalAsPlain'): out[k] = l.split('Plain', 1)[1].strip()
    return out
a, b = kinds(f'{H}/codec-arms-66d1aedb.log'), kinds(f'{H}/codec-arms-66d1aedb-fix.log')
for k in ('Double', 'Float'):
    print(f'  {k:<7} both flags, sameJsonNumber as in 66d1aedb: {color(a[k]):<40}  + patch hunk 2: {color(b[k])}')
print(f'  {D}-> fastjson2 writes a decimal that reads back to the same float/double but not always with Float/Double.toString digits{X}')
print(f'  {D}   (162544.13 vs 162544.12; -1363683.0538119469 vs -1363683.053811947), so comparing the two texts as BigDecimal calls an{X}')
print(f'  {D}   honest retry a different request. Hunk 2 compares a float/double operand in its own binary precision.{X}')
