#!/usr/bin/env python3
"""/review R1-3 at 7980d55: schema-valid fixture cases the runner does not honour.

Writes packages/cli/src/serve/__mut__/r13a|r13b/ = unmodified head source + test,
plus a contracts/ copy with ONE extra case appended. Usage: r13_cases.py <worktree>
"""
import copy
import json
import pathlib
import shutil
import sys

WT = pathlib.Path(sys.argv[1])
SERVE = WT / 'packages/cli/src/serve'
OUT = SERVE / '__mut__'
FIX = 'managed-runtime-attestation-v2.fixtures.json'

base = json.loads((SERVE / 'contracts' / FIX).read_text())
success = next(c for c in base['cases'] if c['id'] == 'success')

headers = copy.deepcopy(success['request']['headers'])
headers['authorization'] = 'Bearer wrong-token-xx'
extra = {
    'r13a': {  # per-case request.headers override: a whole (closed) header set with a wrong token
        'id': 'wrong-token-via-headers-override',
        'request': {'headers': headers},
        'expected': {'status': 401, 'classification': 'credentials', 'code': 'managed_runtime_unauthorized'},
    },
    'r13b': {  # per-case method is any string; the runner only suppresses the body for GET
        'id': 'head-method',
        'request': {'method': 'HEAD'},
        'expected': {'status': 404, 'classification': 'incompatible'},
    },
}

for name, case in extra.items():
    d = OUT / name
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    shutil.copy(SERVE / 'managed-runtime-attestation-contract.ts', d)
    shutil.copy(SERVE / 'managed-runtime-attestation-contract.test.ts', d)
    shutil.copytree(SERVE / 'contracts', d / 'contracts')
    fx = copy.deepcopy(base)
    fx['cases'].append(case)
    (d / 'contracts' / FIX).write_text(json.dumps(fx, indent=2) + '\n')
    print('wrote', d)
