#!/usr/bin/env python3
"""Derive assertions.json from the recorded logs of this verify round.

Every check reads a log this round actually produced at the verified head
8b86926a; nothing is projected. Exit code is nonzero if any check fails, so
the matrix cannot quietly drift from the report.
"""
import json
import os
import re
import sys

ART = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(ART, 'logs')

ANSI = re.compile(r'\x1b\[[0-9;]*[mK]')


def read(name):
    with open(os.path.join(LOG, name), encoding='utf-8', errors='replace') as fh:
        return ANSI.sub('', fh.read())


checks = []


def check(name, cond):
    checks.append((name, bool(cond)))


def section(text, marker):
    idx = text.find(marker)
    return '' if idx < 0 else text[idx:]


ab = read('ab-cells.txt')
base_ab = section(ab, '=== BASE arm')
head_ab = section(ab, '=== HEAD arm')

head_suite = read('head2-suite.log')
check('head 10-file suite: 10 files passed', 'Test Files  10 passed (10)' in head_suite)
check('head 10-file suite: 286 tests passed', 'Tests  286 passed (286)' in head_suite)
base_own = read('base-own-suite.txt')
check('base own 10-file suite: 10 files passed', 'Test Files  10 passed (10)' in base_own)
check('base own 10-file suite: 282 tests passed', 'Tests  282 passed (282)' in base_own)
check(
    'base + PR tests: 4 failed of 286',
    'Tests  4 failed | 282 passed (286)' in base_ab,
)
check('head arm of A/B: 286 passed', 'Tests  286 passed (286)' in head_ab)

NEW = [
    ('pagination facts default/override', 'defaults history pagination facts to the controller'),
    ('cancel settlement scoping', 'scopes cancel settlement errors to the session'),
    ('controller history facts', 'projects live history pagination facts from deps'),
    ('binding reactive history facts', 'projects reactive transcript history pagination facts'),
]
for label, name in NEW:
    check(f'base red: {label}', 'FAIL' in base_ab and name in base_ab)

for i, (label, _name) in enumerate(NEW, start=1):
    head_one = read(f'head2-t{i}.txt')
    check(f'head green (isolated): {label}', 'Tests  1 passed' in head_one)

matrix = read('matrix-final.txt')
rows = [line for line in matrix.splitlines() if re.match(r'^M\d+ \|', line)]
check('mutation matrix ran 11 rows', len(rows) == 11)
for line in rows:
    mid = line.split('|')[1].strip()
    check(f'mutant killed: {line.split("|")[0].strip()}', mid.startswith('Tests') and '1 failed' in mid)
    check(f'mutant restored: {line.split("|")[0].strip()}', line.rstrip().endswith('RESTORED'))

check('head tsc lib clean (empty log)', read('head2-tsc-lib.txt') == '')
check('head tsc app clean (empty log)', read('head2-tsc-app.txt') == '')
planted = read('tsc-planted2.txt')
check('typecheck gate live: planted error reported', 'error TS2322' in planted)
check('planted error reverted (git status empty)', read('contract-restored2.txt') == '')

edge = read('edge-cells.txt')
base_edge = section(edge, '=== BASE arm')
head_edge = section(edge, '=== HEAD arm')


def cell(text, name):
    m = re.search(name + r'(\d+)', text)
    return None if m is None else int(m.group(1))


check('probe control E3 head=1', cell(head_edge, r'E3 active-rejected onError=') == 1)
check('probe control E3 base=1', cell(base_edge, r'E3 active-rejected onError=') == 1)
check('probe E4 head=1 (round-trip preserved)', cell(head_edge, r'E4 roundtrip-before-settle onError=') == 1)
check('probe E4 base=1', cell(base_edge, r'E4 roundtrip-before-settle onError=') == 1)
check('probe E1 head whileAway=0', cell(head_edge, r'E1 post-settlement-return whileAway=') == 0)
check('probe E1 base whileAway=1 (wrong-session report on base)', cell(base_edge, r'E1 post-settlement-return whileAway=') == 1)
check('probe E2 head unmount=1 (unchanged from base)', cell(head_edge, r'E2 after-unmount onError=') == 1)
check('probe E2 base unmount=1', cell(base_edge, r'E2 after-unmount onError=') == 1)

merge = read('merge-tree2.txt').strip()
check('trial merge into current main conflict-free', re.fullmatch(r'[0-9a-f]{40}', merge) is not None)
check('merged worktree tree == merge-tree output', merge == 'ddc942b844bf618904f612582cf0cf55862f382d')
check('PR files byte-identical between head and merged tree', read('merged-pr-files-diff2.txt') == '')
merged_suite = read('merged2-suite.log')
check('merged 10-file suite: 287 tests passed', 'Tests  287 passed (287)' in merged_suite)
check('merged tsc lib clean', read('merged2-tsc-lib.txt') == '')
check('merged tsc app clean', read('merged2-tsc-app.txt') == '')

passed = sum(1 for _n, ok in checks if ok)
failed = len(checks) - passed
for name, ok in checks:
    print(('PASS' if ok else 'FAIL') + '  ' + name)
print(f'\nassertions: pass={passed} fail={failed} total={len(checks)}')
with open(os.path.join(ART, 'assertions.json'), 'w', encoding='utf-8') as fh:
    json.dump({'pass': passed, 'fail': failed, 'total': len(checks)}, fh)
    fh.write('\n')
sys.exit(0 if failed == 0 else 1)
